-- Antipuenteo, primera capa. NO APLICADO.
-- Reemplaza el rechazo por palabra y por message_blocked_contact:
-- el dato se cambia por ••• y el envío sigue.
-- Cuerpos vivos (pg_get_functiondef, 2026-10-09, kyxehrxcdealbujvvnxp):
--   contact_info_blocked_reason(text)
--   enforce_message_rules()
--   enforce_quote_service_detail_rules()
--   recotizar_en_curso(uuid, numeric, text)
-- No se tocan los guards (sender, bloqueo, rate limit, imagen, largo,
-- system_sender_not_participant, chat_cerrado_por_reclamo).
-- Los mensajes type=system no se escanean (disputa, recotización, PIN, pagos).
--
-- Dejó de rechazar el texto por estas palabras sueltas:
--   direccion, ubicacion, telefono, telefonos, celular, cel, contacto, llamar, llamame,
--   whatsapp, wsp, wp, facebook, instagram, insta, mail, email, correo,
--   calle, avenida, av, numero, nro, url, link, enlace, http, www, meta.
-- Esas palabras solas ya no traban el chat ni la cotización.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$roles$;

CREATE OR REPLACE FUNCTION public._offplatform_fold(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(translate(
    coalesce(p_text, ''),
    'áàäâãåéèëêíìïîóòöôõúùüûñÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ',
    'aaaaaaeeeeiiiiooooouuuunaaaaaaeeeeiiiiooooouuuun'
  ));
$$;

CREATE OR REPLACE FUNCTION public._offplatform_overlaps(
  p_s int,
  p_e int,
  p_starts int[],
  p_ends int[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(coalesce(p_starts, '{}'::int[]), coalesce(p_ends, '{}'::int[])) AS u(s, e)
    WHERE p_s < u.e AND u.s < p_e
  );
$$;

CREATE OR REPLACE FUNCTION public._offplatform_phone_digits(p_chunk text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := public._offplatform_fold(coalesce(p_chunk, ''));
BEGIN
  v := regexp_replace(v, '\yveintinueve\y', '29', 'g');
  v := regexp_replace(v, '\yveintiocho\y', '28', 'g');
  v := regexp_replace(v, '\yveintisiete\y', '27', 'g');
  v := regexp_replace(v, '\yveintiseis\y', '26', 'g');
  v := regexp_replace(v, '\yveinticinco\y', '25', 'g');
  v := regexp_replace(v, '\yveinticuatro\y', '24', 'g');
  v := regexp_replace(v, '\yveintitres\y', '23', 'g');
  v := regexp_replace(v, '\yveintidos\y', '22', 'g');
  v := regexp_replace(v, '\yveintiuno\y', '21', 'g');
  v := regexp_replace(v, '\ydiecinueve\y', '19', 'g');
  v := regexp_replace(v, '\ydieciocho\y', '18', 'g');
  v := regexp_replace(v, '\ydiecisiete\y', '17', 'g');
  v := regexp_replace(v, '\ydieciseis\y', '16', 'g');
  v := regexp_replace(v, '\ycuatro\y', '4', 'g');
  v := regexp_replace(v, '\ycatorce\y', '14', 'g');
  v := regexp_replace(v, '\ycincuenta\y', '50', 'g');
  v := regexp_replace(v, '\ycuarenta\y', '40', 'g');
  v := regexp_replace(v, '\ytreinta\y', '30', 'g');
  v := regexp_replace(v, '\yquince\y', '15', 'g');
  v := regexp_replace(v, '\yochenta\y', '80', 'g');
  v := regexp_replace(v, '\ysetenta\y', '70', 'g');
  v := regexp_replace(v, '\ysesenta\y', '60', 'g');
  v := regexp_replace(v, '\ynueve\y', '9', 'g');
  v := regexp_replace(v, '\yocho\y', '8', 'g');
  v := regexp_replace(v, '\ysiete\y', '7', 'g');
  v := regexp_replace(v, '\yseis\y', '6', 'g');
  v := regexp_replace(v, '\ycinco\y', '5', 'g');
  v := regexp_replace(v, '\ytrece\y', '13', 'g');
  v := regexp_replace(v, '\ytres\y', '3', 'g');
  v := regexp_replace(v, '\ydoce\y', '12', 'g');
  v := regexp_replace(v, '\ydiez\y', '10', 'g');
  v := regexp_replace(v, '\ydos\y', '2', 'g');
  v := regexp_replace(v, '\yuno\y', '1', 'g');
  v := regexp_replace(v, '\yuna\y', '1', 'g');
  v := regexp_replace(v, '\yun\y', '1', 'g');
  v := regexp_replace(v, '\yonce\y', '11', 'g');
  v := regexp_replace(v, '\yveinte\y', '20', 'g');
  v := regexp_replace(v, '\ycero\y', '0', 'g');
  v := regexp_replace(v, '\ynoventa\y', '90', 'g');
  RETURN length(regexp_replace(v, '[^0-9]', '', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION public.redact_offplatform_contact(p_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  src text := coalesce(p_text, '');
  folded text;
  ig_s int[] := '{}';
  ig_e int[] := '{}';
  sp_s int[] := '{}';
  sp_e int[] := '{}';
  sp_k text[] := '{}';
  patterns text[];
  pat text;
  pos int;
  s int;
  e int;
  frag text;
  digits text;
  name text;
  words text[];
  word text;
  ok boolean;
  cursor_pos int;
  out_text text;
  kinds text[] := '{}';
  rec record;
  idx int;
  kind text;
  left_side text;
  right_side text;
  side_words text[];
  side_word text;
  left_bad boolean;
  right_bad boolean;
  pk text[];
  pr text[];
  numword text := 'cero|uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintitres|veinticuatro|veinticinco|veintiseis|veintisiete|veintiocho|veintinueve|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa';
  unit_after text := 'mm|cm|mts?|metros?|metro|kg|kgs|kilos?|bolsas?|unidades?|cajas?|chapas?|hs|hora|horas|pesos?|mil|millones|m2|m';
  stop_words text[] := ARRAY[
    'mm','cm','m','mt','mts','metro','metros','kg','kgs','kilo','kilos','bolsa','bolsas',
    'caja','cajas','chapa','chapas','mil','millones','peso','pesos','hora','horas','dia','dias',
    'cinta','cable','calor','cemento','arena','cal','pintura','manguera','tornillo','tornillos',
    'item','codigo','total','precio','mano','obra','mail','whatsapp','foto','chat','pin','pago',
    'hola','gracias','bueno','pedido','cuesta','vale','mayo','junio','julio','enero','febrero',
    'marzo','abril','agosto','septiembre','octubre','noviembre','diciembre','lunes','martes',
    'miercoles','jueves','viernes','sabado','domingo','direccion','ubicacion','telefono','contacto'
  ];
BEGIN
  IF src = '' THEN
    RETURN jsonb_build_object('text', '', 'kinds', '[]'::jsonb);
  END IF;
  folded := public._offplatform_fold(src);

  patterns := ARRAY[
    '\$\s*[0-9]{1,3}(?:[.\s][0-9]{3})+(?:[.,][0-9]{1,2})?',
    '\$\s*[0-9]+(?:[.,][0-9]{1,2})?',
    '\y[0-9]{1,3}(?:\.[0-9]{3})+(?:[.,][0-9]{1,2})?\y',
    '\y[0-9]+(?:[.,][0-9]+)?\s*(?:mil|millones|pesos|peso|ars)\y',
    '\y[0-9]+(?:[.,][0-9]+)?\s*[x×]\s*[0-9]+(?:[.,][0-9]+)?(?:\s*(?:m|mm|cm|mts?|metros?|m2))?',
    '\y[0-9]+(?:[.,][0-9]+)?\s*(?:mm|cm|mts|mt|metros|metro|kg|kgs|kilos|kilo|grs?|gramos|lts|litros|litro|pulg|unidades|unidad|bolsas|bolsa|cajones|cajon|cajas|caja|chapas|chapa|baldosas|baldosa|ladrillos|ladrillo|rollos|rollo|varillas|varilla|tiras|tira|placas|placa|tubos|tubo|canos|cano)\y',
    '\y[0-9]{1,2}:[0-9]{2}\y',
    '\y[0-9]{1,2}\s*(?:hs|h)\y',
    '\y[0-9]{1,2}\s+a\s+[0-9]{1,2}(?:\s*hs)?\y',
    '\y[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}\y',
    '\y[0-9]{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+[0-9]{4})?\y'
  ];
  FOREACH pat IN ARRAY patterns LOOP
    pos := 1;
    LOOP
      s := regexp_instr(folded, pat, pos, 1, 0);
      EXIT WHEN s = 0;
      e := regexp_instr(folded, pat, pos, 1, 1);
      EXIT WHEN e <= s;
      ig_s := ig_s || s;
      ig_e := ig_e || e;
      pos := e;
    END LOOP;
  END LOOP;

  pk := ARRAY[
    'email', 'email', 'url', 'url', 'url', 'usuario', 'codigo',
    'direccion', 'direccion', 'direccion', 'direccion', 'direccion', 'direccion',
    'direccion', 'direccion', 'direccion', 'direccion', 'direccion', 'direccion',
    'direccion', 'direccion', 'direccion'
  ];
  pr := ARRAY[
    '\y[a-z0-9][a-z0-9._%+-]{0,40}@[a-z0-9][a-z0-9.-]{0,40}\.[a-z]{2,}\y',
    '\y[a-z0-9][a-z0-9._%+-]{0,40}\s*(?:@|\(arroba\)|\[arroba\]|arroba)\s*[a-z0-9][a-z0-9-]{1,40}\s*(?:\.|\(punto\)|punto)\s*[a-z]{2,}(?:\s*(?:\.|punto)\s*[a-z]{2})?\y',
    '\y(?:https?://|www\.)[^\s<>()]+',
    '\y(?:wa\.me|maps\.google|goo\.gl|maps\.app\.goo\.gl|instagram\.com|facebook\.com|fb\.com|fb\.me|t\.me|telegram\.me|bit\.ly|youtu\.be|waze\.com|google\.com/maps|maps\.apple\.com)(?:/[^\s<>()]*)?',
    '\y[a-z0-9][a-z0-9-]{0,40}\.(?:com|net|org|app|io|me|gl|ly|ar)(?:\.[a-z]{2})?(?:/[^\s<>()]*)?',
    '(?<![a-z0-9._%+-])@[a-z0-9._]{3,30}\y',
    '\y(?:codigo|clave|pin)(?:\s+es)?\s*[:=]?\s*[a-z0-9][a-z0-9-]{3,15}\y',
    '\y(?:av\.?|avenida|calle|bv\.?|bulevar|boulevard|pje\.?|pasaje|diag\.?|diagonal|ruta|camino)\s+(?:[a-z0-9°º.]+\s+){0,6}(?:n[°ºo]\.?\s*|nro\.?\s*|numero\s+|altura\s+)?[0-9]{1,5}\y(?!\s*(?:' || unit_after || ')\y)',
    '\yruta\s+[0-9]{1,3}\s+km\s*[0-9]{1,4}\y',
    '\yaltura\s+[0-9]{2,5}\y',
    '\ycodigo\s+postal\s+[0-9]{4}\y',
    '\ybarrio\s+cerrado(?:\s+[a-z0-9]{3,}){0,4}\y',
    '\ycountry\s+[a-z]{3,}(?:\s+[a-z]{3,}){0,3}\y',
    '\ylote\s+[0-9]{1,4}\y',
    '\ymanzana\s+[0-9]{1,4}\y',
    '\ypiso\s+[0-9]{1,2}(?:\s*[a-z])?\y',
    '\y(?:depto|dpto|dto|departamento)\.?\s*(?:[0-9]{1,4}[a-z]?|[a-z][0-9]{0,2})\y',
    '\yplanta\s+baja\y',
    '-?[0-9]{2}\.[0-9]{4,}\s*[, ]\s*-?[0-9]{2,3}\.[0-9]{4,}',
    '\y(?:esquina(?:\s+de)?|entre)\s+[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\s+y\s+[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\y',
    '\y[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\s+y\s+[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\s+esquina\y',
    '\y(?:calle|avenida|av\.?)\s+[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\s+y\s+(?:calle|avenida|av\.?)?\s*[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\y'
  ];

  FOR idx IN 1..array_length(pr, 1) LOOP
    pat := pr[idx];
    kind := pk[idx];
    pos := 1;
    LOOP
      s := regexp_instr(folded, pat, pos, 1, 0);
      EXIT WHEN s = 0;
      e := regexp_instr(folded, pat, pos, 1, 1);
      EXIT WHEN e <= s;
      frag := substring(folded from s for e - s);
      ok := true;
      IF kind = 'codigo' AND (frag !~ '[0-9]' OR frag ~ '\ypostal\y') THEN
        ok := false;
      END IF;
      IF ok AND kind = 'direccion' AND frag ~ '\sy\s' THEN
        left_side := (regexp_match(frag, '([a-z]{3,}(?:\s+[a-z]{3,}){0,2})\s+y\s+([a-z]{3,}(?:\s+[a-z]{3,}){0,2})'))[1];
        right_side := (regexp_match(frag, '([a-z]{3,}(?:\s+[a-z]{3,}){0,2})\s+y\s+([a-z]{3,}(?:\s+[a-z]{3,}){0,2})'))[2];
        left_bad := true;
        right_bad := true;
        IF left_side IS NOT NULL THEN
          side_words := regexp_split_to_array(left_side, '\s+');
          FOREACH side_word IN ARRAY side_words LOOP
            IF length(side_word) >= 3 AND NOT (side_word = ANY (stop_words)) THEN
              left_bad := false;
            END IF;
          END LOOP;
        END IF;
        IF right_side IS NOT NULL THEN
          side_words := regexp_split_to_array(right_side, '\s+');
          FOREACH side_word IN ARRAY side_words LOOP
            IF length(side_word) >= 3 AND NOT (side_word = ANY (stop_words)) THEN
              right_bad := false;
            END IF;
          END LOOP;
        END IF;
        IF left_bad AND right_bad THEN
          ok := false;
        END IF;
      END IF;
      IF ok
         AND NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
         AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
        sp_s := sp_s || s;
        sp_e := sp_e || e;
        sp_k := sp_k || ARRAY[kind];
      END IF;
      pos := e;
    END LOOP;
  END LOOP;

  -- CBU/CVU: 22 dígitos.
  pos := 1;
  pat := '(?<![0-9])(?:[0-9][\s.-]?){22}(?![0-9])';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(folded from s for e - s);
    IF length(regexp_replace(frag, '[^0-9]', '', 'g')) = 22
       AND NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['cbu'];
    END IF;
    pos := e;
  END LOOP;

  -- Teléfono con dígitos.
  pos := 1;
  pat := '(?<![0-9])(?:\+|00)?[0-9][0-9\s().-]{5,28}[0-9](?![0-9])';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(folded from s for e - s);
    digits := regexp_replace(frag, '[^0-9]', '', 'g');
    IF length(digits) BETWEEN 8 AND 15
       AND frag !~ '^[0-9]{1,3}(?:\.[0-9]{3})+$'
       AND NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['telefono'];
    END IF;
    pos := e;
  END LOOP;

  -- Teléfono dicho con palabras.
  pos := 1;
  pat := '(?:(?:' || numword || '|[0-9]{1,4})(?:\s+y)?\s+){5,}(?:' || numword || '|[0-9]{1,4})';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(folded from s for e - s);
    IF frag ~ ('\y(?:' || numword || ')\y')
       AND public._offplatform_phone_digits(frag) BETWEEN 8 AND 15
       AND NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['telefono'];
    END IF;
    pos := e;
  END LOOP;

  -- Alias palabra.palabra.palabra, hasta 20 caracteres.
  pos := 1;
  pat := '\y[a-z][a-z0-9]{1,18}(?:\.[a-z][a-z0-9]{1,18}){2}\y';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(folded from s for e - s);
    IF length(frag) BETWEEN 6 AND 20
       AND frag !~ '(^|\.)(www|com|net|org|maps|google|goo|app|html|http|https)(\.|$)'
       AND NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['alias'];
    END IF;
    pos := e;
  END LOOP;

  -- Calle con altura, sin prefijo.
  pos := 1;
  pat := '\y((?:[a-z]{4,}|[a-z]{3,}\s+[a-z]{3,})(?:\s+[a-z]{3,}){0,2})\s+[0-9]{3,5}\y(?!\s*(?:' || unit_after || ')\y)';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(folded from s for e - s);
    name := regexp_replace(frag, '\s+[0-9]{3,5}$', '');
    words := regexp_split_to_array(name, '\s+');
    ok := false;
    FOREACH word IN ARRAY words LOOP
      IF length(word) >= 3 AND NOT (word = ANY (stop_words)) THEN
        ok := true;
      END IF;
    END LOOP;
    IF ok
       AND NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['direccion'];
    END IF;
    pos := e;
  END LOOP;

  out_text := '';
  cursor_pos := 1;
  FOR rec IN
    SELECT u.s, u.e, u.k
    FROM unnest(sp_s, sp_e, sp_k) AS u(s, e, k)
    ORDER BY u.s, u.e DESC
  LOOP
    IF rec.e <= cursor_pos THEN
      CONTINUE;
    END IF;
    IF rec.s > cursor_pos THEN
      out_text := out_text || substring(src from cursor_pos for rec.s - cursor_pos);
    END IF;
    out_text := out_text || '•••';
    cursor_pos := rec.e;
    IF NOT (rec.k = ANY (kinds)) THEN
      kinds := kinds || ARRAY[rec.k];
    END IF;
  END LOOP;
  IF cursor_pos <= char_length(src) THEN
    out_text := out_text || substring(src from cursor_pos);
  END IF;

  RETURN jsonb_build_object('text', out_text, 'kinds', to_jsonb(kinds));
END;
$$;

COMMENT ON FUNCTION public.redact_offplatform_contact(text) IS
  'Reemplaza teléfono, mail, link, CBU/CVU, alias, @usuario, código y dirección por •••. No mira la palabra suelta.';

CREATE TABLE IF NOT EXISTS public.offplatform_contact_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  source text NOT NULL,
  source_id uuid,
  field_name text NOT NULL,
  kinds text[] NOT NULL
);

COMMENT ON TABLE public.offplatform_contact_detections IS
  'Detecciones de contacto fuera de la app. Sin acceso de anon ni authenticated. El admin las ve después, con service_role.';

ALTER TABLE public.offplatform_contact_detections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.offplatform_contact_detections FROM PUBLIC;
REVOKE ALL ON TABLE public.offplatform_contact_detections FROM anon;
REVOKE ALL ON TABLE public.offplatform_contact_detections FROM authenticated;

CREATE OR REPLACE FUNCTION public.redact_offplatform_field(
  p_text text,
  p_source text,
  p_source_id uuid,
  p_field text,
  p_actor uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_kinds text[];
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN p_text;
  END IF;
  v := public.redact_offplatform_contact(p_text);
  SELECT coalesce(array_agg(value), '{}'::text[])
    INTO v_kinds
  FROM jsonb_array_elements_text(coalesce(v->'kinds', '[]'::jsonb));
  IF coalesce(array_length(v_kinds, 1), 0) > 0 THEN
    INSERT INTO public.offplatform_contact_detections (actor_id, source, source_id, field_name, kinds)
    VALUES (p_actor, p_source, p_source_id, p_field, v_kinds);
  END IF;
  RETURN v->>'text';
END;
$$;

CREATE OR REPLACE FUNCTION public.redact_offplatform_metadata(
  p_metadata jsonb,
  p_source text,
  p_source_id uuid,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := p_metadata;
  keys text[] := ARRAY[
    'service_detail', 'description', 'caption', 'notes', 'note',
    'detail', 'comment', 'label', 'title', 'text', 'message',
    'fundamentos', 'item_note', 'alternative_description', 'variant_label'
  ];
  key text;
  nested text;
  val jsonb;
  elem jsonb;
  i int;
  redacted text;
BEGIN
  IF meta IS NULL OR jsonb_typeof(meta) <> 'object' THEN
    RETURN meta;
  END IF;
  FOREACH key IN ARRAY keys LOOP
    val := meta->key;
    IF val IS NULL THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(val) = 'string' THEN
      redacted := public.redact_offplatform_field(val #>> '{}', p_source, p_source_id, key, p_actor);
      meta := jsonb_set(meta, ARRAY[key], to_jsonb(redacted), false);
    ELSIF jsonb_typeof(val) = 'array' THEN
      i := 0;
      FOR elem IN SELECT value FROM jsonb_array_elements(val) LOOP
        IF jsonb_typeof(elem) = 'string' THEN
          redacted := public.redact_offplatform_field(elem #>> '{}', p_source, p_source_id, key, p_actor);
          val := jsonb_set(val, ARRAY[i::text], to_jsonb(redacted), false);
        ELSIF jsonb_typeof(elem) = 'object' THEN
          FOREACH nested IN ARRAY keys LOOP
            IF jsonb_typeof(elem->nested) = 'string' THEN
              redacted := public.redact_offplatform_field(elem->>nested, p_source, p_source_id, nested, p_actor);
              elem := jsonb_set(elem, ARRAY[nested], to_jsonb(redacted), false);
            END IF;
          END LOOP;
          val := jsonb_set(val, ARRAY[i::text], elem, false);
        END IF;
        i := i + 1;
      END LOOP;
      meta := jsonb_set(meta, ARRAY[key], val, false);
    END IF;
  END LOOP;
  RETURN meta;
END;
$$;

REVOKE ALL ON FUNCTION public._offplatform_fold(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._offplatform_overlaps(int, int, int[], int[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._offplatform_phone_digits(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_offplatform_contact(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_offplatform_field(text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_offplatform_metadata(jsonb, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- El motivo de bloqueo queda vacío: ya no se rechaza el mensaje.
CREATE OR REPLACE FUNCTION public.contact_info_blocked_reason(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULL::text;
$$;

COMMENT ON FUNCTION public.contact_info_blocked_reason(text) IS
  'Retirado el 2026-10-09. No rechaza por palabra ni por dato. El reemplazo es redact_offplatform_contact.';

CREATE OR REPLACE FUNCTION public.message_body_blocked_reason(p_text text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::text;
$$;

CREATE OR REPLACE FUNCTION public.message_free_text_blocked_reason(
  p_type text,
  p_body text,
  p_metadata jsonb
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::text;
$$;

-- enforce_message_rules: cuerpo vivo, sin el RAISE message_blocked_contact.
-- En su lugar se reemplaza el dato. type=system vuelve antes, intacto.
CREATE OR REPLACE FUNCTION public.enforce_message_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recent_count INT;
  blocked_pair BOOLEAN;
  image_url TEXT;
  image_path TEXT;
  image_bucket TEXT;
BEGIN
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

  IF char_length(coalesce(NEW.body, '')) > 2000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = 'P0001';
  END IF;

  NEW.body := public.redact_offplatform_field(
    NEW.body, 'message', NEW.id, 'body', NEW.sender_id
  );
  NEW.metadata := public.redact_offplatform_metadata(
    coalesce(NEW.metadata, '{}'::jsonb), 'message', NEW.id, NEW.sender_id
  );

  IF coalesce(NEW.type, 'text') = 'image' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND c.cliente_id = NEW.sender_id
    ) THEN
      RAISE EXCEPTION 'image_client_only' USING ERRCODE = 'P0001';
    END IF;

    image_path := nullif(trim(coalesce(NEW.metadata->>'image_path', '')), '');
    image_bucket := nullif(trim(coalesce(NEW.metadata->>'image_bucket', '')), '');
    image_url := nullif(trim(coalesce(NEW.metadata->>'image_url', '')), '');

    IF image_path IS NOT NULL THEN
      IF coalesce(image_bucket, 'chat') <> 'chat'
         OR image_path ~ '(^|/)\.\.(/|$)'
         OR left(image_path, 1) = '/'
         OR image_path !~ '^[^/]+/chat/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+$'
      THEN
        RAISE EXCEPTION 'image_url_required' USING ERRCODE = 'P0001';
      END IF;
    ELSIF image_url IS NULL OR image_url !~* '^https?://' THEN
      RAISE EXCEPTION 'image_url_required' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.redact_message_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.type, 'text') = 'system' THEN
    RETURN NEW;
  END IF;
  IF NEW.body IS NOT DISTINCT FROM OLD.body
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata THEN
    RETURN NEW;
  END IF;
  NEW.body := public.redact_offplatform_field(
    NEW.body, 'message', NEW.id, 'body', coalesce(auth.uid(), NEW.sender_id)
  );
  NEW.metadata := public.redact_offplatform_metadata(
    coalesce(NEW.metadata, '{}'::jsonb), 'message', NEW.id, coalesce(auth.uid(), NEW.sender_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_redact_on_update ON public.messages;
CREATE TRIGGER trg_messages_redact_on_update
  BEFORE UPDATE OF body, metadata ON public.messages
  FOR EACH ROW
  WHEN (coalesce(NEW.type, 'text') IS DISTINCT FROM 'system')
  EXECUTE FUNCTION public.redact_message_on_update();

CREATE OR REPLACE FUNCTION public.enforce_quote_service_detail_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.service_detail := public.redact_offplatform_field(
    NEW.service_detail, 'contratacion', NEW.id, 'service_detail', auth.uid()
  );
  NEW.recotizacion_fundamentos := public.redact_offplatform_field(
    NEW.recotizacion_fundamentos, 'contratacion', NEW.id, 'recotizacion_fundamentos', auth.uid()
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.redact_offplatform_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'quotes' THEN
    NEW.notes := public.redact_offplatform_field(NEW.notes, 'quote', NEW.id, 'notes', auth.uid());
  ELSIF TG_TABLE_NAME = 'quote_items' THEN
    NEW.item_note := public.redact_offplatform_field(NEW.item_note, 'quote_item', NEW.id, 'item_note', auth.uid());
    NEW.alternative_description := public.redact_offplatform_field(NEW.alternative_description, 'quote_item', NEW.id, 'alternative_description', auth.uid());
    NEW.variant_label := public.redact_offplatform_field(NEW.variant_label, 'quote_item', NEW.id, 'variant_label', auth.uid());
  ELSIF TG_TABLE_NAME = 'request_items' THEN
    NEW.description := public.redact_offplatform_field(NEW.description, 'request_item', NEW.id, 'description', auth.uid());
  ELSIF TG_TABLE_NAME = 'recotizaciones' THEN
    NEW.fundamentos := public.redact_offplatform_field(NEW.fundamentos, 'recotizacion', NEW.id, 'fundamentos', auth.uid());
  ELSIF TG_TABLE_NAME = 'material_requests' THEN
    NEW.title := public.redact_offplatform_field(NEW.title, 'material_request', NEW.id, 'title', auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.redact_message_on_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_offplatform_row() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.contrataciones') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_contrataciones_enforce_detail ON public.contrataciones;
    CREATE TRIGGER trg_contrataciones_enforce_detail
      BEFORE INSERT OR UPDATE OF service_detail, recotizacion_fundamentos
      ON public.contrataciones
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_quote_service_detail_rules();
  END IF;

  IF to_regclass('public.quotes') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_quotes_redact_offplatform ON public.quotes;
    CREATE TRIGGER trg_quotes_redact_offplatform
      BEFORE INSERT OR UPDATE OF notes ON public.quotes
      FOR EACH ROW
      EXECUTE FUNCTION public.redact_offplatform_row();
  END IF;

  IF to_regclass('public.quote_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_quote_items_redact_offplatform ON public.quote_items;
    CREATE TRIGGER trg_quote_items_redact_offplatform
      BEFORE INSERT OR UPDATE OF item_note, alternative_description, variant_label
      ON public.quote_items
      FOR EACH ROW
      EXECUTE FUNCTION public.redact_offplatform_row();
  END IF;

  IF to_regclass('public.request_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_request_items_redact_offplatform ON public.request_items;
    CREATE TRIGGER trg_request_items_redact_offplatform
      BEFORE INSERT OR UPDATE OF description ON public.request_items
      FOR EACH ROW
      EXECUTE FUNCTION public.redact_offplatform_row();
  END IF;

  IF to_regclass('public.recotizaciones') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_recotizaciones_redact_offplatform ON public.recotizaciones;
    CREATE TRIGGER trg_recotizaciones_redact_offplatform
      BEFORE INSERT OR UPDATE OF fundamentos ON public.recotizaciones
      FOR EACH ROW
      EXECUTE FUNCTION public.redact_offplatform_row();
  END IF;

  IF to_regclass('public.material_requests') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'material_requests'
         AND column_name = 'title'
     ) THEN
    DROP TRIGGER IF EXISTS trg_material_requests_redact_offplatform ON public.material_requests;
    CREATE TRIGGER trg_material_requests_redact_offplatform
      BEFORE INSERT OR UPDATE OF title ON public.material_requests
      FOR EACH ROW
      EXECUTE FUNCTION public.redact_offplatform_row();
  END IF;
END
$do$;

-- recotizar_en_curso: cuerpo vivo (2026-10-09). El único cambio es
-- RETURNING id, fundamentos. El trigger de recotizaciones ya reemplazó
-- el dato; así el mensaje de sistema lleva ••• y conserva el monto.
DO $recotizar$
BEGIN
  IF to_regprocedure('public.recotizar_en_curso(uuid, numeric, text)') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.recotizar_en_curso(p_contratacion_id uuid, p_nuevo_precio_trabajador numeric, p_fundamentos text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_precios record;
  v_pagado numeric;
  v_comision numeric;
  v_precio_final numeric;
  v_neto numeric;
  v_fundamentos text;
  v_id uuid;
  v_monto_txt text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_row := public._assert_contratacion_participante(p_contratacion_id);

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede recotizar' USING ERRCODE = '42501';
  END IF;

  IF v_row.estado_trabajo <> 'en_curso' THEN
    RAISE EXCEPTION 'Solo se puede recotizar con trabajo en curso';
  END IF;

  -- Falta acreditar la diferencia de la recotización anterior. Si se dejara
  -- proponer otra, el pago de esa diferencia (registrar_seña_aprobada) limpiaría
  -- la propuesta nueva a medias.
  IF v_row.estado_pago = 'pendiente_seña' THEN
    RAISE EXCEPTION 'Falta que el cliente pague la diferencia del costo de servicio';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pin_intentos
    WHERE contratacion_id = p_contratacion_id
      AND actor_id = auth.uid()
      AND exito = true
  ) THEN
    RAISE EXCEPTION 'Tenés que validar el PIN del cliente antes de recotizar';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.recotizaciones
    WHERE contratacion_id = p_contratacion_id
      AND estado = 'pendiente'
  ) OR v_row.recotizacion_precio_trabajador IS NOT NULL THEN
    RAISE EXCEPTION 'Ya hay una recotización pendiente';
  END IF;

  v_fundamentos := btrim(coalesce(p_fundamentos, ''));
  IF char_length(v_fundamentos) < 10 OR char_length(v_fundamentos) > 1000 THEN
    RAISE EXCEPTION 'Los fundamentos son obligatorios';
  END IF;

  IF p_nuevo_precio_trabajador IS NULL OR p_nuevo_precio_trabajador <= 0 THEN
    RAISE EXCEPTION 'precio_trabajador inválido';
  END IF;

  v_neto := ceil(p_nuevo_precio_trabajador);
  IF v_neto = ceil(v_row.precio_trabajador) THEN
    RAISE EXCEPTION 'El monto nuevo tiene que ser distinto del actual';
  END IF;

  -- #39: calc_precios_contratacion usa calc_yachanga_service_fee.
  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);
  v_comision := v_precios.comision_app;
  v_precio_final := v_precios.precio_final;

  SELECT coalesce(sum(monto), 0) INTO v_pagado
  FROM public.transacciones_pago
  WHERE contratacion_id = p_contratacion_id
    AND estado_mp = 'approved'
    AND tipo_pago IN ('seña_inicial', 'diferencia_seña');
  IF v_row.estado_pago IN ('seña_pagada', 'totalmente_pagado') THEN
    v_pagado := greatest(v_pagado, v_row.comision_app);
  END IF;

  -- #4 opción A: el cliente no paga nada más, ni la diferencia del costo de
  -- servicio. #39 sigue vigente: tampoco hay devolución. La comisión queda
  -- en lo ya pagado aunque el tramo nuevo sea más alto.
  v_precio_final := v_precio_final - v_comision + v_pagado;
  v_comision := v_pagado;

  INSERT INTO public.recotizaciones (
    contratacion_id,
    worker_id,
    client_id,
    precio_trabajador_anterior,
    precio_final_anterior,
    comision_app_anterior,
    precio_trabajador_nuevo,
    precio_final_nuevo,
    comision_app_nuevo,
    fundamentos,
    estado
  )
  VALUES (
    p_contratacion_id,
    v_row.worker_id,
    v_row.client_id,
    v_row.precio_trabajador,
    v_row.precio_final,
    v_row.comision_app,
    v_neto,
    v_precio_final,
    v_comision,
    v_fundamentos,
    'pendiente'
  )
  RETURNING id, fundamentos INTO v_id, v_fundamentos;

  UPDATE public.contrataciones
  SET
    recotizacion_id = v_id,
    recotizacion_fundamentos = v_fundamentos,
    recotizacion_precio_trabajador = v_neto,
    recotizacion_precio_final = v_precio_final,
    recotizacion_comision_app = v_comision,
    estado_trabajo = 'pendiente_pago_diferencia'
  WHERE id = p_contratacion_id;

  v_monto_txt := '$' || regexp_replace(trunc(v_neto)::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g');

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional propone un nuevo monto para el trabajo.' || E'\n'
      || 'Pago al profesional: ' || v_monto_txt || E'\n'
      || 'Fundamentos: ' || v_fundamentos,
    jsonb_build_object(
      'event', 'recotizacion_propuesta',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_id,
      'audience', 'cliente',
      'fundamentos', v_fundamentos,
      'precio_trabajador_anterior', v_row.precio_trabajador,
      'precio_trabajador', v_neto,
      'precio_final', v_precio_final,
      'comision_app', v_comision
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Enviaste una recotización de ' || v_monto_txt || '.' || E'\n'
      || 'Fundamentos: ' || v_fundamentos || E'\n'
      || 'El cliente tiene que aceptarla o rechazarla.',
    jsonb_build_object(
      'event', 'recotizacion_propuesta_trabajador',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_id,
      'audience', 'trabajador',
      'fundamentos', v_fundamentos,
      'precio_trabajador_anterior', v_row.precio_trabajador,
      'precio_trabajador', v_neto
    )
  );
END;
$function$
$fn$;
END
$recotizar$;
