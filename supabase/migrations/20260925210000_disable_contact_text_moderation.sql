-- Ticket #85: la moderación anti-contacto queda desactivada a propósito.
-- Falsos positivos (cinta, cable, charla de trabajo) bloqueaban texto libre.
-- Se rediseña más adelante. No queda una versión más laxa del mismo filtro.
-- Siguen vigentes: auth del remitente, bloqueo entre usuarios, rate limit,
-- reglas de imagen y largo máximo del mensaje.

CREATE OR REPLACE FUNCTION public.contact_info_blocked_reason(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Contact-sharing mitigation intentionally disabled pending a redesign.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.contact_info_blocked_reason(TEXT) IS
  'Desactivada (2026-09-25): no rechaza texto por teléfono, mail o dirección. Siempre NULL.';

CREATE OR REPLACE FUNCTION public.message_body_blocked_reason(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.message_body_blocked_reason(TEXT) IS
  'Desactivada (2026-09-25): el chat ya no rechaza el cuerpo por datos de contacto.';

CREATE OR REPLACE FUNCTION public.enforce_post_description_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_quote_service_detail_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_message_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INT;
  blocked_pair BOOLEAN;
  image_url TEXT;
BEGIN
  -- System events (pagos, hitos, cierre de reclamo): no exigir JWT = sender
  IF coalesce(NEW.type, 'text') = 'system' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND (
          c.cliente_id = NEW.sender_id
          OR c.trabajador_id = NEW.sender_id
        )
    ) THEN
      RAISE EXCEPTION 'system_sender_not_participant' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF public.chat_cerrado_por_reclamo_conformidad(NEW.conversation_id) THEN
    RAISE EXCEPTION 'chat_cerrado_por_reclamo' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'sender_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.user_blocks b ON (
      (b.blocker_id = c.cliente_id AND b.blocked_id = c.trabajador_id)
      OR (b.blocker_id = c.trabajador_id AND b.blocked_id = c.cliente_id)
    )
    WHERE c.id = NEW.conversation_id
  ) INTO blocked_pair;

  IF blocked_pair THEN
    RAISE EXCEPTION 'user_blocked' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::int INTO recent_count
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '1 minute';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(NEW.type, 'text') = 'image' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND c.cliente_id = NEW.sender_id
    ) THEN
      RAISE EXCEPTION 'image_client_only' USING ERRCODE = 'P0001';
    END IF;

    image_url := nullif(trim(coalesce(NEW.metadata->>'image_url', '')), '');
    IF image_url IS NULL OR image_url !~* '^https?://' THEN
      RAISE EXCEPTION 'image_url_required' USING ERRCODE = 'P0001';
    END IF;

    IF char_length(coalesce(NEW.body, '')) > 2000 THEN
      RAISE EXCEPTION 'message_too_long' USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
  END IF;

  IF coalesce(NEW.type, 'text') <> 'text' THEN
    RETURN NEW;
  END IF;

  -- Sin filtro anti-contacto: el cuerpo de texto libre se acepta.

  IF char_length(coalesce(NEW.body, '')) > 2000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.moderation_extract_digits(TEXT);
DROP FUNCTION IF EXISTS public.moderation_count_number_words(TEXT);
DROP FUNCTION IF EXISTS public.moderation_has_phone_locality_hint(TEXT);
DROP FUNCTION IF EXISTS public.moderation_sum_split_digit_groups(TEXT);
