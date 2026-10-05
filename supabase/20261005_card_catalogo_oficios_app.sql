-- =============================================================================
-- Card #122 — La app lee el catálogo de oficios del admin
-- Proyecto Supabase: TuChangaAPP (kyxehrxcdealbujvvnxp)
--
-- NO recrea buscadores ni toca el catálogo del admin (public.professional_trades).
-- NO borra public.oficio_keywords: el buscador #97 sigue usando las dos fuentes.
--
-- Qué hace, cuando se ejecuta a mano:
--   1) Remapea textos de oficio que la app vieja guardó con un nombre que el
--      admin ya renombró (o unió) al nombre actual de professional_trades.
--   2) Alinea oficio_keywords de esos nombres viejos con el nombre nuevo, para
--      que la búsqueda por palabra clave siga encontrando el oficio.
--
-- Inspección de producción (2026-10-05), solo lectura:
--   professional_trades: 56 activos, 0 inactivos.
--   jobs.nombre_oficio (4 filas), todas YA con nombre del catálogo:
--     Aire acondicionado y climatización, Albañilería, Carpintería, Limpieza posobra.
--   posts.trade: Aire acondicionado y climatización (7), Albañilería (1).
--   conversations.primary_trade: Aire acondicionado y climatización (6), Albañilería (4).
--   profiles.professional_jobs_backup: 0 filas con datos.
--   professional_jobs_archive.jobs_snapshot: 2 filas, name =
--     «Aire acondicionado y climatización».
--   Hoy el UPDATE no cambia ninguna fila. El mapa queda para datos viejos que
--   todavía usen el nombre de rubros.json.
--
-- Permisos de lectura (card #100):
--   La policy professional_trades_select_all ya permite SELECT a anon y
--   authenticated cuando active = true (o is_admin()).
--   anon y authenticated tienen GRANT SELECT sobre la tabla.
--   No hace falta un RPC list_active_trades(). La app pide solo
--   id, slug, name, category_slug, category_name, sort_order.
--   keywords y search_index no salen en esa consulta.
--
-- Mapa viejo (app / rubros.json) → nuevo (professional_trades.name).
-- Mismo slug, salvo Mudanzas, que el admin unió con los fletes.
--
--   Barbería y barbero a domicilio              → Barbería a domicilio
--   Masajes y terapias manuales                 → Masajes a domicilio
--   Corte, color y peinado (peluquería)         → Peluquería a domicilio
--   Drywall, pladur y cielorrasos               → Durlock y cielorrasos
--   Gasista                                     → Gas
--   Techista y cubiertas                        → Techista
--   Tutorías universitarias                     → Clases particulares universidad
--   Limpieza residencial y profunda             → Limpieza
--   Adiestramiento canino                       → Adiestramiento canino a domicilio
--   Peluquería canina (grooming)                → Peluquería canina a domicilio
--   Instalación de audio, TV y streaming        → Instalación de audio y TV
--   Redes, Wi‑Fi y cableado estructurado        → Redes y Wi-Fi
--     (también la variante con guion ASCII Wi-Fi)
--   Fletes y mini fletes                        → Fletes y mudanzas
--   Mudanzas                                    → Fletes y mudanzas
--
-- Sin destino en el catálogo activo: NO se reescriben (siguen en oficio_keywords
-- para el buscador #97):
--   Arreglos generales del hogar (handyman), Armado y actualización de PC,
--   Recuperación de datos, Reparación de celulares y tablets,
--   Reparación de notebooks y computadoras, Soporte técnico informático,
--   Micropigmentación y diseño de cejas, Tratamientos capilares,
--   Tratamientos faciales y corporales, Cadetería y mensajería,
--   Transporte de carga liviana, Cuidado de mascotas (pet sitting),
--   Clases de cocina, Informática para adultos mayores,
--   Bartender y coctelería, Decoración de eventos, Mozos y servicio de sala,
--   Video y streaming de eventos.
--
-- Mismo texto en la app y en el admin (no entra al mapa):
--   Catering y banquetería.
-- Idempotente: se puede volver a correr.
-- =============================================================================

DROP FUNCTION IF EXISTS pg_temp.remap_trade_snapshot(jsonb);
DROP FUNCTION IF EXISTS pg_temp.remap_trade_text(text);
DROP TABLE IF EXISTS pg_temp.trade_name_map;

CREATE TEMP TABLE trade_name_map (
  old_name text PRIMARY KEY,
  new_name text NOT NULL,
  slug     text NOT NULL
);

INSERT INTO pg_temp.trade_name_map (old_name, new_name, slug)
VALUES
  ('Barbería y barbero a domicilio', 'Barbería a domicilio', 'barberia-domicilio'),
  ('Masajes y terapias manuales', 'Masajes a domicilio', 'masajes-terapias-manuales'),
  ('Corte, color y peinado (peluquería)', 'Peluquería a domicilio', 'corte-color-peinado'),
  ('Drywall, pladur y cielorrasos', 'Durlock y cielorrasos', 'drywall-pladur-cielorrasos'),
  ('Gasista', 'Gas', 'gasista'),
  ('Techista y cubiertas', 'Techista', 'techista-cubiertas'),
  ('Tutorías universitarias', 'Clases particulares universidad', 'tutorias-universitarias'),
  ('Limpieza residencial y profunda', 'Limpieza', 'limpieza-residencial-profunda'),
  ('Adiestramiento canino', 'Adiestramiento canino a domicilio', 'adiestramiento-canino'),
  ('Peluquería canina (grooming)', 'Peluquería canina a domicilio', 'peluqueria-canina'),
  ('Instalación de audio, TV y streaming', 'Instalación de audio y TV', 'instalacion-audio-tv-streaming'),
  ('Redes, Wi' || chr(8209) || 'Fi y cableado estructurado', 'Redes y Wi-Fi', 'redes-wifi-cableado'),
  ('Redes, Wi-Fi y cableado estructurado', 'Redes y Wi-Fi', 'redes-wifi-cableado'),
  ('Fletes y mini fletes', 'Fletes y mudanzas', 'fletes-mini-fletes'),
  ('Mudanzas', 'Fletes y mudanzas', 'fletes-mini-fletes');

-- Solo remapea si el nombre nuevo sigue activo en el catálogo del admin.
CREATE FUNCTION pg_temp.remap_trade_text(p_text text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    (
      SELECT m.new_name
      FROM pg_temp.trade_name_map m
      JOIN public.professional_trades pt
        ON pt.name = m.new_name
       AND pt.active
      WHERE m.old_name = btrim(p_text)
      LIMIT 1
    ),
    p_text
  );
$$;

-- Perfil desactivado (professional_jobs_backup) y archivo (jobs_snapshot)
-- guardan el oficio en nombre_oficio y/o name.
CREATE FUNCTION pg_temp.remap_trade_snapshot(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_snapshot) IS DISTINCT FROM 'array' THEN p_snapshot
    ELSE coalesce((
      SELECT jsonb_agg(
        CASE
          WHEN jsonb_typeof(elem) IS DISTINCT FROM 'object' THEN elem
          ELSE
            elem
            || CASE
                 WHEN elem ? 'nombre_oficio' THEN jsonb_build_object(
                   'nombre_oficio',
                   pg_temp.remap_trade_text(elem->>'nombre_oficio')
                 )
                 ELSE '{}'::jsonb
               END
            || CASE
                 WHEN elem ? 'name' THEN jsonb_build_object(
                   'name',
                   pg_temp.remap_trade_text(elem->>'name')
                 )
                 ELSE '{}'::jsonb
               END
        END
        ORDER BY ord
      )
      FROM jsonb_array_elements(p_snapshot) WITH ORDINALITY AS t(elem, ord)
    ), '[]'::jsonb)
  END;
$$;

UPDATE public.jobs
SET nombre_oficio = pg_temp.remap_trade_text(nombre_oficio)
WHERE nombre_oficio IS NOT NULL
  AND nombre_oficio IS DISTINCT FROM pg_temp.remap_trade_text(nombre_oficio);

UPDATE public.posts
SET trade = pg_temp.remap_trade_text(trade)
WHERE trade IS NOT NULL
  AND trade IS DISTINCT FROM pg_temp.remap_trade_text(trade);

UPDATE public.conversations
SET primary_trade = pg_temp.remap_trade_text(primary_trade)
WHERE primary_trade IS NOT NULL
  AND primary_trade IS DISTINCT FROM pg_temp.remap_trade_text(primary_trade);

UPDATE public.profiles
SET professional_jobs_backup = pg_temp.remap_trade_snapshot(professional_jobs_backup)
WHERE professional_jobs_backup IS NOT NULL
  AND professional_jobs_backup IS DISTINCT FROM pg_temp.remap_trade_snapshot(professional_jobs_backup);

UPDATE public.professional_jobs_archive
SET jobs_snapshot = pg_temp.remap_trade_snapshot(jobs_snapshot)
WHERE jobs_snapshot IS NOT NULL
  AND jobs_snapshot IS DISTINCT FROM pg_temp.remap_trade_snapshot(jobs_snapshot);

-- Palabras clave del nombre viejo pasan al nombre nuevo. No se pisan las del admin.
WITH mapped AS (
  SELECT m.new_name, m.old_name, pt.slug
  FROM pg_temp.trade_name_map m
  JOIN public.professional_trades pt
    ON pt.name = m.new_name
   AND pt.active
  WHERE m.old_name IS DISTINCT FROM m.new_name
),
kw AS (
  SELECT
    mapped.new_name,
    max(mapped.slug) AS slug,
    coalesce(
      array_agg(DISTINCT k ORDER BY k) FILTER (WHERE k IS NOT NULL AND btrim(k) <> ''),
      '{}'::text[]
    ) AS keywords
  FROM mapped
  JOIN public.oficio_keywords ok ON ok.oficio = mapped.old_name
  LEFT JOIN LATERAL unnest(ok.keywords) AS k ON true
  GROUP BY mapped.new_name
)
INSERT INTO public.oficio_keywords (oficio, slug_app, keywords)
SELECT kw.new_name, kw.slug, kw.keywords
FROM kw
ON CONFLICT (oficio) DO UPDATE
SET
  slug_app = coalesce(EXCLUDED.slug_app, public.oficio_keywords.slug_app),
  keywords = (
    SELECT coalesce(array_agg(DISTINCT k ORDER BY k), '{}'::text[])
    FROM unnest(
      coalesce(public.oficio_keywords.keywords, '{}'::text[])
      || coalesce(EXCLUDED.keywords, '{}'::text[])
    ) AS k
    WHERE k IS NOT NULL AND btrim(k) <> ''
  ),
  updated_at = now()
WHERE public.oficio_keywords.keywords IS DISTINCT FROM (
  SELECT coalesce(array_agg(DISTINCT k ORDER BY k), '{}'::text[])
  FROM unnest(
    coalesce(public.oficio_keywords.keywords, '{}'::text[])
    || coalesce(EXCLUDED.keywords, '{}'::text[])
  ) AS k
  WHERE k IS NOT NULL AND btrim(k) <> ''
);

DELETE FROM public.oficio_keywords ok
USING pg_temp.trade_name_map m
JOIN public.professional_trades pt
  ON pt.name = m.new_name
 AND pt.active
WHERE ok.oficio = m.old_name
  AND m.old_name IS DISTINCT FROM m.new_name
  AND EXISTS (
    SELECT 1
    FROM public.oficio_keywords kept
    WHERE kept.oficio = m.new_name
  );

DROP FUNCTION IF EXISTS pg_temp.remap_trade_snapshot(jsonb);
DROP FUNCTION IF EXISTS pg_temp.remap_trade_text(text);
DROP TABLE IF EXISTS pg_temp.trade_name_map;

-- Oficios guardados que siguen fuera del catálogo activo (los sin destino, arriba).
SELECT j.nombre_oficio, count(*) AS n
FROM public.jobs j
WHERE NOT EXISTS (
  SELECT 1
  FROM public.professional_trades pt
  WHERE pt.active
    AND pt.name = j.nombre_oficio
)
GROUP BY j.nombre_oficio
ORDER BY j.nombre_oficio;
