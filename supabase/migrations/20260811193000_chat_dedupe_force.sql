-- =============================================================================
-- Force repair: 1 conversación ACTIVA por par (cliente_id, trabajador_id)
--
-- Consolida cualquier par con >1 hilo deleted_at IS NULL: soft-delete + hide
-- ambos participantes en todos menos el más reciente (updated_at, luego id).
-- Idempotente: seguro re-aplicar tras 190/192.
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_unique_pair;

DROP INDEX IF EXISTS ux_conversations_active_pair;

CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at
  ON public.conversations (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Soft-delete + hide ambos (mismo contrato que 192)
CREATE OR REPLACE FUNCTION public.hide_conversation_for_participants(
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  ts timestamptz := now();
BEGIN
  SELECT c.cliente_id, c.trabajador_id
    INTO v_cliente, v_trabajador
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF v_cliente IS NULL OR v_trabajador IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.conversations
  SET deleted_at = coalesce(deleted_at, ts),
      updated_at = ts
  WHERE id = p_conversation_id;

  INSERT INTO public.conversation_hides (conversation_id, user_id, hidden_at)
  VALUES
    (p_conversation_id, v_cliente, ts),
    (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET hidden_at = EXCLUDED.hidden_at;

  INSERT INTO public.conversation_reads (conversation_id, user_id, read_at)
  VALUES
    (p_conversation_id, v_cliente, ts),
    (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET read_at = EXCLUDED.read_at;
END;
$$;

REVOKE ALL ON FUNCTION public.hide_conversation_for_participants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hide_conversation_for_participants(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hide_conversation(
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.cliente_id = uid OR c.trabajador_id = uid)
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  -- Idempotente: si ya estaba soft-deleted, igual asegura hides de ambos.
  PERFORM public.hide_conversation_for_participants(p_conversation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.hide_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hide_conversation(uuid) TO authenticated, service_role;

-- 1) Cualquier hide → soft-delete
UPDATE public.conversations c
SET deleted_at = coalesce(c.deleted_at, h.hidden_at),
    updated_at = greatest(c.updated_at, h.hidden_at)
FROM (
  SELECT conversation_id, min(hidden_at) AS hidden_at
  FROM public.conversation_hides
  GROUP BY conversation_id
) h
WHERE c.id = h.conversation_id
  AND c.deleted_at IS NULL;

-- 2) Soft-deleted → hide ambos
INSERT INTO public.conversation_hides (conversation_id, user_id, hidden_at)
SELECT c.id, c.cliente_id, coalesce(c.deleted_at, now())
FROM public.conversations c
WHERE c.deleted_at IS NOT NULL
ON CONFLICT (conversation_id, user_id) DO NOTHING;

INSERT INTO public.conversation_hides (conversation_id, user_id, hidden_at)
SELECT c.id, c.trabajador_id, coalesce(c.deleted_at, now())
FROM public.conversations c
WHERE c.deleted_at IS NOT NULL
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- 3) Fuerza: por cada par con >1 activo, cerrar todos menos el más reciente
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.id
    FROM public.conversations c
    INNER JOIN (
      SELECT
        cliente_id,
        trabajador_id,
        (array_agg(id ORDER BY updated_at DESC NULLS LAST, id DESC))[1] AS keep_id
      FROM public.conversations
      WHERE deleted_at IS NULL
      GROUP BY cliente_id, trabajador_id
      HAVING count(*) > 1
    ) d ON d.cliente_id = c.cliente_id
       AND d.trabajador_id = c.trabajador_id
    WHERE c.deleted_at IS NULL
      AND c.id <> d.keep_id
  LOOP
    PERFORM public.hide_conversation_for_participants(r.id);
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX ux_conversations_active_pair
  ON public.conversations (cliente_id, trabajador_id)
  WHERE deleted_at IS NULL;

-- find_or_create: cierra TODOS los activos del par antes de insertar uno nuevo
CREATE OR REPLACE FUNCTION public.find_or_create_conversation(
  p_trabajador_id uuid,
  p_primary_trade text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid := auth.uid();
  v_id uuid;
  v_trade text;
  v_blocked boolean;
  r record;
BEGIN
  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF v_cliente_id = p_trabajador_id THEN
    RAISE EXCEPTION 'invalid_peer';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks b
    WHERE (b.blocker_id = v_cliente_id AND b.blocked_id = p_trabajador_id)
       OR (b.blocker_id = p_trabajador_id AND b.blocked_id = v_cliente_id)
  ) INTO v_blocked;

  IF v_blocked THEN
    RAISE EXCEPTION 'user_blocked' USING ERRCODE = 'P0001';
  END IF;

  v_trade := nullif(trim(coalesce(p_primary_trade, '')), '');

  SELECT c.id INTO v_id
  FROM public.conversations c
  WHERE c.cliente_id = v_cliente_id
    AND c.trabajador_id = p_trabajador_id
    AND c.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_hides h
      WHERE h.conversation_id = c.id
    )
  ORDER BY c.updated_at DESC NULLS LAST, c.id DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Defensa: si hay otros activos del mismo par, cerrarlos
    FOR r IN
      SELECT c.id
      FROM public.conversations c
      WHERE c.cliente_id = v_cliente_id
        AND c.trabajador_id = p_trabajador_id
        AND c.deleted_at IS NULL
        AND c.id <> v_id
    LOOP
      PERFORM public.hide_conversation_for_participants(r.id);
    END LOOP;
    RETURN v_id;
  END IF;

  FOR r IN
    SELECT c.id
    FROM public.conversations c
    WHERE c.cliente_id = v_cliente_id
      AND c.trabajador_id = p_trabajador_id
      AND c.deleted_at IS NULL
  LOOP
    PERFORM public.hide_conversation_for_participants(r.id);
  END LOOP;

  INSERT INTO public.conversations (cliente_id, trabajador_id, primary_trade, updated_at)
  VALUES (v_cliente_id, p_trabajador_id, v_trade, now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_conversation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(uuid, text) TO authenticated, service_role;
