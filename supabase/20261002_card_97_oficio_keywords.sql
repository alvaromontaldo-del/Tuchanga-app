-- =============================================================================
-- Card #97 — Palabras clave por oficio para el buscador del cliente
-- Proyecto Supabase: TuChangaAPP (kyxehrxcdealbujvvnxp)
--
-- Qué hace:
--   1) Funciones de normalización y columna search_index (precalculada): minúsculas, sin acentos (la ñ se conserva),
--      sin palabras vacías («de», «la», «se», «me»…) y singular/plural simple.
--   2) Tabla public.oficio_keywords: palabras clave de los oficios que la app
--      todavía ofrece con un nombre distinto al del catálogo del admin.
--   3) Carga las palabras clave de cada oficio del catálogo oficial
--      (public.professional_trades.keywords).
--   4) Carga public.oficio_keywords.
--   5) search_workers_for_client y search_workers_public: se agrega UN criterio
--      más al filtro de texto (la búsqueda trae también a los profesionales
--      cuyo oficio tiene una palabra clave que coincide). Todo lo demás queda
--      igual que en producción (apellido NULL #117, ubicación redondeada #120,
--      atiende_urgencias #95, permisos).
--
-- Idempotente: se puede volver a correr.
-- Aplicado en producción el 2026-10-02 en 5 migraciones:
--   card_97_oficio_keywords_1_base, _2a_catalogo, _2b_catalogo, _3_nombres_app, _4_buscadores.
-- Para un nombre de oficio que la app guarda distinto al catálogo:
--   INSERT INTO public.oficio_keywords (oficio, keywords) VALUES ('<nombre exacto>', ARRAY['palabra']);
-- Para sumar palabras a un oficio nuevo del admin:
--   UPDATE public.professional_trades
--   SET keywords = keywords || ARRAY['palabra 1','palabra 2']
--   WHERE slug = '<slug>';
-- =============================================================================

-- 1) Normalización --------------------------------------------------------------

-- Minúsculas, sin tildes ni diéresis (la ñ se mantiene), solo letras/números.
CREATE OR REPLACE FUNCTION public.search_fold(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT btrim(regexp_replace(
    lower(translate(coalesce(p_text, ''),
      'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÇçÑ',
      'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuuccñ')),
    '[^a-z0-9ñ]+', ' ', 'g'))
$$;

-- Texto normalizado + sin palabras vacías + raíz simple de cada palabra
-- (calefones→calefon, luces→luz, cañerías→cañeria, enchufes/enchufe→enchuf).
-- Se aplica igual a la búsqueda y a las palabras clave, así coinciden.
CREATE OR REPLACE FUNCTION public.search_terms(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT coalesce(string_agg(w3, ' ' ORDER BY ord), '')
  FROM (
    SELECT ord,
           CASE WHEN length(w2) > 3 AND w2 ~ '[^aeiou]e$' THEN left(w2, -1) ELSE w2 END AS w3
    FROM (
      SELECT ord,
             CASE WHEN w1 ~ '..ce$' THEN left(w1, -2) || 'z' ELSE w1 END AS w2
      FROM (
        SELECT ord,
               CASE WHEN length(w) > 3 AND w ~ 's$' THEN left(w, -1) ELSE w END AS w1
        FROM regexp_split_to_table(public.search_fold(p_text), ' ') WITH ORDINALITY AS t(w, ord)
        WHERE w <> ''
          AND w <> ALL (ARRAY[
            'a','al','ante','con','de','del','desde','el','en','entre','es','esta','este','esto',
            'hay','la','las','le','les','lo','los','me','mi','mis','muy','o','para','pero','por',
            'que','se','si','sin','su','sus','te','tu','un','una','uno','unos','unas','y','ya','yo',
            'mio','mia','tengo','tiene','necesito','necesita','busco','buscando','quiero','alguien',
            'algun','alguna','alguno','urgente','urgencia','hola','favor','porfa','casa'
          ])
      ) s1
    ) s2
  ) s3
$$;

-- Lista de textos → lista de términos normalizados (sin repetidos ni vacíos).
CREATE OR REPLACE FUNCTION public.search_terms_array(p_texts text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x) FILTER (WHERE x <> ''), '{}'::text[])
  FROM (SELECT public.search_terms(e) AS x FROM unnest(coalesce(p_texts, '{}'::text[])) AS e) s
$$;

-- Índice de búsqueda precalculado del catálogo oficial (se recalcula solo cuando
-- el admin cambia nombre, categoría o palabras clave).
ALTER TABLE public.professional_trades
  ADD COLUMN IF NOT EXISTS search_index text[]
  GENERATED ALWAYS AS (
    public.search_terms_array(ARRAY[name, coalesce(category_name, '')] || coalesce(keywords, '{}'::text[]))
  ) STORED;

-- 2) Tabla para nombres de oficio de la app que no están en el catálogo del admin.
CREATE TABLE IF NOT EXISTS public.oficio_keywords (
  oficio     text PRIMARY KEY,           -- nombre tal cual se guarda en jobs.nombre_oficio
  slug_app   text,                        -- slug en src/data/rubros.json de la app
  keywords   text[] NOT NULL DEFAULT '{}'::text[],
  search_index text[] GENERATED ALWAYS AS (public.search_terms_array(ARRAY[oficio] || keywords)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.oficio_keywords ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oficio_keywords FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oficio_keywords TO authenticated;

DROP POLICY IF EXISTS oficio_keywords_admin_all ON public.oficio_keywords;
CREATE POLICY oficio_keywords_admin_all ON public.oficio_keywords
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Oficios (nombre normalizado) cuyo nombre, categoría o palabras clave coinciden
-- con lo que escribió el cliente. Coincide si:
--   a) la búsqueda contiene la palabra clave completa («arreglar placa madre» ⊃ «placa madre»), o
--   b) la búsqueda (≥ 5 letras) es el comienzo de la palabra clave («calef» → «calefón»).
CREATE OR REPLACE FUNCTION public.trade_names_for_query(p_query text)
RETURNS text[]
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path = ''
AS $$
  -- MATERIALIZED: la búsqueda se normaliza una sola vez (si no, se recalcula por cada palabra clave).
  WITH q AS MATERIALIZED (
    SELECT public.search_terms(p_query) AS t
  ),
  terms AS (
    SELECT pt.name AS oficio, k
    FROM public.professional_trades pt
    CROSS JOIN LATERAL unnest(pt.search_index) AS k
    WHERE pt.active = true
    UNION ALL
    SELECT ok.oficio, k
    FROM public.oficio_keywords ok
    CROSS JOIN LATERAL unnest(ok.search_index) AS k
  )
  SELECT coalesce(array_agg(DISTINCT public.search_fold(tm.oficio)), '{}'::text[])
  FROM terms tm, q
  WHERE length(q.t) >= 2
    AND (
      (' ' || q.t || ' ') LIKE ('% ' || tm.k || ' %')
      OR (length(q.t) >= 5 AND (' ' || tm.k) LIKE ('% ' || q.t || '%'))
    )
$$;

