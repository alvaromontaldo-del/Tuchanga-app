-- =============================================================================
-- Repair: inbox duplicado (vieja + nueva) tras soft-delete / recontacto
--
-- Causa típica:
--   - hide legacy solo ocultaba para 1 usuario (conversation_hides) sin deleted_at
--   - find_or_create creaba hilo nuevo tras dropear UNIQUE duro, pero no cerraba
--     TODOS los hilos activos del par → el otro participante seguía viendo la vieja
--
-- Modelo: 1 hilo ACTIVO por par (cliente_id, trabajador_id). Soft-deleted no inbox.
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_unique_pair;

-- Quitar índice parcial si existe: hay que reparar duplicados ANTES de recrearlo.
DROP INDEX IF EXISTS ux_conversations_active_pair;

CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at
  ON public.conversations (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Soft-delete + hide AMBOS participantes
-- ---------------------------------------------------------------------------
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
      AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  PERFORM public.hide_conversation_for_participants(p_conversation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.hide_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hide_conversation(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill / repair de datos inconsistentes (ANTES del UNIQUE parcial)
-- ---------------------------------------------------------------------------

-- 1) Cualquier hide (aunque sea de un solo usuario) → soft-delete del hilo
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

-- 2) Soft-deleted sin hide de ambos → completar hides
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

-- 3) Duplicados activos del mismo par: conservar el más reciente, soft-delete el resto
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.id
    FROM public.conversations c
    INNER JOIN (
      SELECT cliente_id, trabajador_id, max(updated_at) AS keep_updated
      FROM public.conversations
      WHERE deleted_at IS NULL
      GROUP BY cliente_id, trabajador_id
      HAVING count(*) > 1
    ) d ON d.cliente_id = c.cliente_id
       AND d.trabajador_id = c.trabajador_id
    WHERE c.deleted_at IS NULL
      AND c.updated_at < d.keep_updated
  LOOP
    PERFORM public.hide_conversation_for_participants(r.id);
  END LOOP;

  -- Empates de updated_at: dejar 1 por id lexicográficamente mayor
  FOR r IN
    SELECT c.id
    FROM public.conversations c
    INNER JOIN (
      SELECT cliente_id, trabajador_id, max(id::text) AS keep_id
      FROM public.conversations
      WHERE deleted_at IS NULL
      GROUP BY cliente_id, trabajador_id
      HAVING count(*) > 1
    ) d ON d.cliente_id = c.cliente_id
       AND d.trabajador_id = c.trabajador_id
    WHERE c.deleted_at IS NULL
      AND c.id::text <> d.keep_id
  LOOP
    PERFORM public.hide_conversation_for_participants(r.id);
  END LOOP;
END;
$$;

-- Ahora sí: 1 activo por par
CREATE UNIQUE INDEX ux_conversations_active_pair
  ON public.conversations (cliente_id, trabajador_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- find_or_create: reutiliza 1 activo; si no, cierra TODOS los activos del par
-- y crea hilo nuevo. Soft-deleted / ocultos NUNCA vuelven al inbox.
-- ---------------------------------------------------------------------------
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

  -- Hilo usable: activo y sin hides (hide = cerrado para ambos).
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
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Cerrar CUALQUIER activo restante del par (legacy hide unilateral, huérfanos, races).
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

-- Unread: excluir soft-deleted + hidden
CREATE OR REPLACE FUNCTION public.get_total_unread_count()
RETURNS integer
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

  RETURN (
    WITH my_convs AS (
      SELECT id
      FROM public.conversations
      WHERE (cliente_id = uid OR trabajador_id = uid)
        AND deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.conversation_hides h
          WHERE h.conversation_id = conversations.id
            AND h.user_id = uid
        )
    ),
    reads AS (
      SELECT conversation_id, read_at
      FROM public.conversation_reads
      WHERE user_id = uid
    )
    SELECT COUNT(*)::int
    FROM public.messages m
    JOIN my_convs c ON c.id = m.conversation_id
    LEFT JOIN reads r ON r.conversation_id = m.conversation_id
    WHERE m.sender_id <> uid
      AND m.created_at > COALESCE(r.read_at, '1970-01-01'::timestamptz)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_total_unread_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_total_unread_count() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_unread_counts(
  p_conversation_ids uuid[]
)
RETURNS TABLE (
  conversation_id uuid,
  unread_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  WITH my_convs AS (
    SELECT c.id
    FROM public.conversations c
    WHERE c.id = ANY(p_conversation_ids)
      AND (c.cliente_id = uid OR c.trabajador_id = uid)
      AND c.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.conversation_hides h
        WHERE h.conversation_id = c.id
          AND h.user_id = uid
      )
  ),
  reads AS (
    SELECT cr.conversation_id, cr.read_at
    FROM public.conversation_reads cr
    WHERE cr.user_id = uid
      AND cr.conversation_id IN (SELECT id FROM my_convs)
  )
  SELECT
    m.conversation_id,
    COUNT(*)::int AS unread_count
  FROM public.messages m
  JOIN my_convs mc ON mc.id = m.conversation_id
  LEFT JOIN reads r ON r.conversation_id = m.conversation_id
  WHERE m.sender_id <> uid
    AND m.created_at > COALESCE(r.read_at, '1970-01-01'::timestamptz)
  GROUP BY m.conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unread_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_counts(uuid[]) TO authenticated, service_role;
