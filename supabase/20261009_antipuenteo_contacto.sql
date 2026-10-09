-- Antipuenteo. NO APLICADO.
-- Reemplaza el rechazo por palabra y por message_blocked_contact:
-- el dato se cambia por ••• y el envío sigue.
-- Además, en el servidor (SECURITY DEFINER), compara el texto contra el
-- teléfono del cliente, la dirección cargada del cliente y el teléfono del
-- profesional de esa conversación. Si coincide, enmascara y registra
-- match_perfil. Esos datos no se devuelven ni se escriben en el log.
-- La comparación no existe en el cliente.
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

CREATE OR REPLACE FUNCTION public._offplatform_to_digits(p_chunk text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := public._offplatform_fold(coalesce(p_chunk, ''));
  stems text[] := ARRAY['treinta','trenta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  bases int[] := ARRAY[30,30,40,50,60,70,80,90];
  units text[] := ARRAY['uno','un','una','dos','tres','cuatro','cuato','cinco','sinco','seis','sies','siete','ocho','nueve','nuebe'];
  uvals int[] := ARRAY[1,1,1,2,3,4,4,5,5,6,6,7,8,9,9];
  teens text[] := ARRAY['veintinueve','veintiocho','veintisiete','veintiseis','veinticinco','veinticuatro','veintitres','veintidos','veintiuno','diecinueve','dieciocho','diecisiete','dieciseis','catorce','quince','trece','doce','once','diez'];
  teen_vals text[] := ARRAY['29','28','27','26','25','24','23','22','21','19','18','17','16','14','15','13','12','11','10'];
  si int;
  ui int;
BEGIN
  -- Un monto dicho con palabras no es un teléfono.
  v := regexp_replace(v, '\y[a-z]+\s+(?:mil|miles|millones|millon|lucas|luca|pesos|peso)\y', ' ', 'g');

  FOR si IN 1..coalesce(array_length(stems, 1), 0) LOOP
    FOR ui IN 1..coalesce(array_length(units, 1), 0) LOOP
      v := regexp_replace(v, '\y' || stems[si] || '\s+y\s+' || units[ui] || '\y', (bases[si] + uvals[ui])::text, 'g');
      v := regexp_replace(v, '\y' || stems[si] || 'i' || units[ui] || '\y', (bases[si] + uvals[ui])::text, 'g');
      v := regexp_replace(v, '\y' || stems[si] || 'y' || units[ui] || '\y', (bases[si] + uvals[ui])::text, 'g');
    END LOOP;
    v := regexp_replace(v, '\y' || stems[si] || '\y', bases[si]::text, 'g');
  END LOOP;

  FOR ui IN 1..coalesce(array_length(units, 1), 0) LOOP
    v := regexp_replace(v, '\y(?:veinte|beinte)\s+y\s+' || units[ui] || '\y', (20 + uvals[ui])::text, 'g');
  END LOOP;
  v := regexp_replace(v, '\y(?:veinte|beinte)\y', '20', 'g');

  FOR si IN 1..coalesce(array_length(teens, 1), 0) LOOP
    v := regexp_replace(v, '\y' || teens[si] || '\y', teen_vals[si], 'g');
  END LOOP;

  v := regexp_replace(v, '\y(?:nueve|nuebe)\y', '9', 'g');
  v := regexp_replace(v, '\yocho\y', '8', 'g');
  v := regexp_replace(v, '\ysiete\y', '7', 'g');
  v := regexp_replace(v, '\y(?:seis|sies)\y', '6', 'g');
  v := regexp_replace(v, '\y(?:cinco|sinco)\y', '5', 'g');
  v := regexp_replace(v, '\y(?:cuatro|cuato)\y', '4', 'g');
  v := regexp_replace(v, '\ytres\y', '3', 'g');
  v := regexp_replace(v, '\ydos\y', '2', 'g');
  v := regexp_replace(v, '\y(?:uno|una)\y', '1', 'g');
  v := regexp_replace(v, '\yun\y', '1', 'g');
  v := regexp_replace(v, '\y(?:cero|sero)\y', '0', 'g');
  RETURN regexp_replace(v, '[^0-9]', '', 'g');
END;
$$;

CREATE OR REPLACE FUNCTION public._offplatform_phone_digits(p_chunk text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT length(public._offplatform_to_digits(p_chunk));
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
  numword text;
  num_stems text[] := ARRAY['treinta','trenta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  num_units text[] := ARRAY['uno','un','una','dos','tres','cuatro','cuato','cinco','sinco','seis','sies','siete','ocho','nueve','nuebe'];
  si int;
  ui int;
  filler text;
  before text;
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

  numword := 'cero|sero|uno|una|un|dos|tres|cuatro|cuato|cinco|sinco|seis|sies|siete|ocho|nueve|nuebe|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|beinte|veintiuno|veintidos|veintitres|veinticuatro|veinticinco|veintiseis|veintisiete|veintiocho|veintinueve|treinta|trenta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa';
  FOR si IN 1..coalesce(array_length(num_stems, 1), 0) LOOP
    FOR ui IN 1..coalesce(array_length(num_units, 1), 0) LOOP
      numword := num_stems[si] || 'i' || num_units[ui] || '|' || num_stems[si] || 'y' || num_units[ui] || '|' || numword;
    END LOOP;
  END LOOP;

  patterns := ARRAY[
    '\$\s*[0-9]{1,3}(?:[.\s][0-9]{3})+(?:[.,][0-9]{1,2})?',
    '\$\s*[0-9]+(?:[.,][0-9]{1,2})?',
    '\y[0-9]{1,3}(?:\.[0-9]{3})+(?:[.,][0-9]{1,2})?\y',
    '\y[0-9]+(?:[.,][0-9]+)?\s*(?:mil|millones|pesos|peso|ars|lucas|luca)\y',
    '\y(?:cero|sero|uno|una|dos|tres|cuatro|cuato|cinco|sinco|seis|sies|siete|ocho|nueve|nuebe|diez|once|doce|trece|catorce|quince|veinte|beinte|treinta|trenta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s+(?:mil|lucas|luca|pesos|peso)\y',
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

  -- Teléfono dicho con palabras, con relleno corto entre fragmentos
  -- («y van más») y con «treinta y» / «trentaiuno».
  pos := 1;
  filler := 'y|e|o|van|mas|que|eh|va|hay|son|es|el|la|los|las|de|del|al|por|con';
  pat := '\y(?:' || numword || '|[0-9]{1,4})(?:(?:\s+(?:' || filler || ')){1,3}\s+(?:' || numword || '|[0-9]{1,4})|\s+(?:' || numword || '|[0-9]{1,4})){5,}\y';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(folded from s for e - s);
    IF frag ~ ('\y(?:' || numword || ')\y')
       AND frag !~ '\y(?:mil|miles|lucas|luca|pesos|peso|millones|millon)\y'
       AND public._offplatform_phone_digits(frag) BETWEEN 8 AND 15
       AND NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['telefono'];
      pos := e;
    ELSE
      pos := s + 1;
    END IF;
  END LOOP;

  -- Pedido de seguir por otro canal o de pasar el teléfono.
  -- No alcanza la palabra suelta: tiene que haber un verbo de pasar,
  -- mandar o agregar. «pasás» (indicativo) no entra.
  pos := 1;
  pat := '\y(?:por|al)\s+(?:whatsapp|wsp|wp|instagram|insta|facebook|telegram)\y';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    before := substring(folded from greatest(1, s - 60) for least(60, s - 1));
    IF before ~ '\y(?:pasame|pasar|pasamos|paso|mandame|agregame|escribime|anotame|tirame|manda|agrega|pasa)\y'
       AND NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['canal'];
    END IF;
    pos := e;
  END LOOP;

  pos := 1;
  pat := '\y(?:pasame|mandame|agregame|escribime|anotame|tirame|manda|agrega|pasa)\s+(?:(?:tu|el|la|un|una|mi|su)\s+)?(?:telefono|telefonos|celular|celu|numero|nro|whatsapp|wsp|wp|instagram|insta)\y';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    IF NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['canal'];
    END IF;
    pos := e;
  END LOOP;

  pos := 1;
  pat := '\y(?:te\s+|me\s+|le\s+)?(?:paso|pasar|pasamos)\s+(?:(?:la|el|mi|tu|un|una|su)\s+){0,2}(?:telefono|telefonos|celular|celu|numero|nro)\y';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    IF NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY['canal'];
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

  -- Calle con altura, sin prefijo. El número tiene que ir pegado a un nombre
  -- propio (mayúscula en el texto original). Un verbo de precio, «modelo»,
  -- «año» o «código de producto» no arma una calle. «buscarla por Volta 1140»
  -- tapa solo «Volta 1140». street_block tiene que coincidir con el cliente.
  DECLARE
    bw text[] := '{}';
    bs int[] := '{}';
    cur int;
    wend int;
    gap int;
    wtxt text;
    wstart int;
    name_start int;
    wi int;
    upper_letters text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ';
    street_block text[] := ARRAY[
      'cobro','cobra','cobramos','cobran','cobras','cobren',
      'sale','salen','salio','cuesta','cuestan','son','sos',
      'dejame','dejamelo','deja','dejenme',
      'pago','paga','pagan','pagame','pagas','sena','senia',
      'presupuesto','presupuestos','modelo','modelos',
      'ano','anio','anos','codigo','codigos','producto','productos',
      'hora','horas','adelanto','item','items','total','precio','precios',
      'mano','obra',
      'tarugo','tarugos','llave','griferia','inodoro','mesada','puerta','ventana',
      'vidrio','membrana','durlock','yeso','enduido','revestimiento','porcelanato',
      'ceramica','zocalo','perfil','hierro','alambre','clavo','clavos','cantidad',
      'dale','que','por','para','con','sin','este','esta','hay','mas','muy','bien',
      'ahi','aca','ya','hoy','manana','despues','cuando','donde','setiembre',
      'queda','salen','llevan','necesito','quiero','piso','depto','dpto','dto',
      'departamento','esquina','entre','calle','avenida','barrio','lote','manzana',
      'altura','casa','country','las','los','del','una','uno','celular'
    ];
    not_name text[];
    connectors text[] := ARRAY['de','del','la','las','los','y'];
  BEGIN
    not_name := stop_words || street_block;
    pos := 1;
    pat := '(?<![0-9])[0-9]{3,5}(?![0-9])(?!\s*(?:' || unit_after || ')\y)';
    LOOP
      s := regexp_instr(folded, pat, pos, 1, 0);
      EXIT WHEN s = 0;
      e := regexp_instr(folded, pat, pos, 1, 1);
      EXIT WHEN e <= s;
      bw := '{}';
      bs := '{}';
      cur := s;
      WHILE cur > 1 AND substring(folded from cur - 1 for 1) ~ '\s' LOOP
        cur := cur - 1;
      END LOOP;
      WHILE coalesce(array_length(bw, 1), 0) < 4
            AND cur > 1
            AND substring(folded from cur - 1 for 1) ~ '[a-z]' LOOP
        wend := cur;
        WHILE cur > 1 AND substring(folded from cur - 1 for 1) ~ '[a-z]' LOOP
          cur := cur - 1;
        END LOOP;
        bw := ARRAY[substring(folded from cur for wend - cur)] || bw;
        bs := ARRAY[cur] || bs;
        gap := cur;
        WHILE gap > 1 AND substring(folded from gap - 1 for 1) ~ '\s' LOOP
          gap := gap - 1;
        END LOOP;
        IF gap > 1 AND substring(folded from gap - 1 for 1) ~ '[a-z]' THEN
          cur := gap;
        ELSE
          EXIT;
        END IF;
      END LOOP;

      IF coalesce(array_length(bw, 1), 0) > 0 THEN
        wtxt := bw[array_length(bw, 1)];
        wstart := bs[array_length(bs, 1)];
        IF length(wtxt) >= 3
           AND NOT (wtxt = ANY (not_name))
           AND position(substring(src from wstart for 1) in upper_letters) > 0 THEN
          name_start := wstart;
          wi := array_length(bw, 1) - 1;
          WHILE wi >= 1 LOOP
            IF bw[wi] = ANY (connectors)
               AND wi >= 2
               AND length(bw[wi - 1]) >= 3
               AND NOT (bw[wi - 1] = ANY (not_name))
               AND position(substring(src from bs[wi - 1] for 1) in upper_letters) > 0 THEN
              name_start := bs[wi - 1];
              wi := wi - 2;
            ELSIF length(bw[wi]) >= 3
               AND NOT (bw[wi] = ANY (not_name))
               AND position(substring(src from bs[wi] for 1) in upper_letters) > 0 THEN
              name_start := bs[wi];
              wi := wi - 1;
            ELSE
              EXIT;
            END IF;
          END LOOP;
          IF NOT public._offplatform_overlaps(name_start, e, ig_s, ig_e)
             AND NOT public._offplatform_overlaps(name_start, e, sp_s, sp_e) THEN
            sp_s := sp_s || name_start;
            sp_e := sp_e || e;
            sp_k := sp_k || ARRAY['direccion'];
          END IF;
        END IF;
      END IF;
      pos := e;
    END LOOP;
  END;

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
  'Reemplaza teléfono, mail, link, CBU/CVU, alias, @usuario, código, dirección y el pedido de salir a otro canal por •••. No mira la palabra suelta.';

CREATE OR REPLACE FUNCTION public._offplatform_blank_noise(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := coalesce(p_text, '');
  patterns text[] := ARRAY[
    '\$\s*[0-9]{1,3}(?:[.\s][0-9]{3})+(?:[.,][0-9]{1,2})?',
    '\$\s*[0-9]+(?:[.,][0-9]{1,2})?',
    '\y[0-9]{1,3}(?:\.[0-9]{3})+(?:[.,][0-9]{1,2})?\y',
    '\y[0-9]+(?:[.,][0-9]+)?\s*(?:mil|millones|pesos|peso|ars|lucas|luca)\y',
    '\y(?:cero|sero|uno|una|dos|tres|cuatro|cuato|cinco|sinco|seis|sies|siete|ocho|nueve|nuebe|diez|once|doce|trece|catorce|quince|veinte|beinte|treinta|trenta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s+(?:mil|lucas|luca|pesos|peso)\y',
    '\y[0-9]+(?:[.,][0-9]+)?\s*[x×]\s*[0-9]+(?:[.,][0-9]+)?(?:\s*(?:m|mm|cm|mts?|metros?|m2))?',
    '\y[0-9]+(?:[.,][0-9]+)?\s*(?:mm|cm|mts|mt|metros|metro|kg|kgs|kilos|kilo|grs?|gramos|lts|litros|litro|pulg|unidades|unidad|bolsas|bolsa|cajones|cajon|cajas|caja|chapas|chapa|baldosas|baldosa|ladrillos|ladrillo|rollos|rollo|varillas|varilla|tiras|tira|placas|placa|tubos|tubo|canos|cano)\y',
    '\y[0-9]{1,2}:[0-9]{2}\y',
    '\y[0-9]{1,2}\s*(?:hs|h)\y',
    '\y[0-9]{1,2}\s+a\s+[0-9]{1,2}(?:\s*hs)?\y',
    '\y[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}\y',
    '\y[0-9]{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+[0-9]{4})?\y'
  ];
  pat text;
  pos int;
  s int;
  e int;
BEGIN
  FOREACH pat IN ARRAY patterns LOOP
    pos := 1;
    LOOP
      s := regexp_instr(v, pat, pos, 1, 0);
      EXIT WHEN s = 0;
      e := regexp_instr(v, pat, pos, 1, 1);
      EXIT WHEN e <= s;
      v := overlay(v placing repeat(' ', e - s) from s for (e - s));
      pos := e;
    END LOOP;
  END LOOP;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public._offplatform_phone_tails(p_phone text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  rest text;
  local text;
  tails text[] := '{}';
BEGIN
  IF length(d) >= 8 THEN
    tails := tails || right(d, 8);
  END IF;
  rest := d;
  IF left(rest, 2) = '54' THEN
    rest := substring(rest from 3);
  END IF;
  IF left(rest, 1) = '9' AND length(rest) >= 11 THEN
    rest := substring(rest from 2);
  END IF;
  IF left(rest, 1) = '0' THEN
    rest := substring(rest from 2);
  END IF;
  IF length(rest) >= 8 THEN
    tails := tails || right(rest, 8);
  END IF;
  IF left(rest, 2) = '11' AND length(rest) >= 10 THEN
    local := substring(rest from 3);
    IF left(local, 2) = '15' THEN
      local := substring(local from 3);
    END IF;
    IF length(local) >= 8 THEN
      tails := tails || right(local, 8);
    END IF;
  END IF;
  IF left(rest, 2) = '15' AND length(rest) >= 10 THEN
    local := substring(rest from 3);
    IF length(local) >= 8 THEN
      tails := tails || right(local, 8);
    END IF;
  END IF;
  SELECT coalesce(array_agg(DISTINCT t), '{}'::text[])
    INTO tails
  FROM unnest(tails) AS t
  WHERE t ~ '^[0-9]{8}$';
  RETURN tails;
END;
$$;

CREATE OR REPLACE FUNCTION public._offplatform_address_parts(p_addr text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  norm text;
  pat text := '([a-z]{3,}(?:\s+[a-z]{3,}){0,2})\s+([0-9]{1,5})';
  pos int := 1;
  s int;
  e int;
  frag text;
  name text;
  height text;
  last_word text;
  word text;
  streets text[] := '{}';
  piso text;
  depto text;
  stop text[] := ARRAY['calle','avenida','barrio','entre','esquina','departamento','localidad','partido','provincia','argentina','piso','depto','dpto','dto','numero','altura','manzana','lote'];
BEGIN
  norm := btrim(regexp_replace(
    regexp_replace(public._offplatform_fold(coalesce(p_addr, '')), '[^a-z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'
  ));
  IF norm = '' THEN
    RETURN jsonb_build_object('streets', '[]'::jsonb, 'height', NULL, 'piso', NULL, 'depto', NULL);
  END IF;
  piso := (regexp_match(norm, '\ypiso\s+([0-9]{1,2})\y'))[1];
  depto := (regexp_match(norm, '\y(?:depto|dpto|dto|departamento)\s+([a-z0-9]{1,4})\y'))[1];
  LOOP
    s := regexp_instr(norm, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(norm, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(norm from s for e - s);
    name := (regexp_match(frag, pat))[1];
    height := (regexp_match(frag, pat))[2];
    last_word := regexp_replace(coalesce(name, ''), '^.*\s', '');
    IF last_word NOT IN ('piso', 'depto', 'dpto', 'dto', 'departamento', 'manzana', 'lote', 'km') THEN
      EXIT;
    END IF;
    height := NULL;
    pos := e;
  END LOOP;
  IF name IS NOT NULL AND height IS NOT NULL THEN
    FOREACH word IN ARRAY regexp_split_to_array(name, '\s+') LOOP
      IF length(word) >= 4 AND NOT (word = ANY (stop)) THEN
        streets := streets || word;
      END IF;
    END LOOP;
  END IF;
  IF coalesce(array_length(streets, 1), 0) = 0 THEN
    height := NULL;
  END IF;
  RETURN jsonb_build_object(
    'streets', to_jsonb(streets),
    'height', height,
    'piso', piso,
    'depto', depto
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._offplatform_apply_spans(
  p_text text,
  p_starts int[],
  p_ends int[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  out_text text := '';
  cursor_pos int := 1;
  gap text;
  rec record;
BEGIN
  FOR rec IN
    SELECT u.s, u.e
    FROM unnest(coalesce(p_starts, '{}'::int[]), coalesce(p_ends, '{}'::int[])) AS u(s, e)
    ORDER BY u.s, u.e DESC
  LOOP
    IF rec.e <= cursor_pos THEN
      CONTINUE;
    END IF;
    IF rec.s > cursor_pos THEN
      gap := substring(p_text from cursor_pos for rec.s - cursor_pos);
      IF right(out_text, 3) = '•••' AND gap ~ '^[[:space:]]+$' THEN
        cursor_pos := rec.e;
        CONTINUE;
      END IF;
      out_text := out_text || gap;
    END IF;
    out_text := out_text || '•••';
    cursor_pos := rec.e;
  END LOOP;
  IF cursor_pos <= char_length(p_text) THEN
    out_text := out_text || substring(p_text from cursor_pos);
  END IF;
  RETURN out_text;
END;
$$;

-- Spans del mensaje nuevo que coinciden con el teléfono o la dirección cargados.
-- No devuelve esos datos: solo posiciones.
CREATE OR REPLACE FUNCTION public._offplatform_profile_spans(
  p_text text,
  p_history text,
  p_tails text[],
  p_streets text[],
  p_height text,
  p_piso text,
  p_depto text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  blanked text;
  hist_digits text;
  pos int;
  s int;
  e int;
  ue int;
  word text;
  piece text;
  rest text;
  new_digits text := '';
  tok_s int[] := '{}';
  tok_e int[] := '{}';
  tok_a int[] := '{}';
  tok_b int[] := '{}';
  sp_s int[] := '{}';
  sp_e int[] := '{}';
  combined text;
  base int;
  tail text;
  scan int;
  rel int;
  abs_pos int;
  ov_s int;
  ov_e int;
  nd_s int;
  nd_e int;
  ti int;
  addr_window text;
  street text;
  street_pos int[] := '{}';
  height_pos int[] := '{}';
  hp int;
  sp int;
  near boolean := false;
  unit_pat text := 'uno|una|un|dos|tres|cuatro|cuato|cinco|sinco|seis|sies|siete|ocho|nueve|nuebe';
  stems text[] := ARRAY['treinta','trenta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa','veinte','beinte'];
BEGIN
  blanked := public._offplatform_blank_noise(public._offplatform_fold(coalesce(p_text, '')));
  hist_digits := right(
    public._offplatform_to_digits(
      public._offplatform_blank_noise(public._offplatform_fold(coalesce(p_history, '')))
    ),
    24
  );

  pos := 1;
  WHILE pos <= char_length(blanked) LOOP
    s := regexp_instr(blanked, '\y(?:[a-z]+|[0-9]{1,4})\y', pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(blanked, '\y(?:[a-z]+|[0-9]{1,4})\y', pos, 1, 1);
    EXIT WHEN e <= s;
    word := substring(blanked from s for e - s);
    piece := NULL;
    ue := e;

    IF word ~ '^[0-9]{1,4}$' THEN
      piece := word;
    ELSIF word = ANY (stems) THEN
      rest := substring(blanked from e);
      IF rest ~ ('^\s+y\s+(?:' || unit_pat || ')\y') THEN
        ue := regexp_instr(blanked, '\s+y\s+(?:' || unit_pat || ')\y', e, 1, 1);
        IF ue > e THEN
          piece := public._offplatform_to_digits(substring(blanked from s for ue - s));
        END IF;
      ELSE
        piece := public._offplatform_to_digits(word);
      END IF;
    ELSE
      piece := public._offplatform_to_digits(word);
    END IF;

    IF coalesce(piece, '') ~ '^[0-9]+$' THEN
      tok_s := tok_s || s;
      tok_e := tok_e || ue;
      tok_a := tok_a || (length(new_digits) + 1);
      new_digits := new_digits || piece;
      tok_b := tok_b || length(new_digits);
    END IF;
    pos := greatest(ue, e);
  END LOOP;

  combined := hist_digits || new_digits;
  base := length(hist_digits);
  IF p_tails IS NOT NULL THEN
    FOREACH tail IN ARRAY p_tails LOOP
      IF tail IS NULL OR tail !~ '^[0-9]{8}$' THEN
        CONTINUE;
      END IF;
      scan := 1;
      LOOP
        rel := strpos(substring(combined from scan), tail);
        EXIT WHEN rel = 0;
        abs_pos := scan + rel - 1;
        ov_s := greatest(abs_pos, base + 1);
        ov_e := least(abs_pos + 7, base + length(new_digits));
        IF ov_s <= ov_e THEN
          nd_s := ov_s - base;
          nd_e := ov_e - base;
          FOR ti IN 1..coalesce(array_length(tok_a, 1), 0) LOOP
            IF tok_a[ti] <= nd_e AND nd_s <= tok_b[ti] THEN
              sp_s := sp_s || tok_s[ti];
              sp_e := sp_e || tok_e[ti];
            END IF;
          END LOOP;
        END IF;
        scan := abs_pos + 1;
        EXIT WHEN scan > length(combined);
      END LOOP;
    END LOOP;
  END IF;

  addr_window := public._offplatform_blank_noise(public._offplatform_fold(
    coalesce(p_history, '') || ' ' || coalesce(p_text, '')
  ));
  IF coalesce(p_height, '') ~ '^[0-9]{1,5}$' AND p_streets IS NOT NULL THEN
    pos := 1;
    LOOP
      s := regexp_instr(addr_window, '(?<![0-9])' || p_height || '(?![0-9])', pos, 1, 0);
      EXIT WHEN s = 0;
      height_pos := height_pos || s;
      pos := s + 1;
    END LOOP;
    FOREACH street IN ARRAY p_streets LOOP
      IF street !~ '^[a-z]{4,}$' THEN
        CONTINUE;
      END IF;
      pos := 1;
      LOOP
        s := regexp_instr(addr_window, '\y' || street || '\y', pos, 1, 0);
        EXIT WHEN s = 0;
        street_pos := street_pos || s;
        pos := s + 1;
      END LOOP;
    END LOOP;
    IF coalesce(array_length(street_pos, 1), 0) > 0 AND coalesce(array_length(height_pos, 1), 0) > 0 THEN
      FOREACH sp IN ARRAY street_pos LOOP
        FOREACH hp IN ARRAY height_pos LOOP
          IF abs(sp - hp) <= 120 THEN
            near := true;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
  END IF;

  IF near THEN
    FOREACH street IN ARRAY p_streets LOOP
      IF street !~ '^[a-z]{4,}$' THEN
        CONTINUE;
      END IF;
      pos := 1;
      LOOP
        s := regexp_instr(blanked, '\y' || street || '\y', pos, 1, 0);
        EXIT WHEN s = 0;
        e := regexp_instr(blanked, '\y' || street || '\y', pos, 1, 1);
        EXIT WHEN e <= s;
        sp_s := sp_s || s;
        sp_e := sp_e || e;
        pos := e;
      END LOOP;
    END LOOP;
    pos := 1;
    LOOP
      s := regexp_instr(blanked, '(?<![0-9])' || p_height || '(?![0-9])', pos, 1, 0);
      EXIT WHEN s = 0;
      e := s + length(p_height);
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      pos := e;
    END LOOP;
    IF coalesce(p_piso, '') ~ '^[0-9]{1,2}$' THEN
      pos := 1;
      LOOP
        s := regexp_instr(blanked, '\ypiso\s+' || p_piso || '\y', pos, 1, 0);
        EXIT WHEN s = 0;
        e := regexp_instr(blanked, '\ypiso\s+' || p_piso || '\y', pos, 1, 1);
        EXIT WHEN e <= s;
        sp_s := sp_s || s;
        sp_e := sp_e || e;
        pos := e;
      END LOOP;
    END IF;
    IF coalesce(p_depto, '') ~ '^[a-z0-9]{1,4}$' THEN
      pos := 1;
      LOOP
        s := regexp_instr(blanked, '\y(?:depto|dpto|dto|departamento)\s+' || p_depto || '\y', pos, 1, 0);
        EXIT WHEN s = 0;
        e := regexp_instr(blanked, '\y(?:depto|dpto|dto|departamento)\s+' || p_depto || '\y', pos, 1, 1);
        EXIT WHEN e <= s;
        sp_s := sp_s || s;
        sp_e := sp_e || e;
        pos := e;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'matched', coalesce(array_length(sp_s, 1), 0) > 0,
    'starts', to_jsonb(sp_s),
    'ends', to_jsonb(sp_e)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redact_offplatform_contextual(
  p_text text,
  p_source text,
  p_source_id uuid,
  p_field text,
  p_actor uuid,
  p_conversation uuid,
  p_history boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g jsonb;
  g2 jsonb;
  kinds text[] := '{}';
  extra text;
  masked text;
  spans jsonb := '{}'::jsonb;
  sp_s int[] := '{}';
  sp_e int[] := '{}';
  v_client uuid;
  v_worker uuid;
  v_phone text;
  v_addr text;
  v_addr2 text;
  v_wphone text;
  v_hist text := '';
  tails text[] := '{}';
  streets text[] := '{}';
  height text;
  piso text;
  depto text;
  parts jsonb;
  matched boolean := false;
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN p_text;
  END IF;

  g := public.redact_offplatform_contact(p_text);
  SELECT coalesce(array_agg(value), '{}'::text[])
    INTO kinds
  FROM jsonb_array_elements_text(coalesce(g->'kinds', '[]'::jsonb));

  IF p_conversation IS NOT NULL
     AND to_regclass('public.profiles') IS NOT NULL
     AND to_regclass('public.conversations') IS NOT NULL THEN
    SELECT c.cliente_id, c.trabajador_id
      INTO v_client, v_worker
    FROM public.conversations c
    WHERE c.id = p_conversation;

    -- Teléfono y dirección se leen solo acá, dentro de SECURITY DEFINER.
    -- No se devuelven ni se escriben en el log: el otro participante ve el
    -- texto ya enmascarado, nunca el dato cargado.
    IF v_client IS NOT NULL THEN
      SELECT p.telefono, p.direccion_texto, p.direccion_completa
        INTO v_phone, v_addr, v_addr2
      FROM public.profiles p
      WHERE p.id = v_client;
    END IF;
    IF v_worker IS NOT NULL THEN
      SELECT p.telefono INTO v_wphone
      FROM public.profiles p
      WHERE p.id = v_worker;
    END IF;

    SELECT coalesce(array_agg(DISTINCT t), '{}'::text[])
      INTO tails
    FROM unnest(
      public._offplatform_phone_tails(v_phone) || public._offplatform_phone_tails(v_wphone)
    ) AS t
    WHERE t ~ '^[0-9]{8}$';

    parts := public._offplatform_address_parts(v_addr);
    IF coalesce(parts->>'height', '') = '' THEN
      parts := public._offplatform_address_parts(v_addr2);
    END IF;
    IF coalesce(parts->>'height', '') <> '' THEN
      SELECT coalesce(array_agg(value), '{}'::text[])
        INTO streets
      FROM jsonb_array_elements_text(coalesce(parts->'streets', '[]'::jsonb));
      height := parts->>'height';
      piso := parts->>'piso';
      depto := parts->>'depto';
    END IF;

    IF coalesce(p_history, false)
       AND p_actor IS NOT NULL
       AND to_regclass('public.messages') IS NOT NULL THEN
      SELECT coalesce(string_agg(q.body, ' ' ORDER BY q.created_at), '')
        INTO v_hist
      FROM (
        SELECT m.body, m.created_at
        FROM public.messages m
        WHERE m.conversation_id = p_conversation
          AND m.sender_id = p_actor
          AND coalesce(m.type, 'text') <> 'system'
          AND (p_source_id IS NULL OR m.id IS DISTINCT FROM p_source_id)
          AND coalesce(m.body, '') <> ''
        ORDER BY m.created_at DESC
        LIMIT 4
      ) q;
    END IF;

    spans := public._offplatform_profile_spans(
      p_text, v_hist, tails, streets, height, piso, depto
    );
    matched := coalesce((spans->>'matched')::boolean, false);
    IF matched THEN
      SELECT coalesce(array_agg(s ORDER BY ord), '{}'::int[]),
             coalesce(array_agg(e ORDER BY ord), '{}'::int[])
        INTO sp_s, sp_e
      FROM (
        SELECT a.ord,
               a.value::int AS s,
               b.value::int AS e
        FROM jsonb_array_elements_text(coalesce(spans->'starts', '[]'::jsonb)) WITH ORDINALITY AS a(value, ord)
        JOIN jsonb_array_elements_text(coalesce(spans->'ends', '[]'::jsonb)) WITH ORDINALITY AS b(value, ord)
          ON a.ord = b.ord
      ) pairs;
      masked := public._offplatform_apply_spans(p_text, sp_s, sp_e);
      g2 := public.redact_offplatform_contact(masked);
      masked := g2->>'text';
      FOR extra IN
        SELECT value FROM jsonb_array_elements_text(coalesce(g2->'kinds', '[]'::jsonb))
      LOOP
        IF NOT (extra = ANY (kinds)) THEN
          kinds := kinds || ARRAY[extra];
        END IF;
      END LOOP;
      IF NOT ('match_perfil' = ANY (kinds)) THEN
        kinds := kinds || ARRAY['match_perfil'];
      END IF;
    END IF;
  END IF;

  IF NOT matched THEN
    masked := g->>'text';
  END IF;

  IF coalesce(array_length(kinds, 1), 0) > 0 THEN
    INSERT INTO public.offplatform_contact_detections (actor_id, source, source_id, field_name, kinds)
    VALUES (p_actor, p_source, p_source_id, p_field, kinds);
  END IF;
  RETURN masked;
END;
$$;

COMMENT ON FUNCTION public.redact_offplatform_contextual(text, text, uuid, text, uuid, uuid, boolean) IS
  'Redacta el dato y, si el texto coincide con el teléfono o la dirección cargados de esa conversación, también. No devuelve ni registra el dato crudo.';

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

DROP FUNCTION IF EXISTS public.redact_offplatform_metadata(jsonb, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.redact_offplatform_metadata(
  p_metadata jsonb,
  p_source text,
  p_source_id uuid,
  p_actor uuid,
  p_conversation uuid
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
      redacted := public.redact_offplatform_contextual(val #>> '{}', p_source, p_source_id, key, p_actor, p_conversation, false);
      meta := jsonb_set(meta, ARRAY[key], to_jsonb(redacted), false);
    ELSIF jsonb_typeof(val) = 'array' THEN
      i := 0;
      FOR elem IN SELECT value FROM jsonb_array_elements(val) LOOP
        IF jsonb_typeof(elem) = 'string' THEN
          redacted := public.redact_offplatform_contextual(elem #>> '{}', p_source, p_source_id, key, p_actor, p_conversation, false);
          val := jsonb_set(val, ARRAY[i::text], to_jsonb(redacted), false);
        ELSIF jsonb_typeof(elem) = 'object' THEN
          FOREACH nested IN ARRAY keys LOOP
            IF jsonb_typeof(elem->nested) = 'string' THEN
              redacted := public.redact_offplatform_contextual(elem->>nested, p_source, p_source_id, nested, p_actor, p_conversation, false);
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
REVOKE ALL ON FUNCTION public._offplatform_to_digits(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._offplatform_phone_digits(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._offplatform_blank_noise(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._offplatform_phone_tails(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._offplatform_address_parts(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._offplatform_apply_spans(text, int[], int[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._offplatform_profile_spans(text, text, text[], text[], text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_offplatform_contact(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_offplatform_contextual(text, text, uuid, text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_offplatform_field(text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_offplatform_metadata(jsonb, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

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

  NEW.body := public.redact_offplatform_contextual(
    NEW.body, 'message', NEW.id, 'body', NEW.sender_id, NEW.conversation_id, true
  );
  NEW.metadata := public.redact_offplatform_metadata(
    coalesce(NEW.metadata, '{}'::jsonb), 'message', NEW.id, NEW.sender_id, NEW.conversation_id
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
  NEW.body := public.redact_offplatform_contextual(
    NEW.body, 'message', NEW.id, 'body', coalesce(auth.uid(), NEW.sender_id), NEW.conversation_id, true
  );
  NEW.metadata := public.redact_offplatform_metadata(
    coalesce(NEW.metadata, '{}'::jsonb), 'message', NEW.id, coalesce(auth.uid(), NEW.sender_id), NEW.conversation_id
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
  NEW.service_detail := public.redact_offplatform_contextual(
    NEW.service_detail, 'contratacion', NEW.id, 'service_detail', auth.uid(), NEW.conversation_id, false
  );
  NEW.recotizacion_fundamentos := public.redact_offplatform_contextual(
    NEW.recotizacion_fundamentos, 'contratacion', NEW.id, 'recotizacion_fundamentos', auth.uid(), NEW.conversation_id, false
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
DECLARE
  conv uuid;
BEGIN
  IF TG_TABLE_NAME = 'quotes' THEN
    IF to_regclass('public.material_requests') IS NOT NULL THEN
      SELECT mr.conversation_id INTO conv
      FROM public.material_requests mr
      WHERE mr.id = NEW.request_id;
    END IF;
    NEW.notes := public.redact_offplatform_contextual(NEW.notes, 'quote', NEW.id, 'notes', auth.uid(), conv, false);
  ELSIF TG_TABLE_NAME = 'quote_items' THEN
    IF to_regclass('public.quotes') IS NOT NULL AND to_regclass('public.material_requests') IS NOT NULL THEN
      SELECT mr.conversation_id INTO conv
      FROM public.quotes q
      JOIN public.material_requests mr ON mr.id = q.request_id
      WHERE q.id = NEW.quote_id;
    END IF;
    NEW.item_note := public.redact_offplatform_contextual(NEW.item_note, 'quote_item', NEW.id, 'item_note', auth.uid(), conv, false);
    NEW.alternative_description := public.redact_offplatform_contextual(NEW.alternative_description, 'quote_item', NEW.id, 'alternative_description', auth.uid(), conv, false);
    NEW.variant_label := public.redact_offplatform_contextual(NEW.variant_label, 'quote_item', NEW.id, 'variant_label', auth.uid(), conv, false);
  ELSIF TG_TABLE_NAME = 'request_items' THEN
    IF to_regclass('public.material_requests') IS NOT NULL THEN
      SELECT mr.conversation_id INTO conv
      FROM public.material_requests mr
      WHERE mr.id = NEW.request_id;
    END IF;
    NEW.description := public.redact_offplatform_contextual(NEW.description, 'request_item', NEW.id, 'description', auth.uid(), conv, false);
  ELSIF TG_TABLE_NAME = 'recotizaciones' THEN
    IF to_regclass('public.contrataciones') IS NOT NULL THEN
      SELECT c.conversation_id INTO conv
      FROM public.contrataciones c
      WHERE c.id = NEW.contratacion_id;
    END IF;
    NEW.fundamentos := public.redact_offplatform_contextual(NEW.fundamentos, 'recotizacion', NEW.id, 'fundamentos', auth.uid(), conv, false);
  ELSIF TG_TABLE_NAME = 'material_requests' THEN
    conv := NEW.conversation_id;
    NEW.title := public.redact_offplatform_contextual(NEW.title, 'material_request', NEW.id, 'title', auth.uid(), conv, false);
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
