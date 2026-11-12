-- #219 Antipuenteo en el perfil del trabajador.
-- Reconstruye public.redact_offplatform_contact desde el cuerpo en vivo
-- (idéntico a 20261026_antipuenteo_llamame, md5 d4d440719407839b1beb2d576d56ea9f)
-- y suma contactame / contactarme / contactenme a la misma lista de palabras.
-- En el perfil no se tapa con «•••»: se rechaza el guardado (cliente y trigger).
-- También se limpian textos ya guardados que violen la regla, sin dejar «•••».
-- El comercio no tiene un campo libre de descripción comparable; no se toca
-- su teléfono ni su domicilio (son datos propios del comercio).
-- No se otorga EXECUTE a anon.

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
  tok text;
  norm text;
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
  contact_words text[];
  spaced text;
  letters text;
  ci int;
  run_s int;
  run_e int;
  run_n int;
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
      -- Un monto con puntos (15.000) se ignora. 9 dígitos o más es teléfono.
      IF position('(?:\.[0-9]{3})' in pat) > 0 AND position('mil' in pat) = 0 THEN
        run_s := s;
        run_e := e;
        WHILE run_s > 1 AND substring(folded from run_s - 1 for 1) ~ '[0-9.-]' LOOP
          run_s := run_s - 1;
        END LOOP;
        WHILE run_e <= char_length(folded) AND substring(folded from run_e for 1) ~ '[0-9.-]' LOOP
          run_e := run_e + 1;
        END LOOP;
        run_n := length(regexp_replace(substring(folded from run_s for run_e - run_s), '[^0-9]', '', 'g'));
        IF run_n BETWEEN 9 AND 15 THEN
          pos := e;
          CONTINUE;
        END IF;
      END IF;
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
       AND NOT (length(digits) < 9 AND frag ~ '^[0-9]{1,3}(?:\.[0-9]{3})+$')
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

  -- Números y palabras mezclados: punto, guion o pegados. Desde 9 dígitos.
  -- «341.3434-once2»: «once2» no tiene límite de palabra entre la e y el 2.
  -- «15.000» no tiene una palabra de número.
  pos := 1;
  tok := '(?:(?:' || numword || ')[0-9]{1,4}|[0-9]{1,4}(?:' || numword || ')|(?:' || numword || ')|[0-9]{1,4})';
  pat := '\y' || tok || '(?:[.\s-]+' || tok || ')+\y';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(folded from s for e - s);
    norm := regexp_replace(frag, '\y(' || numword || ')([0-9]{1,4})(?![0-9])', '\1 \2', 'g');
    norm := regexp_replace(norm, '(?<![0-9])([0-9]{1,4})(' || numword || ')\y', '\1 \2', 'g');
    IF frag ~ ('\y(?:' || numword || ')(?:\y|[0-9])')
       AND public._offplatform_phone_digits(norm) BETWEEN 9 AND 15
       AND frag !~ '\y(?:mil|miles|lucas|luca|pesos|peso|millones|millon)\y'
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

  -- Decisión del 15/10: además del dato, se tapa la palabra que pide
  -- contacto. Solo esa palabra. Límite de palabra (\y) para no entrar en
  -- «tela», «hotel», «telón», «digital» ni «direccional».
  -- Mayúsculas y tildes ya están plegadas. También entra la variante con
  -- las letras separadas («d i r e c c i o n», «t.e.l») y «e-mail».
  -- La más larga primero: «t e l» no se come «t e l e f o n o».
  contact_words := ARRAY[
    'contactarme','contactenme','contactame',
    'direccion','domicilio','ubicacion','instagram','telefono','whatsapp',
    'celular','llamame','correo','llamar','email','insta','llama','dire','mail','cel','wsp','wpp','tel','ig'
  ];
  spaced := '';
  FOREACH word IN ARRAY contact_words LOOP
    letters := '';
    FOR ci IN 1..char_length(word) LOOP
      IF ci = 1 THEN
        letters := substring(word from ci for 1);
      ELSE
        letters := letters || '[\s._-]+' || substring(word from ci for 1);
      END IF;
    END LOOP;
    IF spaced <> '' THEN
      spaced := spaced || '|';
    END IF;
    spaced := spaced || letters;
  END LOOP;

  pos := 1;
  pat := '\y(?:' || array_to_string(contact_words, '|') || '|e[\s._-]+mail|' || spaced || ')\y';
  LOOP
    s := regexp_instr(folded, pat, pos, 1, 0);
    EXIT WHEN s = 0;
    e := regexp_instr(folded, pat, pos, 1, 1);
    EXIT WHEN e <= s;
    frag := substring(folded from s for e - s);
    word := regexp_replace(frag, '[^a-z]', '', 'g');
    IF word IN ('dire','direccion','domicilio','ubicacion') THEN
      kind := 'direccion';
    ELSIF word IN ('tel','telefono','cel','celular','llamame','llamar','llama') THEN
      kind := 'telefono';
    ELSIF word IN ('mail','email','correo') THEN
      kind := 'email';
    ELSE
      kind := 'canal';
    END IF;
    IF NOT public._offplatform_overlaps(s, e, ig_s, ig_e)
       AND NOT public._offplatform_overlaps(s, e, sp_s, sp_e) THEN
      sp_s := sp_s || s;
      sp_e := sp_e || e;
      sp_k := sp_k || ARRAY[kind];
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
  'Reemplaza el dato de contacto y la palabra que lo pide (dirección, teléfono, mail, whatsapp, ig, contactame y variantes, también con letras separadas) por •••. El mensaje se envía igual. En el perfil del trabajador esa detección se usa para rechazar el guardado, no para tapar.';

