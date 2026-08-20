-- Anti-evasión: números escritos en palabras ("seis siete noventa" + dígitos mezclados)

CREATE OR REPLACE FUNCTION public.moderation_extract_digits(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t TEXT;
BEGIN
  t := public.normalize_message_body(p_text);
  IF t = '' THEN
    RETURN '';
  END IF;

  -- Más largas primero
  t := regexp_replace(t, '\mdiecisiete\M', '17', 'gi');
  t := regexp_replace(t, '\mdieciseis\M', '16', 'gi');
  t := regexp_replace(t, '\mdieciocho\M', '18', 'gi');
  t := regexp_replace(t, '\mdiecinueve\M', '19', 'gi');
  t := regexp_replace(t, '\mnoventa\M', '90', 'gi');
  t := regexp_replace(t, '\mochenta\M', '80', 'gi');
  t := regexp_replace(t, '\msetenta\M', '70', 'gi');
  t := regexp_replace(t, '\msesenta\M', '60', 'gi');
  t := regexp_replace(t, '\mcincuenta\M', '50', 'gi');
  t := regexp_replace(t, '\mcuarenta\M', '40', 'gi');
  t := regexp_replace(t, '\mtreinta\M', '30', 'gi');
  t := regexp_replace(t, '\mveinte\M', '20', 'gi');
  t := regexp_replace(t, '\mquince\M', '15', 'gi');
  t := regexp_replace(t, '\mcatorce\M', '14', 'gi');
  t := regexp_replace(t, '\mtrece\M', '13', 'gi');
  t := regexp_replace(t, '\mdoce\M', '12', 'gi');
  t := regexp_replace(t, '\monce\M', '11', 'gi');
  t := regexp_replace(t, '\mdiez\M', '10', 'gi');
  t := regexp_replace(t, '\mciento\M', '100', 'gi');
  t := regexp_replace(t, '\mcien\M', '100', 'gi');
  t := regexp_replace(t, '\mmil\M', '1000', 'gi');
  t := regexp_replace(t, '\mcero\M', '0', 'gi');
  t := regexp_replace(t, '\mdos\M', '2', 'gi');
  t := regexp_replace(t, '\mtres\M', '3', 'gi');
  t := regexp_replace(t, '\mcuatro\M', '4', 'gi');
  t := regexp_replace(t, '\mcinco\M', '5', 'gi');
  t := regexp_replace(t, '\mseis\M', '6', 'gi');
  t := regexp_replace(t, '\msiete\M', '7', 'gi');
  t := regexp_replace(t, '\mocho\M', '8', 'gi');
  t := regexp_replace(t, '\mnueve\M', '9', 'gi');

  RETURN regexp_replace(t, '[^0-9]', '', 'g');
END;
$$;

CREATE OR REPLACE FUNCTION public.moderation_count_number_words(p_text TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(count(*)::int, 0)
  FROM regexp_matches(
    public.normalize_message_body(p_text),
    '\y(cero|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|mil)\y',
    'gi'
  ) AS _m;
$$;

CREATE OR REPLACE FUNCTION public.contact_info_blocked_reason(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t TEXT;
  digits TEXT;
  word_count INT;
BEGIN
  t := public.normalize_message_body(p_text);
  IF t = '' THEN
    RETURN NULL;
  END IF;

  digits := public.moderation_extract_digits(p_text);

  IF length(digits) >= 8 THEN
    RETURN 'telefono_num';
  END IF;

  word_count := public.moderation_count_number_words(p_text);
  IF word_count >= 4 THEN
    RETURN 'telefono_palabras';
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