-- Permisos: las 3 funciones de normalización son puras (solo texto) y las usa la
-- columna calculada search_index, así que el admin (authenticated) las necesita
-- para crear/editar oficios. trade_names_for_query solo se usa dentro de los
-- buscadores (SECURITY DEFINER), así que no se expone.
REVOKE ALL ON FUNCTION public.search_fold(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_terms(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_terms_array(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trade_names_for_query(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_fold(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_terms(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_terms_array(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trade_names_for_query(text) TO service_role;

-- 3) Palabras clave del catálogo oficial (admin → Rubros → Profesionales)
UPDATE public.professional_trades AS pt
SET keywords = v.kw, updated_at = now()
FROM (VALUES
  ('adiestramiento-canino', ARRAY['adiestrador', 'adiestradora', 'adiestramiento', 'adiestramiento canino', 'adiestrar', 'entrenar perro', 'entrenar al perro', 'entrenador de perros', 'educador canino', 'educación canina', 'obediencia', 'obediencia básica', 'conducta', 'problemas de conducta', 'perro agresivo', 'agresividad', 'perro que muerde', 'perro que ladra', 'ladra mucho', 'tira de la correa', 'hace pis en casa', 'ensucia en casa', 'ansiedad por separación', 'cachorro', 'cachorros', 'socialización', 'etólogo', 'etología', 'perro de guardia', 'perro reactivo', 'rompe todo', 'perro']::text[]),
  ('aire-acondicionado-climatizacion', ARRAY['aire acondicionado', 'aire', 'aires acondicionados', 'split', 'splits', 'equipo de aire', 'instalación de aire', 'instalar aire', 'instalar split', 'service de aire', 'mantenimiento de aire', 'limpieza de split', 'limpieza de aire acondicionado', 'carga de gas del aire', 'recarga de gas', 'no enfría el aire', 'el aire no enfría', 'el aire no calienta', 'gotea el aire', 'pierde agua el split', 'ruido del aire', 'compresor', 'unidad exterior', 'unidad interior', 'condensadora', 'evaporadora', 'frigorista', 'refrigeración', 'técnico de aire', 'aire central', 'aire de ventana', 'aire portátil', 'inverter', 'frío calor', 'frío', 'calor', 'climatización', 'termostato', 'conductos de aire', 'caño de cobre', 'desinstalar aire', 'mover el aire', 'piso techo', 'deshumidificador', 'ventilación', 'instalación aire', 'mantenimiento aire']::text[]),
  ('albanileria', ARRAY['albañil', 'albanil', 'albañiles', 'albañilería', 'obra', 'construcción', 'construir', 'ampliación', 'ampliar la casa', 'refacción', 'refacciones', 'remodelación', 'reforma', 'reformas', 'mampostería', 'refacción mampostería', 'ladrillo', 'ladrillos', 'ladrillo hueco', 'bloque', 'bloques', 'levantar pared', 'pared nueva', 'tirar pared', 'romper pared', 'demoler', 'demolición', 'revoque', 'revocar', 'revoque grueso', 'revoque fino', 'grieta', 'grietas', 'rajadura', 'fisura', 'contrapiso', 'carpeta', 'hormigón', 'cemento', 'mezcla', 'losa', 'columna', 'viga', 'encadenado', 'cimientos', 'platea', 'vereda', 'veredas', 'parrilla', 'quincho', 'medianera', 'capa aisladora', 'humedad de cimientos', 'humedad ascendente', 'escalera de material', 'amurar', 'maestro mayor de obras', 'oficial albañil', 'muro', 'presupuesto de obra']::text[]),
  ('apoyo-escolar-nivelacion', ARRAY['apoyo escolar', 'maestra particular', 'maestra', 'profesor particular', 'profesora particular', 'clases particulares', 'clases de apoyo', 'tareas', 'ayuda con la tarea', 'deberes', 'primaria', 'secundaria', 'colegio', 'escuela', 'nivelación', 'refuerzo', 'matemática', 'matemáticas', 'lengua', 'ciencias naturales', 'ciencias sociales', 'historia', 'geografía', 'química', 'biología', 'lectoescritura', 'aprender a leer', 'comprensión lectora', 'previas', 'materias previas', 'rendir materias', 'psicopedagoga', 'psicopedagogía', 'maestra integradora', 'ortografía']::text[]),
  ('barberia-domicilio', ARRAY['barbero', 'barbería', 'barbero a domicilio', 'corte de pelo de hombre', 'corte masculino', 'corte de hombre', 'corte para hombre', 'degradé', 'fade', 'barba', 'arreglo de barba', 'perfilado de barba', 'diseño de barba', 'afeitado', 'afeitar', 'navaja', 'toalla caliente', 'bigote', 'rapado', 'peluquero de hombres', 'peluquería masculina', 'corte de pelo para nene', 'tintura de barba']::text[]),
  ('camaras-seguridad-cctv', ARRAY['cámaras de seguridad', 'cámara de seguridad', 'instalar cámaras', 'cámaras para casa', 'cámaras para comercio', 'cctv', 'videovigilancia', 'cámara ip', 'cámara wifi', 'cámaras wifi', 'cámara exterior', 'visión nocturna', 'dvr', 'nvr', 'grabador de cámaras', 'domo', 'cámara domo', 'monitoreo', 'ver las cámaras desde el celular', 'configurar cámaras', 'alarma', 'alarmas', 'alarma para casa', 'sistema de alarma', 'sensores de alarma', 'sensor de apertura', 'sirena', 'central de alarma', 'panel de alarma', 'seguridad electrónica', 'cerco eléctrico', 'cerco electrificado', 'videoportero', 'video portero', 'portero visor', 'control de acceso', 'lector de huella', 'cableado de cámaras']::text[]),
  ('carpinteria', ARRAY['carpintero', 'carpintería', 'madera', 'muebles a medida', 'mueble a medida', 'placard a medida', 'vestidor', 'mueble de cocina a medida', 'puerta de madera', 'puertas de madera', 'cambiar puerta', 'colocar puerta', 'la puerta roza', 'cepillar puerta', 'marcos', 'marco de puerta', 'ventanas de madera', 'aberturas', 'aberturas de madera', 'deck', 'decks', 'pérgola', 'machimbre', 'melamina', 'mdf', 'restauración de muebles', 'restaurar muebles', 'laqueado', 'lustrado', 'lustrar', 'barniz', 'barnizar', 'escalera de madera', 'estantes', 'repisas', 'zócalos de madera', 'tarima', 'cama a medida', 'mesa a medida', 'carcoma', 'herrajes', 'correderas', 'cajones', 'biblioteca a medida', 'casita de madera', 'ebanista']::text[]),
  ('catering-y-banquetería', ARRAY['catering', 'catering para eventos', 'banquetería', 'servicio de catering', 'comida para eventos', 'comida para fiestas', 'lunch', 'finger food', 'bocaditos', 'canapés', 'sándwiches de miga', 'sanguchitos', 'mesa dulce', 'candy bar', 'pizza party', 'parrillada', 'asador', 'asado para eventos', 'parrillero', 'paella', 'chef a domicilio', 'cocinero', 'cocinera', 'viandas', 'empanadas', 'servicio de comida', 'menú para casamiento', 'mesa de quesos', 'picada', 'picadas', 'buffet', 'coffee break', 'desayuno empresarial', 'cena', 'comida evento']::text[]),
  ('cerrajeria', ARRAY['cerrajero', 'cerrajería', 'cerradura', 'cerraduras', 'llave', 'llaves', 'copia de llave', 'copia de llaves', 'duplicado de llave', 'me quedé afuera', 'me quede encerrado', 'abrir puerta', 'apertura de puertas', 'apertura de autos', 'abrir auto', 'llave trabada', 'llave rota', 'llave rota adentro', 'perdí las llaves', 'cambio de cerradura', 'cambiar cerradura', 'cambio de combinación', 'cambiar combinación', 'cilindro', 'cerradura de seguridad', 'cerradura multipunto', 'cerrojo', 'pasador', 'candado', 'puerta blindada', 'puerta trabada', 'cerradura electrónica', 'cerradura digital', 'caja fuerte', 'llave codificada', 'llave de auto', 'picaporte', 'traba', 'bocallave', 'cerrajero 24 horas', 'seguridad hogar', 'apertura', 'copiado de llave']::text[]),
  ('chofer-privado-traslados', ARRAY['chofer', 'chofer privado', 'conductor', 'remis', 'remise', 'remisero', 'traslado', 'traslados', 'traslado al aeropuerto', 'aeropuerto', 'ezeiza', 'aeroparque', 'viaje', 'viajes', 'llevar y traer', 'transfer', 'auto con chofer', 'chofer por hora', 'chofer para eventos', 'chofer para casamiento', 'traslado de personas', 'traslado de adultos mayores', 'llevar al médico', 'traslado a clínica', 'chofer de confianza', 'manejar mi auto', 'chofer para mi auto', 'viaje larga distancia', 'combi', 'transporte escolar', 'terminal de ómnibus', 'auto privado']::text[]),
  ('clases-arte-manualidades', ARRAY['clases de arte', 'arte', 'dibujo', 'clases de dibujo', 'pintura artística', 'clases de pintura', 'óleo', 'acuarela', 'pintura acrílica', 'cerámica artística', 'alfarería', 'torno de cerámica', 'modelado', 'escultura', 'manualidades', 'taller de manualidades', 'artesanías', 'bordado', 'tejido', 'tejer', 'crochet', 'macramé', 'costura', 'coser', 'corte y confección', 'telar', 'mosaiquismo', 'decoupage', 'lettering', 'caligrafía', 'historieta', 'taller creativo', 'arte para chicos', 'origami']::text[]),
  ('clases-idiomas', ARRAY['clases de inglés', 'inglés', 'profesor de inglés', 'profesora de inglés', 'portugués', 'francés', 'italiano', 'alemán', 'chino', 'japonés', 'español para extranjeros', 'idiomas', 'idioma', 'clases de idiomas', 'profesor idiomas', 'conversación', 'first certificate', 'toefl', 'ielts', 'cambridge', 'traductor', 'traductora', 'traducción', 'traductor público', 'inglés para viajar', 'inglés para el trabajo', 'business english', 'inglés para chicos', 'lengua de señas']::text[]),
  ('clases-musica', ARRAY['clases de música', 'música', 'profesor de música', 'profesor música', 'guitarra', 'clases de guitarra', 'guitarra eléctrica', 'piano', 'clases de piano', 'teclado musical', 'clases de teclado', 'canto', 'clases de canto', 'técnica vocal', 'clases de batería', 'batería musical', 'bajo eléctrico', 'violín', 'violonchelo', 'cello', 'saxo', 'saxofón', 'flauta', 'ukelele', 'acordeón', 'bandoneón', 'charango', 'solfeo', 'lenguaje musical', 'producción musical', 'percusión', 'cajón peruano']::text[]),
  ('colocacion-ceramica-porcelanato', ARRAY['cerámica', 'cerámicas', 'cerámico', 'cerámicos', 'porcelanato', 'porcelanatos', 'colocador', 'colocador de cerámica', 'colocación de cerámicos', 'colocar cerámica', 'colocar porcelanato', 'baldosa', 'baldosas', 'azulejo', 'azulejos', 'revestimiento de baño', 'revestir el baño', 'revestimiento de cocina', 'salpicadero', 'piso', 'pisos', 'cambiar el piso', 'piso nuevo', 'zócalo', 'zócalos', 'pastina', 'pastinar', 'cerámica rota', 'cerámica levantada', 'cerámica floja', 'nivelación de piso', 'carpeta', 'pegamento para cerámica', 'guardas', 'mosaiquista', 'piedra', 'revestimiento de piedra', 'piedra laja', 'laja', 'gres', 'venecitas']::text[]),
  ('control-plagas-fumigacion', ARRAY['fumigación', 'fumigar', 'fumigador', 'control de plagas', 'plagas', 'plaga', 'desinsectación', 'desratización', 'cucarachas', 'cucaracha', 'hormigas', 'hormiguero', 'ratas', 'ratones', 'roedores', 'laucha', 'lauchas', 'pulgas', 'garrapatas', 'chinches', 'chinches de cama', 'mosquitos', 'moscas', 'termitas', 'polillas', 'alacranes', 'escorpiones', 'arañas', 'avispas', 'panal de avispas', 'abejas', 'enjambre', 'murciélagos', 'palomas', 'vinchucas', 'gorgojos', 'carcoma', 'cebos', 'gel para cucarachas', 'desinfección de ambientes', 'bichos', 'insectos', 'fumigación de jardín', 'fumigación de comercio', 'desinfección']::text[]),
  ('corte-color-peinado', ARRAY['peluquería', 'peluquera', 'peluquero', 'peluquería a domicilio', 'corte de pelo', 'cortar el pelo', 'corte de cabello', 'corte de mujer', 'corte de dama', 'tintura', 'teñir', 'teñirse el pelo', 'color de pelo', 'coloración', 'reflejos', 'mechas', 'balayage', 'baby lights', 'decoloración', 'decolorar', 'matizar', 'canas', 'cubrir canas', 'brushing', 'planchita', 'ondas', 'peinado', 'peinados', 'peinado de novia', 'peinado para fiesta', 'recogido', 'trenzas', 'alisado', 'alisado definitivo', 'flequillo', 'despuntar', 'puntas', 'permanente', 'extensiones de pelo', 'corte de pelo para chicos']::text[]),
  ('depilacion', ARRAY['depilación', 'depilar', 'depiladora', 'depilarse', 'cera', 'depilación con cera', 'cera descartable', 'cera caliente', 'cera tibia', 'láser', 'depilación láser', 'láser a domicilio', 'depilación definitiva', 'luz pulsada', 'piernas', 'media pierna', 'pierna entera', 'axilas', 'cavado', 'cavado profundo', 'tira de cola', 'bozo', 'rostro', 'brazos', 'espalda', 'pecho', 'depilación masculina', 'depilación con hilo']::text[]),
  ('destapaciones', ARRAY['destapación', 'destapaciones', 'destapar', 'destapador', 'destapar cañería', 'destapar caño', 'destapar inodoro', 'destapar pileta', 'destapar bacha', 'destapar cloaca', 'destapar desagüe', 'cloaca', 'cloacas', 'desagüe', 'desagües', 'desagüe tapado', 'cañería tapada', 'caño tapado', 'inodoro tapado', 'pileta tapada', 'bacha tapada', 'rejilla tapada', 'pileta de patio', 'cámara séptica', 'pozo ciego', 'desagote de pozo ciego', 'desagote', 'atmosférico', 'camión atmosférico', 'olor a cloaca', 'sale agua por la rejilla', 'se tapó', 'tapado', 'tapada', 'rebalsa el inodoro', 'rebalsa', 'sopapa', 'máquina destapadora', 'sonda', 'cinta destapadora', 'hidrojet', 'grasa en la cañería', 'cámara de inspección', 'cámara de grasa', 'no traga', 'desagota lento', 'cañerías', 'inodoro']::text[]),
  ('dj-sonido', ARRAY['DJ', 'disc jockey', 'djs', 'música para fiesta', 'musicalización', 'musicalizar', 'sonido', 'sonido para eventos', 'alquiler de sonido', 'equipo de sonido', 'parlantes', 'micrófono', 'micrófonos', 'luces para fiesta', 'iluminación para eventos', 'pista de baile', 'máquina de humo', 'karaoke', 'fiesta', 'fiestas', 'dj para casamiento', 'dj para 15', 'fiesta de 15', 'música en vivo', 'banda', 'sonidista', 'sonido para conferencias', 'pantalla led para eventos']::text[]),
  ('domotica-hogar-inteligente', ARRAY['domótica', 'casa inteligente', 'hogar inteligente', 'smart home', 'automatización', 'automatizar la casa', 'alexa', 'google home', 'asistente de voz', 'enchufe inteligente', 'enchufes inteligentes', 'lámpara inteligente', 'luces inteligentes', 'luces smart', 'foco inteligente', 'foco wifi', 'interruptor inteligente', 'llave inteligente', 'tecla inteligente', 'sensor wifi', 'cortinas motorizadas', 'persiana inteligente', 'cerradura inteligente', 'termostato inteligente', 'riego inteligente', 'control desde el celular', 'control remoto universal', 'zigbee', 'timbre inteligente', 'timbre con cámara', 'portero inteligente']::text[]),
  ('drywall-pladur-cielorrasos', ARRAY['durlock', 'durloc', 'durlok', 'durlockero', 'construcción en seco', 'steel framing', 'drywall', 'pladur', 'placa de yeso', 'placas de yeso', 'tabique', 'tabiques', 'tabique de durlock', 'pared de durlock', 'dividir ambiente', 'división de ambientes', 'cielorraso', 'cielorrasos', 'cielo raso', 'techo de durlock', 'cielorraso suspendido', 'falso techo', 'cielorraso desmontable', 'buña', 'molduras', 'cornisas', 'garganta de luz', 'yeso', 'yesero', 'yesería', 'aplicado de yeso', 'masillado', 'cinta de junta', 'placa verde', 'placa antihumedad', 'placard de durlock', 'mueble de durlock', 'aislación acústica', 'aislación térmica', 'lana de vidrio', 'perfiles', 'montantes', 'agujero en el durlock']::text[]),
  ('educacion-fisica-personal-trainer', ARRAY['personal trainer', 'entrenador personal', 'entrenador', 'entrenamiento', 'entrenar', 'profesor de educación física', 'educación física', 'gimnasia', 'gym', 'gimnasio a domicilio', 'rutina', 'rutina de ejercicios', 'ejercicio', 'ejercicios', 'funcional', 'entrenamiento funcional', 'crossfit', 'pilates', 'yoga', 'stretching', 'elongación', 'bajar de peso', 'adelgazar', 'tonificar', 'musculación', 'running', 'correr', 'preparación física', 'gimnasia para adultos mayores', 'plan de entrenamiento', 'fitness', 'boxeo', 'kickboxing', 'zumba', 'clases de baile', 'clases de natación']::text[]),
  ('electricidad', ARRAY['electricista', 'electricidad', 'eléctrico', 'luz', 'sin luz', 'se cortó la luz', 'me quedé sin luz', 'corte de luz', 'no hay luz', 'salta la térmica', 'se baja la térmica', 'térmica', 'térmicas', 'termomagnética', 'termomagneticas', 'llave térmica', 'disyuntor', 'disyuntor diferencial', 'diferencial', 'salta el disyuntor', 'cortocircuito', 'corto circuito', 'chispazo', 'olor a quemado', 'cables', 'cable', 'cableado eléctrico', 'recableado', 'instalación eléctrica', 'tablero', 'tablero eléctrico', 'enchufe', 'enchufes', 'toma', 'tomas', 'tomacorriente', 'tomacorrientes', 'toma corriente', 'ficha', 'interruptor', 'llave de luz', 'tecla de luz', 'punto de luz', 'lámpara', 'lámparas', 'foco', 'focos', 'artefacto de iluminación', 'plafón', 'colgante', 'iluminación', 'luces led', 'led', 'tira led', 'aplique', 'spot', 'dicroica', 'luz exterior', 'sensor de movimiento', 'fotocélula', 'reflector', 'timbre', 'portero eléctrico', 'ventilador de techo', 'puesta a tierra', 'jabalina', 'medidor de luz', 'pilar de luz', 'acometida', 'monofásico', 'trifásico', 'aumento de potencia', 'certificado eléctrico', 'matriculado', 'estabilizador', 'grupo electrógeno', 'generador', 'extractor de baño']::text[]),
  ('fletes-mini-fletes', ARRAY['flete', 'fletes', 'fletero', 'mini flete', 'mini fletes', 'miniflete', 'camioneta', 'camioneta con chofer', 'utilitario', 'carga', 'carga chica', 'trasladar muebles', 'traslado de muebles', 'llevar una heladera', 'llevar un mueble', 'traslado de electrodomésticos', 'bultos', 'cajas', 'mudanza chica', 'mini mudanza', 'retiro de muebles', 'retirar una compra', 'entrega de compra', 'llevar cosas', 'ayudante para cargar', 'peón', 'peones', 'carga y descarga', 'mudanza', 'mudanzas', 'mudarse', 'me mudo', 'mudanza completa', 'mudanza de departamento', 'mudanza de casa', 'mudanza de oficina', 'mudanza larga distancia', 'embalaje', 'embalar', 'cajas de mudanza', 'furgón', 'camión de mudanza', 'guardamuebles', 'baulera', 'desarme y armado de muebles', 'izaje', 'izaje por balcón', 'traslado de piano', 'cargar y descargar', 'mudanza express', 'traslado hogar']::text[]),
  ('fotografia-eventos', ARRAY['fotógrafo', 'fotógrafa', 'fotografía', 'fotos', 'sacar fotos', 'fotógrafo de eventos', 'fotógrafo de casamiento', 'casamiento', 'boda', 'cumpleaños de 15', 'cumpleaños 15', 'fiesta de 15', 'book de 15', 'book', 'book de fotos', 'sesión de fotos', 'fotos de familia', 'fotos de embarazo', 'newborn', 'fotos de bebé', 'fotos de producto', 'fotografía de producto', 'fotos para inmobiliaria', 'fotos corporativas', 'retrato', 'retratos', 'álbum de fotos', 'cobertura fotográfica', 'bautismo', 'comunión', 'egresados', 'fotos de egresados', 'cabina de fotos', 'edición de fotos']::text[]),
  ('gasista', ARRAY['gasista', 'gasista matriculado', 'gas', 'gas natural', 'gas envasado', 'garrafa', 'tubo de gas', 'olor a gas', 'pérdida de gas', 'escape de gas', 'fuga de gas', 'corte de gas', 'me cortaron el gas', 'sin gas', 'prueba de hermeticidad', 'hermeticidad', 'rehabilitación de gas', 'instalación de gas', 'instalación gas', 'cañería de gas', 'caño de gas', 'conexión de gas', 'flexible de gas', 'llave de paso de gas', 'regulador de gas', 'calefón', 'calefones', 'calefont', 'el calefón no prende', 'piloto', 'se apaga el piloto', 'termocupla', 'termotanque', 'termotanques', 'termotanque a gas', 'termo', 'caldera', 'calderas', 'calefacción', 'calefacción central', 'losa radiante', 'radiadores', 'estufa', 'estufas', 'tiro balanceado', 'estufa a gas', 'cocina a gas', 'horno a gas', 'anafe a gas', 'hornalla', 'hornallas', 'el horno no prende', 'monóxido', 'monóxido de carbono', 'ventilación reglamentaria', 'rejillas de ventilación', 'plano de gas', 'artefactos de gas', 'conversión a gas natural', 'agua caliente', 'no sale agua caliente', 'no tengo agua caliente']::text[]),
  ('herreria-soldadura', ARRAY['herrero', 'herrería', 'soldador', 'soldadura', 'soldar', 'soldadura eléctrica', 'soldadura mig', 'soldadura tig', 'reja', 'rejas', 'rejas de seguridad', 'reja de ventana', 'portón', 'portones', 'portón levadizo', 'portón corredizo', 'motor de portón', 'puerta de hierro', 'puerta de chapa', 'cerco perimetral', 'alambrado', 'tejido romboidal', 'baranda', 'barandas', 'barandal', 'escalera caracol', 'escalera de hierro', 'estructura metálica', 'estructura de hierro', 'perfiles de hierro', 'vigas de hierro', 'tinglado', 'galpón', 'pérgola de hierro', 'parrilla de hierro', 'hierro', 'hierro forjado', 'acero inoxidable', 'carpintería metálica', 'aberturas de hierro', 'ventanas de hierro', 'aberturas de aluminio', 'óxido', 'caño estructural', 'bisagra de portón']::text[]),
  ('impermeabilizacion', ARRAY['impermeabilización', 'impermeabilizar', 'impermeabilizante', 'membrana', 'membrana líquida', 'membrana asfáltica', 'membrana en pasta', 'colocar membrana', 'techo', 'terraza', 'azotea', 'losa', 'filtración', 'filtraciones', 'se filtra agua', 'gotera', 'goteras', 'gotea el techo', 'llueve adentro', 'entra agua', 'humedad', 'humedad en el techo', 'humedad en la pared', 'manchas de humedad', 'humedad techo', 'salitre', 'moho', 'hongos en la pared', 'sellador', 'sellado', 'juntas de dilatación', 'babetas', 'hidrófugo', 'pintura impermeable', 'poliuretano', 'subsuelo']::text[]),
  ('instalacion-audio-tv-streaming', ARRAY['instalar tele', 'instalar televisor', 'instalación de tv', 'colgar tele', 'colgar la tele', 'colgar televisor', 'soporte de tv', 'soporte para tv', 'amurar tv', 'televisor', 'tele', 'tv', 'smart TV', 'configurar smart tv', 'home theater', 'parlantes', 'barra de sonido', 'soundbar', 'equipo de música', 'audio', 'amplificador', 'subwoofer', 'sonido ambiental', 'proyector', 'instalar proyector', 'pantalla de proyección', 'Chromecast', 'Apple TV', 'fire tv', 'tv box', 'android tv', 'antena', 'antena de tv', 'tda', 'televisión digital', 'decodificador', 'streaming', 'hdmi', 'cable hdmi', 'ocultar cables de la tele', 'cine en casa']::text[]),
  ('jardineria-poda', ARRAY['jardinero', 'jardinería', 'jardin', 'parque', 'mantenimiento de parque', 'pasto', 'cortar pasto', 'corte de pasto', 'cortar el césped', 'cortadora de césped', 'desmalezar', 'desmalezado', 'malezas', 'yuyos', 'poda', 'podar', 'podar árboles', 'poda de árboles', 'tala', 'tala de árboles', 'extracción de árboles', 'árbol', 'árboles', 'cerco vivo', 'ligustro', 'setos', 'plantas', 'plantar', 'canteros', 'césped', 'colocación de césped', 'panes de pasto', 'tepes', 'riego', 'riego automático', 'aspersores', 'paisajismo', 'paisajista', 'diseño de jardín', 'huerta', 'abono', 'fertilizante', 'limpieza de jardín', 'limpieza de terreno', 'terreno baldío', 'bordeadora', 'motoguadaña', 'ramas', 'hojas', 'palmera', 'enredaderas', 'macetas', 'vivero']::text[]),
  ('limpieza-posobra', ARRAY['limpieza posobra', 'limpieza post obra', 'limpieza pos obra', 'limpieza de obra', 'limpieza fin de obra', 'limpieza final de obra', 'limpieza de obra nueva', 'pos obra', 'post obra', 'después de la obra', 'después de pintar', 'restos de pintura', 'manchas de pintura', 'restos de cemento', 'sacar cemento', 'sacar pastina', 'polvo de obra', 'polvo construcción', 'limpieza fina obra', 'limpieza gruesa', 'retiro de escombros', 'escombros', 'limpieza después de remodelación', 'limpieza de vidrios de obra', 'hidrolavadora', 'hidrolavado', 'ácido muriático', 'desincrustar', 'entrega de obra', 'pintura recién']::text[]),
  ('limpieza-residencial-profunda', ARRAY['limpieza', 'limpieza de casa', 'limpieza de casas', 'limpieza de departamento', 'limpiar la casa', 'limpieza profunda', 'limpieza general', 'limpieza a fondo', 'empleada doméstica', 'empleada', 'mucama', 'personal de limpieza', 'señora de limpieza', 'servicio doméstico', 'doméstica', 'limpieza por horas', 'limpieza semanal', 'limpieza de oficina', 'limpieza de oficinas', 'limpieza de cocina', 'desengrasar', 'limpieza de baño', 'sarro', 'limpieza de vidrios', 'limpiar ventanas', 'limpieza de alfombras', 'lavado de alfombras', 'limpieza de sillones', 'lavado de sillones', 'lavado de tapizados', 'tapizados', 'limpieza de colchón', 'colchones', 'planchado', 'planchar', 'ordenar la casa', 'organización del hogar', 'limpieza de horno', 'limpieza fin de alquiler', 'limpieza de mudanza', 'sanitización', 'desinfección del hogar', 'limpieza airbnb', 'limpieza de cortinas']::text[]),
  ('manicuria-pedicuria', ARRAY['manicura', 'manicuría', 'manicurista', 'pedicura', 'pedicuría', 'uñas', 'uña', 'uñas esculpidas', 'esculpidas', 'uñas acrílicas', 'uñas de gel', 'esmaltado en gel', 'kapping', 'capping', 'semipermanente', 'esmaltado', 'esmaltado semipermanente', 'esmalte de uñas', 'nail art', 'decoración de uñas', 'soft gel', 'tips', 'callos', 'callosidades', 'uña encarnada', 'podología', 'podólogo', 'cutículas', 'spa de pies', 'spa de manos', 'belleza de pies']::text[]),
  ('mantenimiento-electrodomesticos', ARRAY['electrodomésticos', 'electrodomestico', 'técnico de electrodomésticos', 'service de electrodomésticos', 'reparación electrodomésticos', 'heladera', 'heladeras', 'freezer', 'la heladera no enfría', 'heladera no enfría', 'heladera no frost', 'no frost', 'carga de gas heladera', 'burlete de heladera', 'lavarropas', 'lavarropa', 'el lavarropas no centrifuga', 'no centrifuga', 'no desagota', 'pierde agua el lavarropas', 'secarropas', 'lavasecarropas', 'lavavajillas', 'lavaplatos', 'horno eléctrico', 'horno', 'el horno no calienta', 'anafe eléctrico', 'anafe de inducción', 'microondas', 'cocina eléctrica', 'cafetera', 'aspiradora', 'campana de cocina', 'purificador', 'dispenser de agua', 'motor de lavarropas', 'plaqueta', 'bomba de desagote', 'resistencia', 'tambor', 'rulemanes', 'frigobar', 'cava de vinos', 'ventilador', 'estufa eléctrica', 'caloventor', 'secador de pelo', 'plancha']::text[]),
  ('mantenimiento-piscinas', ARRAY['pileta', 'piletas', 'piscina', 'piscinas', 'pileta de natación', 'piletero', 'limpieza de pileta', 'mantenimiento de pileta', 'agua verde', 'pileta verde', 'cloro', 'cloración', 'ph', 'alguicida', 'clarificador', 'filtro de pileta', 'filtro', 'bomba de pileta', 'arena del filtro', 'barrefondo', 'limpiafondo', 'limpieza de fondo', 'vaciar pileta', 'pintar pileta', 'pileta de fibra', 'pileta de material', 'venecitas', 'lona de pileta', 'pileta estructural', 'climatizar pileta', 'cubre pileta', 'apertura de temporada', 'skimmer', 'pastillas de cloro', 'electrólisis salina', 'jacuzzi', 'hidromasaje']::text[]),
  ('maquillaje-profesional', ARRAY['maquillaje', 'maquillaje profesional', 'maquilladora', 'maquillador', 'maquillar', 'make up', 'makeup', 'maquillaje social', 'maquillaje de novia', 'novias', 'maquillaje para casamiento', 'maquillaje para fiesta', 'maquillaje para 15', 'maquillaje artístico', 'maquillaje de fantasía', 'caracterización', 'maquillaje para fotos', 'maquillaje para eventos', 'pestañas postizas', 'maquillaje de noche', 'automaquillaje', 'curso de maquillaje', 'peinado y maquillaje']::text[]),
  ('masajes-terapias-manuales', ARRAY['masaje', 'masajes', 'masajista', 'masajes a domicilio', 'masaje relajante', 'relajante', 'masaje descontracturante', 'descontracturante', 'contractura', 'contracturas', 'dolor de espalda', 'dolor de cuello', 'cervicales', 'masaje deportivo', 'masaje terapéutico', 'drenaje linfático', 'piedras calientes', 'reflexología', 'shiatsu', 'quiropraxia', 'reiki', 'masaje con aceites', 'masaje para embarazadas', 'masaje en pareja', 'piernas cansadas', 'masoterapia', 'terapias manuales', 'masaje kinesiológico', 'relax', 'estrés']::text[]),
  ('montaje-muebles', ARRAY['armado de muebles', 'armar muebles', 'armador de muebles', 'montaje de muebles', 'muebles para armar', 'muebles en caja', 'armado de placard', 'armar placard', 'placard', 'ropero', 'armario', 'armar cama', 'cucheta', 'rack TV', 'rack de tv', 'mesa', 'sillas', 'escritorio', 'biblioteca', 'estantería', 'mueble de cocina', 'alacena', 'bajo mesada', 'vanitory', 'cajonera', 'cómoda', 'desarmar muebles', 'desarmado de muebles', 'mueble flotante', 'cuna', 'muebles de melamina', 'muebles de jardín', 'sommier', 'respaldo de cama', 'zapatero', 'mueble de tv']::text[]),
  ('organizacion-integral-eventos', ARRAY['organizador de eventos', 'organizadora de eventos', 'organización de eventos', 'organizar un evento', 'organizar una fiesta', 'organizar casamiento', 'wedding planner', 'event planner', 'productor', 'producción de eventos', 'productora de eventos', 'coordinador de eventos', 'coordinación de eventos', 'logística evento', 'eventos corporativos', 'evento empresarial', 'fiesta de empresa', 'fiesta de fin de año', 'cumpleaños de 15', 'fiesta de 15', 'casamiento', 'boda', 'aniversario', 'baby shower', 'bautismo', 'comunión', 'despedida de soltera', 'salón de fiestas', 'alquiler de salón', 'alquiler de vajilla', 'alquiler de mobiliario', 'carpas', 'gazebos', 'ceremonista', 'evento', 'eventos', 'fiesta']::text[]),
  ('paseo-perros', ARRAY['paseador', 'paseadora', 'paseador de perros', 'paseadores', 'paseo de perros', 'paseo de perro', 'pasear perro', 'pasear al perro', 'pasear mi perro', 'paseo canino', 'paseos', 'salidas', 'perro', 'perros', 'ejercicio para perros', 'ejercicio canino', 'dog walker', 'paseo grupal', 'paseo individual', 'paseo diario', 'sacar al perro', 'perro con mucha energía']::text[]),
  ('peluqueria-canina', ARRAY['peluquería canina', 'peluquero canino', 'grooming', 'groomer', 'baño de perro', 'bañar al perro', 'bañar perro', 'baño y corte', 'corte de pelo de perro', 'corte de pelo mascota', 'corte de perro', 'deslanado', 'deslanar', 'corte de uñas de perro', 'uñas mascota', 'limpieza de oídos', 'peluquería para gatos', 'baño de gato', 'estética canina', 'peluquería móvil', 'corte higiénico', 'cepillado', 'perro']::text[]),
  ('persianas-cortinas', ARRAY['persiana', 'persianas', 'persianista', 'cortina de enrollar', 'persiana de enrollar', 'cinta de persiana', 'cambiar cinta', 'enrollador', 'persiana trabada', 'la persiana no sube', 'la persiana no baja', 'tablillas', 'lamas', 'persiana de aluminio', 'persiana de pvc', 'motor de persiana', 'motorización', 'persiana eléctrica', 'cortina', 'cortinas', 'cortina roller', 'roller', 'enrollable', 'blackout', 'black out', 'sunscreen', 'cortina americana', 'cortinas de tela', 'barral', 'rieles de cortina', 'confección de cortinas', 'toldo', 'toldos', 'mosquitero', 'mosquiteros', 'celosía', 'postigo', 'cajón de persiana']::text[]),
  ('pintura-obras', ARRAY['pintor', 'pintores', 'pintura', 'pinturas', 'pintar', 'pintar la casa', 'pintar departamento', 'pintar pared', 'pintar paredes', 'pintar techo', 'pintar rejas', 'pintar puertas', 'pintar fachada', 'pintar frente', 'pintura interior', 'pintura exterior', 'interior', 'exterior', 'fachada', 'frente', 'látex', 'esmalte sintético', 'enduido', 'enduir', 'masilla', 'lijar paredes', 'revestimiento', 'revestimiento plástico', 'revestimiento texturado', 'tarquini', 'pintura de techo', 'pintura antihumedad', 'empapelado', 'empapelar', 'papel tapiz', 'pintura epoxi', 'pintar piso', 'retoques de pintura', 'paredes descascaradas', 'pintura descascarada', 'fijador', 'trabajos en altura', 'silletero', 'hidrolavado de frentes']::text[]),
  ('plomeria', ARRAY['plomero', 'plomería', 'sanitarista', 'instalación sanitaria', 'agua', 'pérdida de agua', 'pierde agua', 'gotea', 'goteo', 'caño', 'caños', 'cano', 'canos', 'cañería', 'cañerías', 'caneria', 'canerias', 'caño roto', 'se rompió un caño', 'caño pinchado', 'termofusión', 'llave de paso', 'canilla', 'canillas', 'grifo', 'grifería', 'monocomando', 'cuerito', 'cambiar cuerito', 'cartucho de canilla', 'inodoro', 'el inodoro pierde', 'depósito de inodoro', 'mochila del inodoro', 'botón del inodoro', 'flotante del inodoro', 'bidet', 'ducha', 'flor de ducha', 'bañera', 'bañadera', 'baño', 'bano', 'instalación de baño', 'pileta de cocina', 'pileta del lavadero', 'bacha', 'sifón', 'flexible', 'flexibles', 'conexión de lavarropas', 'termotanque', 'bomba de agua', 'presurizadora', 'poca presión de agua', 'no sale agua', 'sin agua', 'agua caliente', 'medidor de agua', 'filtro de agua', 'gotera']::text[]),
  ('preparacion-examenes-ingresos', ARRAY['preparación de exámenes', 'examen', 'exámenes', 'ingreso', 'ingreso universitario', 'curso de ingreso', 'ingreso a la universidad', 'examen ingreso', 'examen de ingreso', 'CBC', 'uba xxi', 'ubaxxi', 'ingreso a medicina', 'ingreso al colegio', 'ingreso al nacional', 'colegio preuniversitario', 'final', 'finales', 'rendir un final', 'parcial', 'parciales', 'recuperatorio', 'preparar examen', 'examen libre', 'terminar el secundario', 'plan fines', 'olimpíadas', 'psicotécnico', 'preparación test']::text[]),
  ('pulido-tratamiento-pisos', ARRAY['pulido', 'pulido de pisos', 'pulir piso', 'pulir pisos', 'plastificado', 'plastificar piso', 'hidrolaqueado', 'laca', 'vitrificado', 'piso de madera', 'pisos de madera', 'parquet', 'pinotea', 'entablonado', 'lijado de piso', 'lijar piso', 'rasqueteado', 'encerado', 'cera para pisos', 'pulido de mármol', 'mármol', 'granito', 'granítico', 'mosaico', 'mosaicos', 'calcáreo', 'cristalizado', 'cemento alisado', 'microcemento', 'piso flotante', 'colocación de piso flotante', 'piso rayado', 'piso opaco', 'madera']::text[]),
  ('redes-wifi-cableado', ARRAY['wifi', 'wi fi', 'internet', 'sin internet', 'no anda internet', 'no anda el wifi', 'internet lento', 'señal wifi', 'mala señal', 'no llega el wifi', 'extender wifi', 'repetidor', 'repetidor wifi', 'extensor', 'router', 'módem', 'configurar router', 'access point', 'mesh', 'red wifi', 'red local', 'redes informáticas', 'red de computadoras', 'cableado de red', 'cableado estructurado', 'cable de red', 'cable utp', 'RJ45', 'ficha rj45', 'switch', 'rack de red', 'patchera', 'fibra óptica', 'punto de red', 'red para oficina', 'vpn', 'firewall', 'ip fija', 'compartir impresora']::text[]),
  ('shows-infantiles-animacion', ARRAY['animación infantil', 'animador', 'animadora', 'animación', 'animación de cumpleaños', 'cumpleaños infantil', 'cumple infantil', 'cumpleaños niños', 'cumpleaños de chicos', 'fiesta infantil', 'show infantil', 'shows infantiles', 'payaso', 'payasos', 'mago', 'magia', 'show de magia', 'títeres', 'titiritero', 'personajes', 'princesas', 'superhéroes', 'globología', 'pintacaritas', 'show de burbujas', 'burbujas', 'juegos para chicos', 'inflables', 'castillo inflable', 'pelotero', 'cama elástica', 'animación para chicos', 'kermesse']::text[]),
  ('tanques-agua', ARRAY['tanque de agua', 'tanques de agua', 'tanque', 'tanques', 'limpieza de tanque', 'limpieza de tanques', 'lavado de tanque', 'desinfección de tanque', 'desinfección agua', 'cisterna', 'cisternas', 'tanque cisterna', 'tanque elevado', 'tanque de reserva', 'sarro en el tanque', 'agua sucia', 'agua turbia', 'agua con olor', 'flotante del tanque', 'automático de tanque', 'bomba de agua', 'bomba presurizadora', 'presurizadora', 'presión de agua', 'poca presión', 'cambio de tanque', 'instalar tanque', 'tanque tricapa', 'tinaco', 'colector', 'análisis de agua', 'potabilidad', 'certificado de limpieza de tanque']::text[]),
  ('techista-cubiertas', ARRAY['techista', 'techo', 'techos', 'techado', 'techar', 'cubierta', 'cubiertas', 'techo de chapa', 'chapa', 'chapas', 'chapa trapezoidal', 'chapa acanalada', 'chapa sinusoidal', 'cambio de chapas', 'chapa suelta', 'teja', 'tejas', 'techo de tejas', 'tejas rotas', 'techo de madera', 'tirantes', 'aislación de techo', 'isolant', 'policarbonato', 'techo de policarbonato', 'cumbrera', 'canaleta', 'canaletas', 'canalón', 'bajada pluvial', 'gotera', 'goteras', 'gotea el techo', 'llueve adentro', 'entra agua por el techo', 'se voló el techo', 'tornillos autoperforantes', 'aleros', 'cenefas', 'granizo', 'techo de paja', 'quinchero']::text[]),
  ('traslado-mascotas', ARRAY['traslado de mascotas', 'trasladar mascota', 'transporte de mascotas', 'taxi para mascotas', 'pet taxi', 'mascota', 'mascotas', 'llevar al perro', 'llevar al gato', 'traslado de perro', 'traslado perro', 'traslado de gato', 'llevar al veterinario', 'traslado a veterinaria', 'transportadora', 'jaula', 'viaje con mascota', 'mascota en avión', 'senasa', 'traslado a guardería', 'traslado a peluquería canina']::text[]),
  ('tutorias-universitarias', ARRAY['tutorías', 'tutoría', 'tutor', 'clases particulares universidad', 'clases universitarias', 'profesor universitario', 'universidad', 'facultad', 'materia de la facultad', 'álgebra', 'análisis matemático', 'análisis 1', 'análisis 2', 'cálculo', 'estadística', 'probabilidad', 'física', 'física universitaria', 'química universitaria', 'química orgánica', 'contabilidad', 'economía', 'microeconomía', 'macroeconomía', 'matemática financiera', 'derecho', 'programación', 'java', 'python', 'algoritmos', 'base de datos', 'sql', 'tesis', 'tesina', 'trabajo final', 'monografía', 'normas apa', 'anatomía', 'fisiología', 'bioquímica', 'ingeniería', 'termodinámica']::text[]),
  ('veterinario-domicilio', ARRAY['veterinario', 'veterinaria', 'veterinario a domicilio', 'vet', 'médico veterinario', 'consulta veterinaria', 'consulta a domicilio', 'vacuna', 'vacunas', 'vacunación', 'antirrábica', 'desparasitar', 'desparasitación', 'pipeta', 'pipetas', 'castración', 'castrar', 'perro enfermo', 'gato enfermo', 'mi perro vomita', 'diarrea', 'mascota enferma', 'control veterinario', 'certificado de salud', 'microchip', 'análisis de sangre', 'eutanasia', 'gato', 'gatos', 'felino', 'curaciones', 'heridas', 'urgencias leves']::text[]),
  ('video-con-drone', ARRAY['drone', 'drones', 'dron', 'video con drone', 'filmación con drone', 'filmación aérea', 'fotos aéreas', 'fotografía aérea', 'toma aérea', 'tomas aéreas', 'video aéreo', 'piloto de drone', 'relevamiento con drone', 'inspección con drone', 'drone para eventos', 'drone para casamiento', 'video inmobiliario', 'fotos de campo', 'mapeo aéreo', 'fpv']::text[]),
  ('vidrieria', ARRAY['vidriero', 'vidriería', 'vidrio', 'vidrios', 'vidrio roto', 'cambiar vidrio', 'se rompió un vidrio', 'vidrio partido', 'vidrio de ventana', 'ventana', 'ventanas', 'ventanal', 'ventanales', 'DVH', 'doble vidrio', 'doble vidriado hermético', 'vidrio templado', 'vidrio laminado', 'blindex', 'mampara', 'mampara de baño', 'box de ducha', 'espejo', 'espejos', 'espejo a medida', 'cerramiento', 'cerramientos', 'cerramiento vidrio', 'cerramiento de balcón', 'cerramiento de galería', 'vidrio de mesa', 'tapa de vidrio', 'vidrio esmerilado', 'polarizado', 'film de seguridad', 'puerta de vidrio', 'frente vidriado', 'acrílico']::text[]),
  ('zinguería', ARRAY['zinguería', 'zinguero', 'canaleta', 'canaletas', 'canaleta de chapa', 'canalón', 'canalones', 'bajada pluvial', 'bajadas pluviales', 'caño de bajada', 'babeta', 'babetas', 'cenefa', 'cenefas', 'cupertina', 'cupertinas', 'sombrerete', 'sombreretes', 'chimenea', 'caño de chimenea', 'conducto de chimenea', 'zinc', 'chapa galvanizada', 'plegado de chapa', 'cumbrera', 'limahoya', 'canaleta tapada', 'canaleta rota', 'desborde de canaleta', 'limpieza de canaletas', 'cubrejuntas', 'embudo pluvial', 'caño de ventilación', 'ventilación de calefón']::text[])
) AS v(slug, kw)
WHERE pt.slug = v.slug
  AND pt.keywords IS DISTINCT FROM v.kw;

-- 4) Oficios que la app todavía ofrece con un nombre que no está en el catálogo del admin
INSERT INTO public.oficio_keywords (oficio, slug_app, keywords)
VALUES
  ('Arreglos generales del hogar (handyman)', 'arreglos-generales-hogar', ARRAY['handyman', 'arreglos', 'arreglos generales', 'arreglos del hogar', 'arreglos en casa', 'pequeños arreglos', 'reparaciones menores', 'mantenimiento del hogar', 'mantenimiento general', 'hombre de mantenimiento', 'changas', 'changarín', 'mano de obra', 'colgar cuadros', 'colgar estantes', 'colgar repisas', 'colocar repisa', 'colgar cortinas', 'colocar barral', 'agujerear pared', 'hacer agujeros', 'taladro', 'tarugos', 'bisagras', 'ajustar puerta', 'puerta que no cierra', 'cambiar picaporte', 'manijas', 'burletes', 'sellar con silicona', 'silicona del baño', 'arreglar cajones', 'rieles de cajón', 'perchero', 'colgar espejo', 'colocar accesorios de baño', 'chapuzas', 'todo terreno', 'multiservicio', 'Hogar y mantenimiento']::text[]),
  ('Limpieza residencial y profunda', 'limpieza-residencial-profunda', ARRAY['limpieza', 'limpieza de casa', 'limpieza de casas', 'limpieza de departamento', 'limpiar la casa', 'limpieza profunda', 'limpieza general', 'limpieza a fondo', 'empleada doméstica', 'empleada', 'mucama', 'personal de limpieza', 'señora de limpieza', 'servicio doméstico', 'doméstica', 'limpieza por horas', 'limpieza semanal', 'limpieza de oficina', 'limpieza de oficinas', 'limpieza de cocina', 'desengrasar', 'limpieza de baño', 'sarro', 'limpieza de vidrios', 'limpiar ventanas', 'limpieza de alfombras', 'lavado de alfombras', 'limpieza de sillones', 'lavado de sillones', 'lavado de tapizados', 'tapizados', 'limpieza de colchón', 'colchones', 'planchado', 'planchar', 'ordenar la casa', 'organización del hogar', 'limpieza de horno', 'limpieza fin de alquiler', 'limpieza de mudanza', 'sanitización', 'desinfección del hogar', 'limpieza airbnb', 'limpieza de cortinas', 'Hogar y mantenimiento']::text[]),
  ('Drywall, pladur y cielorrasos', 'drywall-pladur-cielorrasos', ARRAY['durlock', 'durloc', 'durlok', 'durlockero', 'construcción en seco', 'steel framing', 'drywall', 'pladur', 'placa de yeso', 'placas de yeso', 'tabique', 'tabiques', 'tabique de durlock', 'pared de durlock', 'dividir ambiente', 'división de ambientes', 'cielorraso', 'cielorrasos', 'cielo raso', 'techo de durlock', 'cielorraso suspendido', 'falso techo', 'cielorraso desmontable', 'buña', 'molduras', 'cornisas', 'garganta de luz', 'yeso', 'yesero', 'yesería', 'aplicado de yeso', 'masillado', 'cinta de junta', 'placa verde', 'placa antihumedad', 'placard de durlock', 'mueble de durlock', 'aislación acústica', 'aislación térmica', 'lana de vidrio', 'perfiles', 'montantes', 'agujero en el durlock', 'Construcción y oficios']::text[]),
  ('Gasista', 'gasista', ARRAY['gasista', 'gasista matriculado', 'gas', 'gas natural', 'gas envasado', 'garrafa', 'tubo de gas', 'olor a gas', 'pérdida de gas', 'escape de gas', 'fuga de gas', 'corte de gas', 'me cortaron el gas', 'sin gas', 'prueba de hermeticidad', 'hermeticidad', 'rehabilitación de gas', 'instalación de gas', 'instalación gas', 'cañería de gas', 'caño de gas', 'conexión de gas', 'flexible de gas', 'llave de paso de gas', 'regulador de gas', 'calefón', 'calefones', 'calefont', 'el calefón no prende', 'piloto', 'se apaga el piloto', 'termocupla', 'termotanque', 'termotanques', 'termotanque a gas', 'termo', 'caldera', 'calderas', 'calefacción', 'calefacción central', 'losa radiante', 'radiadores', 'estufa', 'estufas', 'tiro balanceado', 'estufa a gas', 'cocina a gas', 'horno a gas', 'anafe a gas', 'hornalla', 'hornallas', 'el horno no prende', 'monóxido', 'monóxido de carbono', 'ventilación reglamentaria', 'rejillas de ventilación', 'plano de gas', 'artefactos de gas', 'conversión a gas natural', 'agua caliente', 'no sale agua caliente', 'no tengo agua caliente', 'Construcción y oficios']::text[]),
  ('Techista y cubiertas', 'techista-cubiertas', ARRAY['techista', 'techo', 'techos', 'techado', 'techar', 'cubierta', 'cubiertas', 'techo de chapa', 'chapa', 'chapas', 'chapa trapezoidal', 'chapa acanalada', 'chapa sinusoidal', 'cambio de chapas', 'chapa suelta', 'teja', 'tejas', 'techo de tejas', 'tejas rotas', 'techo de madera', 'tirantes', 'aislación de techo', 'isolant', 'policarbonato', 'techo de policarbonato', 'cumbrera', 'canaleta', 'canaletas', 'canalón', 'bajada pluvial', 'gotera', 'goteras', 'gotea el techo', 'llueve adentro', 'entra agua por el techo', 'se voló el techo', 'tornillos autoperforantes', 'aleros', 'cenefas', 'granizo', 'techo de paja', 'quinchero', 'Construcción y oficios']::text[]),
  ('Armado y actualización de PC', 'armado-actualizacion-pc', ARRAY['armado de pc', 'armar pc', 'armar computadora', 'armar una pc', 'pc gamer', 'pc', 'computadora', 'computadoras', 'compu', 'computadora de escritorio', 'gabinete', 'cpu', 'upgrade', 'actualizar pc', 'mejorar la pc', 'agregar memoria', 'memoria ram', 'ram', 'placa de video', 'gpu', 'tarjeta gráfica', 'placa madre', 'placa base', 'motherboard', 'mother', 'microprocesador', 'procesador', 'fuente', 'fuente de alimentación', 'fuente de poder', 'disco ssd', 'ssd', 'cambiar disco', 'disco sólido', 'nvme', 'cooler', 'refrigeración líquida', 'pasta térmica', 'ensamble', 'ensamblar', 'pc lenta', 'pc para juegos', 'componentes', 'Tecnología e informática']::text[]),
  ('Instalación de audio, TV y streaming', 'instalacion-audio-tv-streaming', ARRAY['instalar tele', 'instalar televisor', 'instalación de tv', 'colgar tele', 'colgar la tele', 'colgar televisor', 'soporte de tv', 'soporte para tv', 'amurar tv', 'televisor', 'tele', 'tv', 'smart TV', 'configurar smart tv', 'home theater', 'parlantes', 'barra de sonido', 'soundbar', 'equipo de música', 'audio', 'amplificador', 'subwoofer', 'sonido ambiental', 'proyector', 'instalar proyector', 'pantalla de proyección', 'Chromecast', 'Apple TV', 'fire tv', 'tv box', 'android tv', 'antena', 'antena de tv', 'tda', 'televisión digital', 'decodificador', 'streaming', 'hdmi', 'cable hdmi', 'ocultar cables de la tele', 'cine en casa', 'Tecnología e informática']::text[]),
  ('Recuperación de datos', 'recuperacion-datos', ARRAY['recuperación de datos', 'recuperar datos', 'recuperar archivos', 'recuperar fotos', 'archivos borrados', 'borré archivos', 'fotos borradas', 'disco rígido', 'disco duro', 'disco externo', 'el disco no anda', 'disco roto', 'no reconoce el disco', 'pendrive', 'pen drive', 'memoria sd', 'tarjeta de memoria', 'ssd', 'backup', 'copia de seguridad', 'respaldo', 'clonado', 'clonar disco', 'formateé sin querer', 'partición', 'raid', 'nas', 'datos perdidos', 'rescatar datos', 'Tecnología e informática']::text[]),
  ('Redes, Wi‑Fi y cableado estructurado', 'redes-wifi-cableado', ARRAY['wifi', 'wi fi', 'internet', 'sin internet', 'no anda internet', 'no anda el wifi', 'internet lento', 'señal wifi', 'mala señal', 'no llega el wifi', 'extender wifi', 'repetidor', 'repetidor wifi', 'extensor', 'router', 'módem', 'configurar router', 'access point', 'mesh', 'red wifi', 'red local', 'redes informáticas', 'red de computadoras', 'cableado de red', 'cableado estructurado', 'cable de red', 'cable utp', 'RJ45', 'ficha rj45', 'switch', 'rack de red', 'patchera', 'fibra óptica', 'punto de red', 'red para oficina', 'vpn', 'firewall', 'ip fija', 'compartir impresora', 'Tecnología e informática']::text[]),
  ('Reparación de celulares y tablets', 'reparacion-celulares-tablets', ARRAY['celular', 'celulares', 'teléfono', 'teléfono celular', 'smartphone', 'iphone', 'android', 'tablet', 'tablets', 'reparación de celulares', 'arreglo de celular', 'arreglar celular', 'servicio técnico de celulares', 'técnico de celulares', 'pantalla', 'pantalla rota', 'cambio de pantalla', 'módulo', 'display', 'touch', 'táctil', 'no anda el táctil', 'batería', 'cambio de batería', 'se descarga rápido', 'batería hinchada', 'pin de carga', 'no carga', 'conector de carga', 'puerto de carga', 'celular mojado', 'se mojó el celular', 'se me cayó el celular', 'cámara del celular', 'micrófono del celular', 'parlante del celular', 'no tiene señal', 'liberar celular', 'flasheo', 'desbloqueo', 'olvidé el patrón', 'tapa trasera', 'botón de encendido', 'Tecnología e informática']::text[]),
  ('Reparación de notebooks y computadoras', 'reparacion-notebooks-pc', ARRAY['reparador de pc', 'reparación de pc', 'reparar pc', 'arreglo de pc', 'arreglar pc', 'arreglar computadora', 'arreglo de computadora', 'reparación de computadoras', 'técnico de pc', 'técnico de computadoras', 'servicio técnico de pc', 'service de notebook', 'notebook', 'notebooks', 'laptop', 'netbook', 'computadora', 'computadoras', 'compu', 'pc', 'pc de escritorio', 'placa madre', 'placa base', 'motherboard', 'mother', 'no enciende', 'no prende la compu', 'no arranca', 'pantalla azul', 'se apaga sola', 'se calienta', 'recalienta', 'cooler', 'ventilador de la notebook', 'limpieza interna', 'pasta térmica', 'teclado', 'teclado de notebook', 'cambio de teclado', 'pantalla', 'pantalla notebook', 'cambio de pantalla de notebook', 'bisagra de notebook', 'pin de carga de notebook', 'cargador', 'cargador de notebook', 'fuente', 'fuente de alimentación', 'disco', 'disco rígido', 'ssd', 'memoria ram', 'placa de video', 'se mojó la notebook', 'derrame de líquido', 'all in one', 'mac', 'macbook', 'imac', 'monitor', 'el monitor no da imagen', 'no da video', 'bios', 'reballing', 'microsoldadura', 'Tecnología e informática']::text[]),
  ('Soporte técnico informático', 'soporte-tecnico-informatico', ARRAY['soporte técnico', 'soporte informático', 'técnico informático', 'técnico en computación', 'servicio técnico informático', 'soporte remoto', 'asistencia remota', 'virus', 'antivirus', 'malware', 'sacar virus', 'formatear', 'formateo', 'formatear pc', 'instalar windows', 'windows', 'reinstalar windows', 'actualizar windows', 'mac', 'macos', 'linux', 'office', 'instalar office', 'word', 'excel', 'outlook', 'configurar mail', 'el mail no funciona', 'impresora', 'instalar impresora', 'la impresora no imprime', 'escáner', 'drivers', 'instalar programas', 'programas', 'licencias', 'compu lenta', 'pc lenta', 'se tilda', 'se cuelga', 'mantenimiento de pc', 'optimización', 'copias de seguridad', 'nube', 'google drive', 'contraseña', 'me hackearon', 'cuenta hackeada', 'soporte para empresas', 'soporte para pymes', 'servidor', 'técnico de pc a domicilio', 'Tecnología e informática']::text[]),
  ('Barbería y barbero a domicilio', 'barberia-domicilio', ARRAY['barbero', 'barbería', 'barbero a domicilio', 'corte de pelo de hombre', 'corte masculino', 'corte de hombre', 'corte para hombre', 'degradé', 'fade', 'barba', 'arreglo de barba', 'perfilado de barba', 'diseño de barba', 'afeitado', 'afeitar', 'navaja', 'toalla caliente', 'bigote', 'rapado', 'peluquero de hombres', 'peluquería masculina', 'corte de pelo para nene', 'tintura de barba', 'Belleza y estética']::text[]),
  ('Corte, color y peinado (peluquería)', 'corte-color-peinado', ARRAY['peluquería', 'peluquera', 'peluquero', 'peluquería a domicilio', 'corte de pelo', 'cortar el pelo', 'corte de cabello', 'corte de mujer', 'corte de dama', 'tintura', 'teñir', 'teñirse el pelo', 'color de pelo', 'coloración', 'reflejos', 'mechas', 'balayage', 'baby lights', 'decoloración', 'decolorar', 'matizar', 'canas', 'cubrir canas', 'brushing', 'planchita', 'ondas', 'peinado', 'peinados', 'peinado de novia', 'peinado para fiesta', 'recogido', 'trenzas', 'alisado', 'alisado definitivo', 'flequillo', 'despuntar', 'puntas', 'permanente', 'extensiones de pelo', 'corte de pelo para chicos', 'Belleza y estética']::text[]),
  ('Masajes y terapias manuales', 'masajes-terapias-manuales', ARRAY['masaje', 'masajes', 'masajista', 'masajes a domicilio', 'masaje relajante', 'relajante', 'masaje descontracturante', 'descontracturante', 'contractura', 'contracturas', 'dolor de espalda', 'dolor de cuello', 'cervicales', 'masaje deportivo', 'masaje terapéutico', 'drenaje linfático', 'piedras calientes', 'reflexología', 'shiatsu', 'quiropraxia', 'reiki', 'masaje con aceites', 'masaje para embarazadas', 'masaje en pareja', 'piernas cansadas', 'masoterapia', 'terapias manuales', 'masaje kinesiológico', 'relax', 'estrés', 'Belleza y estética']::text[]),
  ('Micropigmentación y diseño de cejas', 'micropigmentacion-cejas', ARRAY['micropigmentación', 'microblading', 'cejas', 'diseño de cejas', 'perfilado de cejas', 'depilación de cejas', 'laminado de cejas', 'cejas pelo a pelo', 'henna', 'henna de cejas', 'tatuaje cosmético', 'delineado', 'delineado permanente', 'labios', 'micropigmentación de labios', 'pestañas', 'pestanas', 'lifting de pestañas', 'extensiones de pestañas', 'pestañas pelo a pelo', 'permanente de pestañas', 'tinte de cejas', 'nanoblading', 'shading', 'Belleza y estética']::text[]),
  ('Tratamientos capilares', 'tratamientos-capilares', ARRAY['tratamiento capilar', 'tratamientos capilares', 'keratina', 'alisado con keratina', 'botox capilar', 'nutrición capilar', 'hidratación capilar', 'cauterización', 'pelo dañado', 'pelo seco', 'frizz', 'caída del pelo', 'caída de cabello', 'cuero cabelludo', 'caspa', 'ampollas capilares', 'reconstrucción capilar', 'máscara capilar', 'alisado brasilero', 'alisado progresivo', 'progresiva', 'plástica capilar', 'reparación pelo', 'tricología', 'Belleza y estética']::text[]),
  ('Tratamientos faciales y corporales', 'tratamientos-faciales-corporales', ARRAY['tratamiento facial', 'tratamientos faciales', 'limpieza de cutis', 'limpieza facial', 'cutis', 'piel', 'acné', 'granitos', 'puntos negros', 'peeling', 'dermaplaning', 'hidratación facial', 'mascarilla', 'radiofrecuencia', 'tratamiento corporal', 'tratamientos corporales', 'celulitis', 'flacidez', 'estrías', 'tratamiento reductor', 'masajes reductores', 'maderoterapia', 'cosmetóloga', 'cosmetología', 'esteticista', 'estética', 'spa a domicilio', 'antiage', 'anti age', 'manchas en la piel', 'ojeras', 'microdermoabrasión', 'dermapen', 'Belleza y estética']::text[]),
  ('Cadetería y mensajería', 'cadeteria-mensajeria', ARRAY['cadete', 'cadetes', 'cadetería', 'mensajería', 'mensajero', 'motomensajería', 'cadete en moto', 'mandados', 'hacer mandados', 'envío', 'envíos', 'envío express', 'paquete', 'paquetes', 'sobre', 'llevar documentos', 'trámites', 'hacer trámites', 'trámites bancarios', 'pagar cuentas', 'retirar un paquete', 'delivery', 'hacer las compras', 'compras del súper', 'Transporte y logística']::text[]),
  ('Fletes y mini fletes', 'fletes-mini-fletes', ARRAY['flete', 'fletes', 'fletero', 'mini flete', 'mini fletes', 'miniflete', 'camioneta', 'camioneta con chofer', 'utilitario', 'carga', 'carga chica', 'trasladar muebles', 'traslado de muebles', 'llevar una heladera', 'llevar un mueble', 'traslado de electrodomésticos', 'bultos', 'cajas', 'mudanza chica', 'mini mudanza', 'retiro de muebles', 'retirar una compra', 'entrega de compra', 'llevar cosas', 'ayudante para cargar', 'peón', 'peones', 'carga y descarga', 'Transporte y logística']::text[]),
  ('Mudanzas', 'mudanzas', ARRAY['mudanza', 'mudanzas', 'mudarse', 'me mudo', 'mudanza completa', 'mudanza de departamento', 'mudanza de casa', 'mudanza de oficina', 'mudanza larga distancia', 'embalaje', 'embalar', 'cajas de mudanza', 'furgón', 'camión de mudanza', 'guardamuebles', 'baulera', 'desarme y armado de muebles', 'izaje', 'izaje por balcón', 'traslado de piano', 'cargar y descargar', 'mudanza express', 'traslado hogar', 'Transporte y logística']::text[]),
  ('Transporte de carga liviana', 'transporte-carga-liviana', ARRAY['carga liviana', 'transporte de carga', 'transporte de mercadería', 'mercadería', 'reparto', 'repartos', 'distribución', 'logística', 'logística urbana', 'envíos a comercios', 'entrega a comercios', 'furgón', 'furgoneta', 'utilitario', 'camioneta', 'carga y descarga', 'paquetería', 'transporte de materiales', 'materiales de construcción', 'pallets', 'palets', 'flete comercial', 'Transporte y logística']::text[]),
  ('Adiestramiento canino', 'adiestramiento-canino', ARRAY['adiestrador', 'adiestradora', 'adiestramiento', 'adiestramiento canino', 'adiestrar', 'entrenar perro', 'entrenar al perro', 'entrenador de perros', 'educador canino', 'educación canina', 'obediencia', 'obediencia básica', 'conducta', 'problemas de conducta', 'perro agresivo', 'agresividad', 'perro que muerde', 'perro que ladra', 'ladra mucho', 'tira de la correa', 'hace pis en casa', 'ensucia en casa', 'ansiedad por separación', 'cachorro', 'cachorros', 'socialización', 'etólogo', 'etología', 'perro de guardia', 'perro reactivo', 'rompe todo', 'perro', 'Mascotas']::text[]),
  ('Cuidado de mascotas (pet sitting)', 'cuidado-mascotas-pet-sitting', ARRAY['pet sitter', 'pet sitting', 'cuidador de mascotas', 'cuidado de mascotas', 'cuidar mi perro', 'cuidar al perro', 'cuidar mi gato', 'cuidar al gato', 'cuidado de perros', 'cuidado de gatos', 'guardería canina', 'guardería de mascotas', 'guardería hogar', 'hotel para perros', 'hotel canino', 'alojamiento de mascotas', 'cuidado en vacaciones', 'dar de comer al gato', 'alimentar mascota', 'cuidar mascota', 'niñera de mascotas', 'dog sitter', 'cat sitter', 'cuidado de aves', 'conejo', 'hámster', 'Mascotas']::text[]),
  ('Peluquería canina (grooming)', 'peluqueria-canina', ARRAY['peluquería canina', 'peluquero canino', 'grooming', 'groomer', 'baño de perro', 'bañar al perro', 'bañar perro', 'baño y corte', 'corte de pelo de perro', 'corte de pelo mascota', 'corte de perro', 'deslanado', 'deslanar', 'corte de uñas de perro', 'uñas mascota', 'limpieza de oídos', 'peluquería para gatos', 'baño de gato', 'estética canina', 'peluquería móvil', 'corte higiénico', 'cepillado', 'perro', 'Mascotas']::text[]),
  ('Clases de cocina', 'clases-cocina', ARRAY['clases de cocina', 'curso de cocina', 'aprender a cocinar', 'cocinar', 'chef', 'pastelería', 'repostería', 'panadería', 'hacer pan', 'tortas', 'decoración de tortas', 'cocina saludable', 'cocina vegana', 'cocina sin tacc', 'cocina para celíacos', 'pastas caseras', 'sushi', 'comidas caseras', 'chef a domicilio clase', 'Educación y capacitación']::text[]),
  ('Informática para adultos mayores', 'informatica-adultos-mayores', ARRAY['informática para adultos mayores', 'clases de computación', 'computación', 'aprender computación', 'aprender a usar el celular', 'usar el celular', 'whatsapp', 'aprender whatsapp', 'videollamadas', 'zoom', 'usar la computadora', 'internet para mayores', 'mail', 'correo electrónico', 'home banking', 'trámites online', 'turnos online', 'redes sociales', 'facebook', 'instagram', 'tablet para mayores', 'jubilados', 'abuelos', 'adultos mayores', 'tercera edad', 'alfabetización digital', 'clases de excel', 'clases de word', 'celular para abuelos', 'internet básico', 'Educación y capacitación']::text[]),
  ('Tutorías universitarias', 'tutorias-universitarias', ARRAY['tutorías', 'tutoría', 'tutor', 'clases particulares universidad', 'clases universitarias', 'profesor universitario', 'universidad', 'facultad', 'materia de la facultad', 'álgebra', 'análisis matemático', 'análisis 1', 'análisis 2', 'cálculo', 'estadística', 'probabilidad', 'física', 'física universitaria', 'química universitaria', 'química orgánica', 'contabilidad', 'economía', 'microeconomía', 'macroeconomía', 'matemática financiera', 'derecho', 'programación', 'java', 'python', 'algoritmos', 'base de datos', 'sql', 'tesis', 'tesina', 'trabajo final', 'monografía', 'normas apa', 'anatomía', 'fisiología', 'bioquímica', 'ingeniería', 'termodinámica', 'Educación y capacitación']::text[]),
  ('Bartender y coctelería', 'bartender-cocteleria', ARRAY['bartender', 'barman', 'barra de tragos', 'barra móvil', 'tragos', 'coctelería', 'cócteles', 'cocktails', 'drinks', 'mixología', 'gin tonic', 'fernet', 'cerveza tirada', 'barra libre', 'trago de autor', 'barra para casamiento', 'barra para fiesta', 'bar para eventos', 'sommelier', 'Eventos y entretenimiento']::text[]),
  ('Decoración de eventos', 'decoracion-eventos', ARRAY['decoración de eventos', 'decoración de fiestas', 'decoración de cumpleaños', 'ambientación', 'ambientación de eventos', 'centros de mesa', 'globos', 'arco de globos', 'guirnaldas', 'flores', 'arreglos florales', 'florista', 'mesa principal', 'iluminación decorativa', 'decoración de casamiento', 'decoración de 15', 'backdrop', 'photocall', 'letras gigantes', 'decoración temática', 'decoradora', 'souvenirs', 'mesa dulce', 'cumpleaños', 'Eventos y entretenimiento']::text[]),
  ('Mozos y servicio de sala', 'mozos-servicio-sala', ARRAY['mozo', 'mozos', 'moza', 'mozas', 'camarero', 'camarera', 'servicio de mozos', 'servicio de sala', 'atención de mesas', 'personal para eventos', 'servicio de mesa', 'bachero', 'bacheros', 'lavado de vajilla', 'recepcionista de eventos', 'promotora', 'azafata', 'personal de servicio', 'mozos para casamiento', 'mozos para fiesta', 'encargado de salón', 'maître', 'catering', 'montaje mesas', 'copas', 'Eventos y entretenimiento']::text[]),
  ('Video y streaming de eventos', 'video-streaming-eventos', ARRAY['video', 'videos', 'filmación', 'filmar', 'filmar un evento', 'camarógrafo', 'videógrafo', 'video de casamiento', 'video de 15', 'video de eventos', 'edición de video', 'editar video', 'streaming', 'transmisión en vivo', 'transmitir en vivo', 'youtube live', 'video institucional', 'video corporativo', 'after movie', 'video para redes', 'reels', 'video evento', 'multicámara', 'videographer', 'editor de video', 'Eventos y entretenimiento']::text[])
ON CONFLICT (oficio) DO UPDATE
  SET slug_app = EXCLUDED.slug_app,
      keywords = EXCLUDED.keywords,
      updated_at = now()
  WHERE public.oficio_keywords.keywords IS DISTINCT FROM EXCLUDED.keywords
     OR public.oficio_keywords.slug_app IS DISTINCT FROM EXCLUDED.slug_app;

-- Si cambió la normalización, recalcular el índice de las filas desactualizadas.
UPDATE public.professional_trades
SET keywords = keywords
WHERE search_index IS DISTINCT FROM public.search_terms_array(ARRAY[name, coalesce(category_name, '')] || coalesce(keywords, '{}'::text[]));
UPDATE public.oficio_keywords
SET keywords = keywords
WHERE search_index IS DISTINCT FROM public.search_terms_array(ARRAY[oficio] || keywords);

-- 5) Buscadores: se agrega el criterio de palabras clave ------------------------
-- Control de concurrencia: si alguien cambió estas funciones después de que se
-- armó este archivo (hash distinto y sin el criterio nuevo), se aborta para
-- volver a comparar contra producción en lugar de pisar el cambio.
DO $guard$
DECLARE
  v_client text := pg_get_functiondef('public.search_workers_for_client(double precision,double precision,text,text[],uuid,integer)'::regprocedure);
  v_public text := pg_get_functiondef('public.search_workers_public(text,text,text,integer)'::regprocedure);
BEGIN
  IF md5(v_client) <> 'a6e563f81e5e19f922fc1393a656071c' AND position('trade_names_for_query' IN v_client) = 0 THEN
    RAISE EXCEPTION 'search_workers_for_client cambió en producción: volver a comparar antes de aplicar #97';
  END IF;
  IF md5(v_public) <> 'a7dbc0dcdec7cbc3ddffbc2bad402dd9' AND position('trade_names_for_query' IN v_public) = 0 THEN
    RAISE EXCEPTION 'search_workers_public cambió en producción: volver a comparar antes de aplicar #97';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.search_workers_for_client(p_client_lat double precision, p_client_lng double precision, p_query text DEFAULT ''::text, p_category_names text[] DEFAULT NULL::text[], p_exclude_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 80)
 RETURNS TABLE(profile_id uuid, nombre text, apellido text, avatar_url text, lat double precision, lng double precision, coverage_km integer, distance_km double precision, primary_trade text, all_trades text[], summary_jobs text, rating_average numeric, review_count integer, total_jobs_done integer, atiende_urgencias boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH client_pt AS (
    SELECT st_setsrid(st_makepoint(p_client_lng, p_client_lat), 4326)::geography AS g
  ),
  lim AS (
    SELECT least(greatest(coalesce(p_limit, 80), 1), 100) AS n
  ),
  base AS (
    SELECT
      p.id AS profile_id,
      p.nombre,
      p.apellido AS apellido_full,
      p.avatar_url,
      st_y(p.location::geometry) AS lat_exact,
      st_x(p.location::geometry) AS lng_exact,
      p.coverage_km,
      st_distance(p.location, (SELECT g FROM client_pt), false) / 1000.0 AS distance_exact,
      (
        SELECT j2.nombre_oficio
        FROM public.jobs j2
        WHERE j2.user_id = p.id
        ORDER BY j2.es_principal DESC, j2.nombre_oficio
        LIMIT 1
      ) AS primary_trade,
      (
        SELECT array_agg(j3.nombre_oficio ORDER BY j3.es_principal DESC, j3.nombre_oficio)
        FROM public.jobs j3
        WHERE j3.user_id = p.id
      ) AS all_trades,
      (
        SELECT string_agg(j4.nombre_oficio || ': ' || coalesce(j4.descripcion, ''), ' · ')
        FROM public.jobs j4
        WHERE j4.user_id = p.id
      ) AS summary_jobs,
      coalesce(p.rating_average, 0) AS rating_average,
      coalesce(p.review_count, 0) AS review_count,
      coalesce(p.total_jobs_done, 0) AS total_jobs_done,
      p.atiende_urgencias
    FROM public.profiles p
    WHERE p.professional_status = 'accepted'
      AND p.location IS NOT NULL
      AND p.coverage_km IS NOT NULL
      AND p.coverage_km > 0
      AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
      AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
  )
  SELECT
    b.profile_id,
    b.nombre,
    NULL::text AS apellido,
    b.avatar_url,
    round(b.lat_exact::numeric, 2)::double precision AS lat,
    round(b.lng_exact::numeric, 2)::double precision AS lng,
    b.coverage_km,
    round(b.distance_exact::numeric, 1)::double precision AS distance_km,
    b.primary_trade,
    b.all_trades,
    b.summary_jobs,
    b.rating_average,
    b.review_count,
    b.total_jobs_done,
    b.atiende_urgencias
  FROM base b
  WHERE b.distance_exact <= b.coverage_km
    AND (
      coalesce(trim(p_query), '') = ''
      OR b.nombre ILIKE '%' || trim(p_query) || '%'
      OR b.primary_trade ILIKE '%' || trim(p_query) || '%'
      OR exists (
        SELECT 1 FROM unnest(coalesce(b.all_trades, array[]::text[])) t
        WHERE t ILIKE '%' || trim(p_query) || '%'
      )
      OR coalesce(b.summary_jobs, '') ILIKE '%' || trim(p_query) || '%'
      -- #97: palabras clave del oficio
      OR exists (
        SELECT 1 FROM unnest(coalesce(b.all_trades, array[]::text[])) t
        WHERE public.search_fold(t) = ANY ((SELECT public.trade_names_for_query(p_query))::text[])
      )
    )
    AND (
      p_category_names IS NULL
      OR cardinality(p_category_names) = 0
      OR exists (
        SELECT 1
        FROM unnest(coalesce(b.all_trades, array[]::text[])) t
        WHERE t = ANY (p_category_names)
      )
    )
  ORDER BY b.distance_exact ASC, b.rating_average DESC NULLS LAST
  LIMIT (SELECT n FROM lim);
$function$;

CREATE OR REPLACE FUNCTION public.search_workers_public(p_query text DEFAULT ''::text, p_category text DEFAULT NULL::text, p_zona text DEFAULT NULL::text, p_limit integer DEFAULT 48)
 RETURNS TABLE(id uuid, nombre text, oficio text, rating numeric, resenas_count integer, avatar text, zona text, all_trades text[], total_jobs_done integer, atiende_urgencias boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH lim AS (
    SELECT least(greatest(coalesce(p_limit, 48), 1), 80) AS n
  ),
  base AS (
    SELECT
      p.id,
      NULLIF(trim(split_part(coalesce(p.nombre, ''), ' ', 1)), '') AS nombre,
      (
        SELECT j2.nombre_oficio
        FROM public.jobs j2
        WHERE j2.user_id = p.id
        ORDER BY j2.es_principal DESC NULLS LAST, j2.created_at
        LIMIT 1
      ) AS oficio,
      coalesce(p.rating_average, 0)::numeric AS rating,
      coalesce(p.review_count, 0)::int AS resenas_count,
      NULLIF(trim(coalesce(p.avatar_url, '')), '') AS avatar,
      NULLIF(
        trim(regexp_replace(coalesce(p.direccion_texto, ''), '^[^,]*,\s*', '')),
        ''
      ) AS zona,
      coalesce(
        (
          SELECT array_agg(j3.nombre_oficio ORDER BY j3.nombre_oficio)
          FROM public.jobs j3
          WHERE j3.user_id = p.id
        ),
        '{}'::text[]
      ) AS all_trades,
      coalesce(p.total_jobs_done, 0)::int AS total_jobs_done,
      p.atiende_urgencias
    FROM public.profiles p
    WHERE p.professional_status = 'accepted'
      AND p.coverage_km IS NOT NULL
      AND p.coverage_km > 0
      AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
  )
  SELECT
    b.id,
    coalesce(b.nombre, 'Profesional') AS nombre,
    coalesce(NULLIF(trim(b.oficio), ''), 'Servicios') AS oficio,
    b.rating,
    b.resenas_count,
    b.avatar,
    b.zona,
    b.all_trades,
    b.total_jobs_done,
    b.atiende_urgencias
  FROM base b
  WHERE (
      coalesce(trim(p_query), '') = ''
      OR b.nombre ILIKE '%' || trim(p_query) || '%'
      OR b.oficio ILIKE '%' || trim(p_query) || '%'
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.user_id = b.id
          AND (
            j.nombre_oficio ILIKE '%' || trim(p_query) || '%'
            OR coalesce(j.descripcion, '') ILIKE '%' || trim(p_query) || '%'
          )
      )
      -- #97: palabras clave del oficio
      OR EXISTS (
        SELECT 1 FROM unnest(b.all_trades) t
        WHERE public.search_fold(t) = ANY ((SELECT public.trade_names_for_query(p_query))::text[])
      )
    )
    AND (
      coalesce(trim(p_category), '') = ''
      OR b.all_trades && ARRAY[trim(p_category)]::text[]
      OR b.oficio ILIKE trim(p_category)
    )
    AND (
      coalesce(trim(p_zona), '') = ''
      OR coalesce(b.zona, '') ILIKE '%' || trim(p_zona) || '%'
    )
  ORDER BY b.rating DESC, b.resenas_count DESC, b.nombre
  LIMIT (SELECT n FROM lim);
$function$;