REVOKE ALL ON FUNCTION public.redact_offplatform_contact(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redact_offplatform_contact(text) TO postgres, service_role;

-- ¿El texto tiene un dato o un pedido de contacto? Misma capa que el chat.
CREATE OR REPLACE FUNCTION public._profile_text_has_offplatform(p_text text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  v := public.redact_offplatform_contact(p_text);
  RETURN coalesce(jsonb_array_length(v->'kinds'), 0) > 0
      OR coalesce(v->>'text', coalesce(p_text, '')) IS DISTINCT FROM coalesce(p_text, '');
END;
$$;

COMMENT ON FUNCTION public._profile_text_has_offplatform(text) IS
  'Uso interno: true si redact_offplatform_contact detecta un dato o un pedido de contacto.';

REVOKE ALL ON FUNCTION public._profile_text_has_offplatform(text) FROM PUBLIC, anon, authenticated, service_role;

-- Saca el dato de contacto del texto ya guardado, sin dejar «•••».
CREATE OR REPLACE FUNCTION public._profile_text_strip_offplatform(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v jsonb;
  out_text text;
BEGIN
  IF p_text IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT public._profile_text_has_offplatform(p_text) THEN
    RETURN p_text;
  END IF;
  v := public.redact_offplatform_contact(p_text);
  out_text := coalesce(v->>'text', p_text);
  -- Marcamos el hueco para no borrar «un»/«de» del resto de la frase.
  out_text := replace(out_text, '•••', chr(1));
  out_text := regexp_replace(
    out_text,
    '([[:space:]]+(al|a|el|la|de|del|tu|te|mi|su|un|una|por|con|en))+[[:space:]]*' || chr(1),
    chr(1),
    'gi'
  );
  out_text := regexp_replace(
    out_text,
    chr(1) || '[[:space:]]*((al|a|el|la|de|del|tu|te|mi|su|un|una|por|con|en)[[:space:]]+)*',
    '',
    'gi'
  );
  out_text := replace(out_text, chr(1), '');
  out_text := regexp_replace(out_text, '[[:space:]]+', ' ', 'g');
  out_text := regexp_replace(out_text, '[[:space:]]+([,.;:!?])', '\1', 'g');
  out_text := regexp_replace(out_text, '([,.;:!?]){2,}', '\1', 'g');
  out_text := trim(both ' '||chr(10)||chr(13)||chr(9)||'.,;:-' from out_text);
  IF out_text IS NULL OR btrim(out_text) = '' THEN
    -- professional_description es NOT NULL: dejamos cadena vacía, no NULL.
    RETURN '';
  END IF;
  RETURN out_text;
END;
$$;

COMMENT ON FUNCTION public._profile_text_strip_offplatform(text) IS
  'Uso interno: deja el texto del perfil sin el dato de contacto y sin «•••».';

REVOKE ALL ON FUNCTION public._profile_text_strip_offplatform(text) FROM PUBLIC, anon, authenticated, service_role;

-- Limpieza de filas ya guardadas (antes del trigger, para que el UPDATE no se rechace).
UPDATE public.profiles
SET professional_description = public._profile_text_strip_offplatform(professional_description),
    updated_at = now()
WHERE public._profile_text_has_offplatform(professional_description);

UPDATE public.profiles
SET professional_description_backup = public._profile_text_strip_offplatform(professional_description_backup)
WHERE public._profile_text_has_offplatform(professional_description_backup);

UPDATE public.jobs
SET descripcion = public._profile_text_strip_offplatform(descripcion)
WHERE public._profile_text_has_offplatform(descripcion);

UPDATE public.posts
SET description = public._profile_text_strip_offplatform(description)
WHERE public._profile_text_has_offplatform(description);

-- Rechaza el guardado en el servidor. No tapa con «•••».
CREATE OR REPLACE FUNCTION public.reject_offplatform_profile_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF public._profile_text_has_offplatform(NEW.professional_description) THEN
      RAISE EXCEPTION 'profile_contact_forbidden'
        USING ERRCODE = 'P0001',
              HINT = 'La dirección y el contacto se comparten por la app después del pago del costo de servicio. En la descripción no se puede incluir un teléfono, un mail, una red ni un pedido de contacto.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'jobs' THEN
    IF public._profile_text_has_offplatform(NEW.descripcion) THEN
      RAISE EXCEPTION 'profile_contact_forbidden'
        USING ERRCODE = 'P0001',
              HINT = 'La dirección y el contacto se comparten por la app después del pago del costo de servicio. En la descripción no se puede incluir un teléfono, un mail, una red ni un pedido de contacto.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'posts' THEN
    IF public._profile_text_has_offplatform(NEW.description) THEN
      RAISE EXCEPTION 'profile_contact_forbidden'
        USING ERRCODE = 'P0001',
              HINT = 'La dirección y el contacto se comparten por la app después del pago del costo de servicio. En la descripción no se puede incluir un teléfono, un mail, una red ni un pedido de contacto.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.reject_offplatform_profile_text() IS
  'Trigger: rechaza descripciones del perfil, oficios o publicaciones con datos de contacto.';

REVOKE ALL ON FUNCTION public.reject_offplatform_profile_text() FROM PUBLIC, anon, authenticated;
-- El trigger lo dispara el dueño de la tabla; no hace falta EXECUTE para clientes.

DROP TRIGGER IF EXISTS trg_profiles_reject_offplatform ON public.profiles;
CREATE TRIGGER trg_profiles_reject_offplatform
BEFORE INSERT OR UPDATE OF professional_description ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.reject_offplatform_profile_text();

DROP TRIGGER IF EXISTS trg_jobs_reject_offplatform ON public.jobs;
CREATE TRIGGER trg_jobs_reject_offplatform
BEFORE INSERT OR UPDATE OF descripcion ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.reject_offplatform_profile_text();

DROP TRIGGER IF EXISTS trg_posts_reject_offplatform ON public.posts;
CREATE TRIGGER trg_posts_reject_offplatform
BEFORE INSERT OR UPDATE OF description ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.reject_offplatform_profile_text();
