-- YaChanga — No filtrar datos del comercio en el aviso de cotización de materiales.
-- Nombre / dirección se revelan solo tras pagar seña (get_material_order_reveal / UI).

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
    RETURN NULL; -- sin chat vinculado: ok silencioso
  END IF;

  SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_total
  FROM public.quote_items qi
  JOIN public.request_items ri ON ri.id = qi.request_item_id
  WHERE qi.quote_id = p_quote_id;

  IF v_quote.freight_type = 'cost' THEN
    v_total := v_total + coalesce(v_quote.freight_cost, 0);
  END IF;
  v_total := public.ceil_money(v_total);

  -- Sin nombre del comercio: se revela al pagar la seña.
  v_body := format(
    'Nuevo presupuesto de materiales: %s. Tocá para ver el detalle (el comercio se revela al pagar la seña).',
    to_char(v_total, 'FM$999G999G990')
  );

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
      'store_name', 'Comercio (oculto hasta pagar seña)',
      'total', v_total,
      'freight_type', v_quote.freight_type,
      'freight_cost', v_quote.freight_cost,
      'title', v_req.title
    )
  )
  RETURNING id INTO v_msg_id;

  RETURN v_msg_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_material_quote_in_chat(uuid) TO authenticated, service_role;
