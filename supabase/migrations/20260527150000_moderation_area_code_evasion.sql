-- Moderación ampliada: 6+ dígitos, característica/localidad, números en palabras
-- Ej.: "312302", "Característica de San Nicolás y 312302", "seis siete noventa"

CREATE OR REPLACE FUNCTION public.moderation_has_phone_locality_hint(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t TEXT;
  loc TEXT;
  localities TEXT[] := ARRAY[
    'san nicolas', 'san martin', 'venado tuerto', 'mar del plata', 'bahia blanca',
    'la plata', 'necochea', 'tandil', 'olavarria', 'azul', 'pergamino', 'junin',
    'chivilcoy', 'mercedes', 'lujan', 'moron', 'san isidro', 'tigre', 'pilar',
    'escobar', 'campana', 'zarate', 'rosario', 'rafaela', 'santa fe', 'parana',
    'concordia', 'corrientes', 'posadas', 'resistencia', 'formosa', 'salta',
    'tucuman', 'santiago del estero', 'la rioja', 'catamarca', 'san juan',
    'san luis', 'mendoza', 'san rafael', 'neuquen', 'comodoro rivadavia',
    'rio gallegos', 'ushuaia', 'cordoba', 'villa maria', 'rio cuarto',
    'capital federal', 'caba', 'buenos aires'
  ];
BEGIN
  t := public.normalize_message_body(p_text);
  FOREACH loc IN ARRAY localities LOOP
    IF strpos(t, loc) > 0 THEN
      RETURN TRUE;
    END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderation_sum_split_digit_groups(p_text TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t TEXT;
  parts TEXT[];
  part TEXT;
  total INT := 0;
BEGIN
  t := public.normalize_message_body(p_text);
  IF t = '' OR t !~ '\s+(y|e)\s+' THEN
    RETURN 0;
  END IF;

  parts := regexp_split_to_array(t, '\s+(?:y|e)\s+');
  IF coalesce(array_length(parts, 1), 0) < 2 THEN
    RETURN 0;
  END IF;

  FOREACH part IN ARRAY parts LOOP
    total := total + length(regexp_replace(part, '[^0-9]', '', 'g'));
  END LOOP;

  RETURN total;
END;
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
  split_sum INT;
  area_hint BOOLEAN;
BEGIN
  t := public.normalize_message_body(p_text);
  IF t = '' THEN
    RETURN NULL;
  END IF;

  digits := public.moderation_extract_digits(p_text);

  -- 6+ dígitos seguidos o en total (tras normalizar palabras-número)
  IF t ~ '[0-9]{6,}' OR length(digits) >= 6 THEN
    RETURN 'telefono_num';
  END IF;

  area_hint := t ~ '\y(caracteristica|caracteristicas|codigo de area|prefijo|prefijo telefonico|clave telefonica|numero de area|nro de area|area telefonica)\y';

  IF area_hint AND length(digits) >= 4 THEN
    RETURN 'telefono_caracteristica';
  END IF;

  IF public.moderation_has_phone_locality_hint(p_text) AND length(digits) >= 5 THEN
    RETURN 'telefono_localidad';
  END IF;

  split_sum := public.moderation_sum_split_digit_groups(p_text);
  IF split_sum >= 6 AND t ~ '\s+(y|e)\s+' THEN
    RETURN 'telefono_partido';
  END IF;

  IF area_hint AND split_sum >= 4 THEN
    RETURN 'telefono_caracteristica';
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
