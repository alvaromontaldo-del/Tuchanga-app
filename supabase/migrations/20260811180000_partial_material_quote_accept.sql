-- YaChanga — Aceptación parcial entre comercios + 1 tarjeta chat por pedido + auto-reject 72h.
--
-- Reglas de aceptación:
-- 1) El cliente confirma por comercio: acepta ítems elegidos y auto-rechaza el resto de ESE comercio.
-- 2) Otros comercios del mismo pedido NO se tocan (pueden aceptarse después, cada uno con su orden/fee).
-- 3) Quotes `sent` sin aceptación final tras 72h → rejected (items pending → rejected).
--
-- Aplicar en Supabase (SQL editor o `supabase db push`). Si hay pg_cron, enganchar
-- `reject_stale_material_quotes()` cada hora (ver COMMENT al final).

-- ---------------------------------------------------------------------------
-- 1) Trigger: al aceptar un quote NO rechazar otros comercios del mismo request
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_quotes_on_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    -- Pedido pasa a accepted si estaba abierto; otros quotes `sent` siguen vivos
    -- para permitir aceptación parcial entre comercios.
    UPDATE public.material_requests
    SET status = 'accepted', updated_at = now()
    WHERE id = NEW.request_id
      AND status IN ('sent', 'quoted');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_quotes_on_accepted() IS
  'Al aceptar un quote marca el pedido accepted. No rechaza cotizaciones de otros comercios (aceptación parcial multi-comercio).';

