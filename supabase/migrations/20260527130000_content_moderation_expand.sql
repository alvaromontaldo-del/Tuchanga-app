-- Moderación anti-contacto ampliada (alineada con src/utils/contactModeration.ts)
-- Aplica a: messages.body, posts.description, chat_quotes.service_detail

-- ---------------------------------------------------------------------------
-- Función compartida
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contact_info_blocked_reason(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t TEXT;
  digits TEXT;
BEGIN
  t := public.normalize_message_body(p_text);
  IF t = '' THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(t, '[^0-9]', '', 'g');

  IF digits ~ '[0-9]{8,}' THEN
    RETURN 'telefono_num';
  END IF;

  IF t ~ '\y(whatsapp|whats\s*app|wsp|wp|wap|wa)\y' THEN
    RETURN 'whatsapp';
  END IF;
  IF t ~ '\y(facebook|face\s*book|fb|meta)\y' THEN
    RETURN 'facebook';
  END IF;
  IF t ~ '\y(instagram|insta|ig)\y' THEN
    RETURN 'redes';
  END IF;
  IF t ~ '\y(correo|correos|email|e-?mail|mail)\y' THEN
    RETURN 'email';
  END IF;
  IF position('@' IN t) > 0 THEN
    RETURN 'email_arroba';
  END IF;
  IF t ~ '\y(cel(ular|u)?|tel|telefono|telefonos|phone|contacto|llamar|llamame)\y' THEN
    RETURN 'contacto';
  END IF;
  IF t ~ '\y(direccion|address|calle|avenida|av\.?|numero|nro)\y' THEN
    RETURN 'direccion';
  END IF;
  IF t ~ '\y(url|link|enlace|http|https|www)\y' THEN
    RETURN 'url';
  END IF;
  IF t ~ '\ypunto\s*(com|net|org|ar)\y' OR t ~ '\.(com|net|org|ar|io|me|app)\y' THEN
    RETURN 'link';
  END IF;

  RETURN NULL;
END;
$$;

-- Alias usado por el trigger de mensajes (compatibilidad)
CREATE OR REPLACE FUNCTION public.message_body_blocked_reason(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.contact_info_blocked_reason(p_text);
$$;

-- ---------------------------------------------------------------------------
-- posts.description
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_post_description_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  block_reason TEXT;
BEGIN
  block_reason := public.contact_info_blocked_reason(NEW.description);
  IF block_reason IS NOT NULL THEN
    RAISE EXCEPTION 'content_blocked_contact' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_enforce_description ON public.posts;
CREATE TRIGGER trg_posts_enforce_description
  BEFORE INSERT OR UPDATE OF description ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_post_description_rules();

-- ---------------------------------------------------------------------------
-- chat_quotes.service_detail
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_quote_service_detail_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  block_reason TEXT;
BEGIN
  IF coalesce(trim(NEW.service_detail), '') = '' THEN
    RETURN NEW;
  END IF;

  block_reason := public.contact_info_blocked_reason(NEW.service_detail);
  IF block_reason IS NOT NULL THEN
    RAISE EXCEPTION 'content_blocked_contact' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_quotes_enforce_detail ON public.chat_quotes;
CREATE TRIGGER trg_chat_quotes_enforce_detail
  BEFORE INSERT OR UPDATE OF service_detail ON public.chat_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quote_service_detail_rules();