-- ---------------------------------------------------------------------------
-- 2) accept_material_quote: ítems parciales; no exige que el request no esté accepted
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_material_quote(
  p_quote_id uuid,
  p_accepted_item_ids uuid[]
)
RETURNS TABLE (
  order_id uuid,
  deposit_amount numeric,
  accepted_total numeric,
  order_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_total numeric := 0;
  v_fee numeric := 0;
  v_order_id uuid;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_accepted_item_ids IS NULL OR cardinality(p_accepted_item_ids) < 1 THEN
    RAISE EXCEPTION 'no_items_selected';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;
  IF v_quote.status <> 'sent' THEN
    RAISE EXCEPTION 'quote_not_sent';
  END IF;

  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
  IF v_req.client_id IS DISTINCT FROM v_uid AND v_quote.client_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_client';
  END IF;
  IF v_req.status = 'completed' THEN
    RAISE EXCEPTION 'request_completed';
  END IF;

  SELECT o.id INTO v_existing FROM public.orders o WHERE o.quote_id = p_quote_id;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'order_already_exists';
  END IF;

  -- Aceptados = seleccionados; el resto de ESTE comercio queda rejected.
  UPDATE public.quote_items
  SET client_decision = CASE
    WHEN request_item_id = ANY (p_accepted_item_ids) THEN 'accepted'
    ELSE 'rejected'
  END
  WHERE quote_id = p_quote_id;

  SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_total
  FROM public.quote_items qi
  JOIN public.request_items ri ON ri.id = qi.request_item_id
  WHERE qi.quote_id = p_quote_id
    AND qi.client_decision = 'accepted';

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'accepted_total_zero';
  END IF;

  IF v_quote.freight_type = 'cost' THEN
    v_total := v_total + coalesce(v_quote.freight_cost, 0);
  END IF;

  v_total := public.ceil_money(v_total);
  v_fee := public.calculate_material_service_fee(v_total);
  IF v_fee < 1 AND v_total > 0 THEN
    v_fee := 1;
  END IF;

  UPDATE public.quotes
  SET status = 'accepted', updated_at = now()
  WHERE id = p_quote_id;

  INSERT INTO public.orders (
    quote_id,
    order_code,
    status,
    client_id,
    accepted_total,
    deposit_amount,
    deposit_status
  ) VALUES (
    p_quote_id,
    '',
    'pending_deposit',
    coalesce(v_req.client_id, v_quote.client_id, v_uid),
    v_total,
    v_fee,
    'pending'
  )
  RETURNING id INTO v_order_id;

  order_id := v_order_id;
  deposit_amount := v_fee;
  accepted_total := v_total;
  order_status := 'pending_deposit';
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_material_quote(uuid, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.accept_material_quote(uuid, uuid[]) IS
  'Acepta ítems de UN comercio (auto-reject del resto de ese quote). No afecta otros comercios. Crea orden + fee YaChanga.';

-- ---------------------------------------------------------------------------
-- 3) reject_material_quote: también marca ítems pending como rejected
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_material_quote(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;
  IF v_quote.status <> 'sent' THEN
    RAISE EXCEPTION 'quote_not_sent';
  END IF;

  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
  IF v_req.client_id IS DISTINCT FROM v_uid AND v_quote.client_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_client';
  END IF;

  UPDATE public.quote_items
  SET client_decision = 'rejected'
  WHERE quote_id = p_quote_id
    AND client_decision = 'pending';

  UPDATE public.quotes
  SET status = 'rejected', updated_at = now()
  WHERE id = p_quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_material_quote(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Chat: una sola tarjeta por request_id (upsert metadata + conteo comercios)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_material_quote_in_chat(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_total numeric := 0;
  v_msg_id uuid;
  v_body text;
  v_store_count int := 0;
  v_quote_count int := 0;
  v_existing_meta jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  IF NOT FOUND OR v_store.user_id <> v_uid THEN
    RAISE EXCEPTION 'not_store_owner';
  END IF;

  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
  IF NOT FOUND OR v_req.conversation_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_total
  FROM public.quote_items qi
  JOIN public.request_items ri ON ri.id = qi.request_item_id
  WHERE qi.quote_id = p_quote_id;

  IF v_quote.freight_type = 'cost' THEN
    v_total := v_total + coalesce(v_quote.freight_cost, 0);
  END IF;
  v_total := public.ceil_money(v_total);

  SELECT
    count(*)::int,
    count(DISTINCT store_id)::int
  INTO v_quote_count, v_store_count
  FROM public.quotes
  WHERE request_id = v_req.id
    AND status IN ('sent', 'accepted');

  v_body := format(
    'Hay %s cotizaci%s de materiales de %s comercio%s. Tocá para comparar.',
    v_quote_count,
    CASE WHEN v_quote_count = 1 THEN 'ón' ELSE 'ones' END,
    v_store_count,
    CASE WHEN v_store_count = 1 THEN '' ELSE 's' END
  );

  -- Reusar mensaje existente del mismo request (evitar N tarjetas).
  SELECT m.id, m.metadata
  INTO v_msg_id, v_existing_meta
  FROM public.messages m
  WHERE m.conversation_id = v_req.conversation_id
    AND m.type = 'quotation'
    AND coalesce(m.metadata->>'kind', '') = 'material_quote'
    AND (
      m.metadata->>'request_id' = v_req.id::text
      OR m.metadata->>'requestId' = v_req.id::text
      OR m.metadata->>'materialListId' = v_req.id::text
    )
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_msg_id IS NOT NULL THEN
    UPDATE public.messages
    SET
      body = v_body,
      metadata = (coalesce(v_existing_meta, '{}'::jsonb) - 'title') || jsonb_build_object(
        'kind', 'material_quote',
        'quote_id', v_quote.id,
        'request_id', v_req.id,
        'store_id', v_store.id,
        'store_name', 'Comercio (oculto hasta pagar el costo de servicio)',
        'total', v_total,
        'freight_type', v_quote.freight_type,
        'freight_cost', v_quote.freight_cost,
        'quoteCount', v_quote_count,
        'storeCount', v_store_count,
        'last_quote_id', v_quote.id
      )
    WHERE id = v_msg_id;

    -- Soft-hide duplicados viejos del mismo request (UI también dedupea).
    UPDATE public.messages
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('hidden', true, 'superseded_by', v_msg_id)
    WHERE conversation_id = v_req.conversation_id
      AND id <> v_msg_id
      AND type = 'quotation'
      AND coalesce(metadata->>'kind', '') = 'material_quote'
      AND (
        metadata->>'request_id' = v_req.id::text
        OR metadata->>'requestId' = v_req.id::text
        OR metadata->>'materialListId' = v_req.id::text
      )
      AND coalesce((metadata->>'hidden')::boolean, false) IS NOT TRUE;

    RETURN v_msg_id;
  END IF;

  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    body,
    type,
    metadata
  ) VALUES (
    v_req.conversation_id,
    v_uid,
    v_body,
    'quotation',
    jsonb_build_object(
      'kind', 'material_quote',
      'quote_id', v_quote.id,
      'request_id', v_req.id,
      'store_id', v_store.id,
      'store_name', 'Comercio (oculto hasta pagar el costo de servicio)',
      'total', v_total,
      'freight_type', v_quote.freight_type,
      'freight_cost', v_quote.freight_cost,
      'quoteCount', v_quote_count,
      'storeCount', v_store_count,
      'last_quote_id', v_quote.id
    )
  )
  RETURNING id INTO v_msg_id;

  RETURN v_msg_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_material_quote_in_chat(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.notify_material_quote_in_chat(uuid) IS
  'Una sola tarjeta material_quote por request_id en el chat; actualiza quoteCount/storeCount.';

-- Consolidar duplicados ya insertados (best-effort).
DO $$
DECLARE
  r record;
  v_keep uuid;
  v_store_count int;
  v_quote_count int;
  v_rid uuid;
BEGIN
  FOR r IN
    SELECT
      m.conversation_id,
      coalesce(
        nullif(m.metadata->>'request_id', ''),
        nullif(m.metadata->>'requestId', ''),
        nullif(m.metadata->>'materialListId', '')
      ) AS request_id,
      array_agg(m.id ORDER BY m.created_at DESC) AS msg_ids
    FROM public.messages m
    WHERE m.type = 'quotation'
      AND coalesce(m.metadata->>'kind', '') = 'material_quote'
      AND coalesce(m.metadata->>'hidden', 'false') NOT IN ('true', 't', '1')
      AND coalesce(
        nullif(m.metadata->>'request_id', ''),
        nullif(m.metadata->>'requestId', ''),
        nullif(m.metadata->>'materialListId', '')
      ) IS NOT NULL
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    v_keep := r.msg_ids[1];
    BEGIN
      v_rid := r.request_id::uuid;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;

    SELECT
      count(*)::int,
      count(DISTINCT store_id)::int
    INTO v_quote_count, v_store_count
    FROM public.quotes
    WHERE request_id = v_rid
      AND status IN ('sent', 'accepted');

    UPDATE public.messages
    SET
      body = format(
        'Hay %s cotizaci%s de materiales de %s comercio%s. Tocá para comparar.',
        greatest(coalesce(v_quote_count, 1), 1),
        CASE WHEN greatest(coalesce(v_quote_count, 1), 1) = 1 THEN 'ón' ELSE 'ones' END,
        greatest(coalesce(v_store_count, 1), 1),
        CASE WHEN greatest(coalesce(v_store_count, 1), 1) = 1 THEN '' ELSE 's' END
      ),
      metadata = (coalesce(metadata, '{}'::jsonb) - 'title')
        || jsonb_build_object(
          'kind', 'material_quote',
          'request_id', v_rid,
          'quoteCount', greatest(coalesce(v_quote_count, 1), 1),
          'storeCount', greatest(coalesce(v_store_count, 1), 1)
        )
    WHERE id = v_keep;

    UPDATE public.messages
    SET metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('hidden', true, 'superseded_by', v_keep)
    WHERE id = ANY (r.msg_ids[2:array_length(r.msg_ids, 1)]);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Auto-reject cotizaciones sin finalizar a las 72h
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_stale_material_quotes(
  p_max_age interval DEFAULT interval '72 hours'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stale AS (
    SELECT q.id
    FROM public.quotes q
    WHERE q.status = 'sent'
      AND q.created_at < now() - p_max_age
    FOR UPDATE OF q SKIP LOCKED
  ),
  upd_items AS (
    UPDATE public.quote_items qi
    SET client_decision = 'rejected'
    WHERE qi.quote_id IN (SELECT id FROM stale)
      AND qi.client_decision = 'pending'
    RETURNING qi.quote_id
  ),
  upd_quotes AS (
    UPDATE public.quotes q
    SET status = 'rejected', updated_at = now()
    WHERE q.id IN (SELECT id FROM stale)
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_count FROM upd_quotes;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_stale_material_quotes(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_stale_material_quotes(interval) TO service_role;

COMMENT ON FUNCTION public.reject_stale_material_quotes(interval) IS
  'Rechaza quotes materiales en status sent con antigüedad >= p_max_age (default 72h). '
  'Invocar con service_role. Si el proyecto tiene pg_cron: '
  'SELECT cron.schedule(''reject-stale-material-quotes'', ''15 * * * *'', '
  '$$SELECT public.reject_stale_material_quotes();$$); '
  'Si no hay pg_cron: Edge Function / job externo periódico con service role.';
