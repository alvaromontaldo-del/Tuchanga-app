-- YaChanga P1 #69, #70 y idempotencia de transacciones_pago (Mercado Pago).
--
-- Aplicado en producción el 2026-10-01 (antes del merge del PR #45).
-- Un solo archivo. No está en supabase/migrations/.
--
-- #69  enqueue_store_push: quitar EXECUTE a anon, authenticated y PUBLIC.
--      No se recrea la función: el cuerpo vigente (incluido cualquier guard
--      que ya esté en la base) se conserva. Los callers internos son
--      SECURITY DEFINER y corren como owner, así que siguen pudiendo encolar.
-- #70  search_workers_for_client: devuelve nombre + inicial y ubicación
--      gruesa (anon y logueado). La app no necesita el domicilio exacto ni
--      el apellido completo (abre el perfil por id y ordena por distance_km).
-- Pago Una sola fila approved de seña de materiales por orden, y una sola
--      fila approved de servicio por (contratación, tipo, mp_payment_id).

-- ---------------------------------------------------------------------------
-- #69  Callers de enqueue_store_push (todos SECURITY DEFINER, ninguno es la app)
-- ---------------------------------------------------------------------------
-- Trigger:  public.trg_request_target_store_push_new
--            (AFTER INSERT ON request_target_stores) — nueva solicitud.
-- Funciones:
--   reject_material_quote                  migrations/20260811230000
--   completar_orden_material_con_pin       migrations/20260820183000
--   confirmar_sena_material_orden          migrations/20260925200000
--   registrar_sena_material_aprobada       este archivo (cuerpo de card 61)
-- La app (src/) no llama rpc('enqueue_store_push').
-- service_role conserva EXECUTE por si una Edge lo invoca directo.
-- El grant original está en migrations/20260811220000_store_board_pushes.sql.

REVOKE ALL ON FUNCTION public.enqueue_store_push(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_store_push(uuid, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_store_push(uuid, text, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_store_push(uuid, text, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- #70  search_workers_for_client
-- Cuerpo de partida: el que está en producción al 2026-10-01 (incluye
-- total_jobs_done y el filtro professional_status = 'accepted'), no el de
-- migrations/20260428170000. Misma firma y mismas columnas de salida
-- (CREATE OR REPLACE, sin DROP). Solo cambian las columnas con datos personales:
--   apellido     → solo la inicial
--   lat / lng    → redondeadas a 2 decimales (~1 km)
--   distance_km  → redondeada a 0,1 km (el filtro y el orden usan la exacta)
-- La búsqueda por apellido completo queda solo para usuarios logueados.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_workers_for_client(
  p_client_lat double precision,
  p_client_lng double precision,
  p_query text DEFAULT '',
  p_category_names text[] DEFAULT NULL,
  p_exclude_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 80
)
RETURNS TABLE (
  profile_id uuid,
  nombre text,
  apellido text,
  avatar_url text,
  lat double precision,
  lng double precision,
  coverage_km integer,
  distance_km double precision,
  primary_trade text,
  all_trades text[],
  summary_jobs text,
  rating_average numeric,
  review_count integer,
  total_jobs_done integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      coalesce(p.total_jobs_done, 0) AS total_jobs_done
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
    nullif(upper(left(btrim(coalesce(b.apellido_full, '')), 1)), '') AS apellido,
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
    b.total_jobs_done
  FROM base b
  WHERE b.distance_exact <= b.coverage_km
    AND (
      coalesce(trim(p_query), '') = ''
      OR b.nombre ILIKE '%' || trim(p_query) || '%'
      OR (auth.uid() IS NOT NULL AND b.apellido_full ILIKE '%' || trim(p_query) || '%')
      OR b.primary_trade ILIKE '%' || trim(p_query) || '%'
      OR exists (
        SELECT 1 FROM unnest(coalesce(b.all_trades, array[]::text[])) t
        WHERE t ILIKE '%' || trim(p_query) || '%'
      )
      OR coalesce(b.summary_jobs, '') ILIKE '%' || trim(p_query) || '%'
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
$$;

COMMENT ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) IS
  'Búsqueda de profesionales. Devuelve nombre + inicial del apellido, distancia redondeada a 0,1 km y coordenadas redondeadas a ~1 km. No devuelve el apellido completo ni el lat/lng exacto.';

REVOKE ALL ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) TO anon;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) TO service_role;

-- ---------------------------------------------------------------------------
-- Idempotencia MP — detección (solo lectura).
-- El número de duplicados es lo que imprimen estos NOTICE
-- (grupos_duplicados / filas_sobrantes). La limpieza de abajo los resuelve
-- antes de crear los índices; correr el archivo de nuevo no borra nada más.
--
-- La misma consulta, para pegarla sola en el editor:
--
-- SELECT 'seña_materiales' AS tipo,
--        count(*) AS grupos_duplicados,
--        coalesce(sum(n - 1), 0) AS filas_sobrantes
-- FROM (
--   SELECT material_order_id, count(*) AS n
--   FROM public.transacciones_pago
--   WHERE estado_mp = 'approved'
--     AND tipo_pago = 'seña_materiales'
--     AND material_order_id IS NOT NULL
--   GROUP BY material_order_id
--   HAVING count(*) > 1
-- ) d;
--
-- SELECT 'servicio' AS tipo,
--        count(*) AS grupos_duplicados,
--        coalesce(sum(n - 1), 0) AS filas_sobrantes
-- FROM (
--   SELECT contratacion_id, tipo_pago, mp_payment_id, count(*) AS n
--   FROM public.transacciones_pago
--   WHERE estado_mp = 'approved'
--     AND contratacion_id IS NOT NULL
--     AND mp_payment_id IS NOT NULL
--     AND btrim(mp_payment_id) <> ''
--     AND tipo_pago IN ('seña_inicial', 'diferencia_seña')
--   GROUP BY contratacion_id, tipo_pago, mp_payment_id
--   HAVING count(*) > 1
-- ) d;
-- ---------------------------------------------------------------------------

DO $detect_dup_pagos$
DECLARE
  v_mat_grupos bigint;
  v_mat_sobrantes bigint;
  v_srv_grupos bigint;
  v_srv_sobrantes bigint;
BEGIN
  SELECT count(*), coalesce(sum(n - 1), 0)::bigint
    INTO v_mat_grupos, v_mat_sobrantes
  FROM (
    SELECT material_order_id, count(*) AS n
    FROM public.transacciones_pago
    WHERE estado_mp = 'approved'
      AND tipo_pago = 'seña_materiales'
      AND material_order_id IS NOT NULL
    GROUP BY material_order_id
    HAVING count(*) > 1
  ) d;

  SELECT count(*), coalesce(sum(n - 1), 0)::bigint
    INTO v_srv_grupos, v_srv_sobrantes
  FROM (
    SELECT contratacion_id, tipo_pago, mp_payment_id, count(*) AS n
    FROM public.transacciones_pago
    WHERE estado_mp = 'approved'
      AND contratacion_id IS NOT NULL
      AND mp_payment_id IS NOT NULL
      AND btrim(mp_payment_id) <> ''
      AND tipo_pago IN ('seña_inicial', 'diferencia_seña')
    GROUP BY contratacion_id, tipo_pago, mp_payment_id
    HAVING count(*) > 1
  ) d;

  RAISE NOTICE 'seña_materiales grupos_duplicados=% filas_sobrantes=%', v_mat_grupos, v_mat_sobrantes;
  RAISE NOTICE 'servicio grupos_duplicados=% filas_sobrantes=%', v_srv_grupos, v_srv_sobrantes;
END
$detect_dup_pagos$;

-- Limpieza (aplicada el 2026-10-01). La detección en producción dio:
--   seña_materiales: 9 órdenes con 2 filas approved (9 sobrantes)
--   servicio:        6 contrataciones con 2-3 filas approved (7 sobrantes)
-- En todos los grupos las filas son el MISMO pago de MP: mismo mp_payment_id,
-- mismo monto y mismo cliente. La fila vieja es la de la preferencia
-- (mp_crear_preferencia, promovida a approved por la Edge) y la nueva es la
-- que insertó la RPC con idempotency_key 'mp_payment:<id>'.
-- Se conserva la fila más vieja de cada grupo, que es la misma que ya
-- cuentan las RPCs de admin (DISTINCT ON ... ORDER BY created_at ASC, id ASC),
-- así que los totales de facturación no cambian.
-- Las filas borradas quedan copiadas en public.transacciones_pago_dedupe_77
-- (con RLS y sin grants a anon/authenticated). La fila que queda guarda en
-- metadata.dedupe_77 los ids y las idempotency_key borradas.
-- Si algún grupo tuviera montos, clientes o pagos distintos, la limpieza
-- aborta y no borra nada.

CREATE TABLE IF NOT EXISTS public.transacciones_pago_dedupe_77 (
  LIKE public.transacciones_pago,
  kept_id uuid NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transacciones_pago_dedupe_77 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transacciones_pago_dedupe_77 FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.transacciones_pago_dedupe_77 TO service_role;

DO $dedupe_pagos_77$
DECLARE
  v_bad integer;
  v_removed integer;
BEGIN
  CREATE TEMP TABLE _tp_dupes ON COMMIT DROP AS
  WITH g AS (
    SELECT
      t.id,
      t.idempotency_key,
      CASE
        WHEN t.tipo_pago = 'seña_materiales' THEN 'mat:' || t.material_order_id::text
        ELSE 'srv:' || t.contratacion_id::text || ':' || t.tipo_pago::text || ':' || t.mp_payment_id
      END AS grp,
      t.monto,
      t.cliente_id,
      t.mp_payment_id,
      t.created_at
    FROM public.transacciones_pago t
    WHERE t.estado_mp = 'approved'
      AND (
        (t.tipo_pago = 'seña_materiales' AND t.material_order_id IS NOT NULL)
        OR (
          t.tipo_pago IN ('seña_inicial', 'diferencia_seña')
          AND t.contratacion_id IS NOT NULL
          AND t.mp_payment_id IS NOT NULL
          AND btrim(t.mp_payment_id) <> ''
        )
      )
  ),
  r AS (
    SELECT
      g.*,
      count(*) OVER (PARTITION BY g.grp) AS n,
      row_number() OVER (PARTITION BY g.grp ORDER BY g.created_at ASC, g.id ASC) AS rn,
      first_value(g.id) OVER (PARTITION BY g.grp ORDER BY g.created_at ASC, g.id ASC) AS kept_id
    FROM g
  )
  SELECT * FROM r WHERE r.n > 1;

  SELECT count(*) INTO v_bad
  FROM (
    SELECT grp
    FROM _tp_dupes
    GROUP BY grp
    HAVING count(DISTINCT monto) > 1
        OR count(DISTINCT cliente_id) > 1
        OR count(DISTINCT coalesce(mp_payment_id, '')) > 1
  ) x;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'dedupe_77: % grupos con montos/clientes/pagos distintos; no se borra nada', v_bad;
  END IF;

  INSERT INTO public.transacciones_pago_dedupe_77
  SELECT t.*, d.kept_id, now()
  FROM public.transacciones_pago t
  JOIN _tp_dupes d ON d.id = t.id
  WHERE d.rn > 1;

  UPDATE public.transacciones_pago k
  SET metadata = coalesce(k.metadata, '{}'::jsonb) || jsonb_build_object(
        'dedupe_77', jsonb_build_object(
          'removed_ids', x.ids,
          'removed_idempotency_keys', x.keys,
          'at', now()
        )
      )
  FROM (
    SELECT kept_id, jsonb_agg(id ORDER BY rn) AS ids, jsonb_agg(idempotency_key ORDER BY rn) AS keys
    FROM _tp_dupes
    WHERE rn > 1
    GROUP BY kept_id
  ) x
  WHERE k.id = x.kept_id;

  DELETE FROM public.transacciones_pago t
  USING _tp_dupes d
  WHERE t.id = d.id AND d.rn > 1;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RAISE NOTICE 'dedupe_77: filas borradas=%', v_removed;
END
$dedupe_pagos_77$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transacciones_pago_sena_materiales_approved
  ON public.transacciones_pago (material_order_id)
  WHERE estado_mp = 'approved'
    AND tipo_pago = 'seña_materiales'
    AND material_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transacciones_pago_servicio_mp_approved
  ON public.transacciones_pago (contratacion_id, tipo_pago, mp_payment_id)
  WHERE estado_mp = 'approved'
    AND contratacion_id IS NOT NULL
    AND mp_payment_id IS NOT NULL
    AND btrim(mp_payment_id) <> ''
    AND tipo_pago IN ('seña_inicial', 'diferencia_seña');

-- ---------------------------------------------------------------------------
-- registrar_sena_material_aprobada
-- Cuerpo de partida: supabase/20260929_p0_material_fee_mp_only_card_61.sql
-- (a su vez, migrations/20260925200000 + guard de service_role).
-- Único cambio de comportamiento: no inserta una segunda fila approved.
-- Si ya hay una seña approved para la orden, no escribe otra.
-- Si hay una fila de la preferencia (pending), la promueve.
-- Si no hay ninguna, inserta con ON CONFLICT DO NOTHING.
-- El resto (grupo, chat, push, guard de service_role) queda igual.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_sena_material_aprobada(
  p_order_id uuid,
  p_monto numeric,
  p_mp_payment_id text DEFAULT NULL,
  p_mp_preference_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_external_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_sibling public.orders%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_already_paid boolean := false;
  v_group_id uuid;
  v_existing uuid;
  v_client_id uuid;
  v_conv_ids uuid[] := ARRAY[]::uuid[];
  v_conv_counts integer[] := ARRAY[]::integer[];
  v_conv_orders uuid[] := ARRAY[]::uuid[];
  v_idx integer;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF btrim(coalesce(p_idempotency_key, '')) <> '' THEN
    SELECT id INTO v_existing
    FROM public.transacciones_pago
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      -- Re-asegurar estado aunque la tx ya exista (no RETURN ciego).
      v_group_id := v_order.payment_group_id;
      IF v_group_id IS NOT NULL THEN
        FOR v_sibling IN
          SELECT * FROM public.orders
          WHERE payment_group_id = v_group_id
          ORDER BY created_at ASC
          FOR UPDATE
        LOOP
          PERFORM public._mark_material_order_fee_paid(v_sibling.id);
        END LOOP;
        UPDATE public.material_checkouts
        SET status = 'paid', updated_at = now()
        WHERE id = v_group_id AND status IS DISTINCT FROM 'paid';
      ELSE
        PERFORM public._mark_material_order_fee_paid(p_order_id);
      END IF;
      RETURN;
    END IF;
  END IF;

  BEGIN
    WITH target AS (
      SELECT t2.id
      FROM public.transacciones_pago t2
      WHERE t2.material_order_id = p_order_id
        AND t2.tipo_pago = 'seña_materiales'
        AND t2.estado_mp IS DISTINCT FROM 'approved'
        AND NOT EXISTS (
          SELECT 1
          FROM public.transacciones_pago t3
          WHERE t3.material_order_id = p_order_id
            AND t3.tipo_pago = 'seña_materiales'
            AND t3.estado_mp = 'approved'
        )
      ORDER BY t2.created_at DESC
      LIMIT 1
    ),
    upd AS (
      UPDATE public.transacciones_pago t
      SET
        estado_mp = 'approved',
        monto = greatest(coalesce(p_monto, t.monto, 0), 0),
        mp_preference_id = coalesce(nullif(p_mp_preference_id, ''), t.mp_preference_id),
        mp_payment_id = coalesce(nullif(p_mp_payment_id, ''), t.mp_payment_id),
        external_reference = coalesce(nullif(p_external_reference, ''), t.external_reference),
        metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
          'source', 'registrar_sena_material_aprobada',
          'payment_group_id', v_order.payment_group_id
        ),
        updated_at = now()
      FROM target
      WHERE t.id = target.id
      RETURNING t.id
    )
    INSERT INTO public.transacciones_pago (
      contratacion_id,
      material_order_id,
      cliente_id,
      tipo_pago,
      monto,
      estado_mp,
      mp_preference_id,
      mp_payment_id,
      idempotency_key,
      external_reference,
      metadata
    )
    SELECT
      NULL,
      p_order_id,
      v_order.client_id,
      'seña_materiales',
      greatest(coalesce(p_monto, 0), 0),
      'approved',
      nullif(p_mp_preference_id, ''),
      nullif(p_mp_payment_id, ''),
      coalesce(nullif(p_idempotency_key, ''), 'manual:' || p_order_id::text || ':' || clock_timestamp()::text),
      coalesce(nullif(p_external_reference, ''), 'order_id:' || p_order_id::text || '|tipo_pago:sena_materiales'),
      jsonb_build_object(
        'source', 'registrar_sena_material_aprobada',
        'payment_group_id', v_order.payment_group_id
      )
    WHERE NOT EXISTS (SELECT 1 FROM upd)
      AND NOT EXISTS (
        SELECT 1
        FROM public.transacciones_pago t3
        WHERE t3.material_order_id = p_order_id
          AND t3.tipo_pago = 'seña_materiales'
          AND t3.estado_mp = 'approved'
      )
    ON CONFLICT DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  v_already_paid := (v_order.deposit_status = 'paid' AND v_order.status IN ('deposit_paid', 'completed'));
  v_group_id := v_order.payment_group_id;
  v_client_id := v_order.client_id;

  IF v_group_id IS NOT NULL THEN
    FOR v_sibling IN
      SELECT * FROM public.orders
      WHERE payment_group_id = v_group_id
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      PERFORM public._mark_material_order_fee_paid(v_sibling.id);

      SELECT * INTO v_quote FROM public.quotes WHERE id = v_sibling.quote_id;
      SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
      SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
      SELECT * INTO v_order FROM public.orders WHERE id = v_sibling.id;

      IF NOT v_already_paid AND v_req.conversation_id IS NOT NULL THEN
        v_idx := array_position(v_conv_ids, v_req.conversation_id);
        IF v_idx IS NULL THEN
          v_conv_ids := array_append(v_conv_ids, v_req.conversation_id);
          v_conv_counts := array_append(v_conv_counts, 1);
          v_conv_orders := array_append(v_conv_orders, v_sibling.id);
        ELSE
          v_conv_counts[v_idx] := v_conv_counts[v_idx] + 1;
        END IF;
      END IF;

      IF NOT v_already_paid THEN
        PERFORM public.enqueue_store_push(
          v_quote.store_id,
          'fee_paid',
          'YaChanga',
          'Pedido confirmado: el cliente pagó el costo de servicio. Prepará el pedido '
            || coalesce(v_order.order_code, '') || '.',
          jsonb_build_object(
            'type', 'store_board',
            'column', 'confirmadas',
            'orderId', v_order.id,
            'orderCode', v_order.order_code,
            'quoteId', v_quote.id,
            'requestId', v_quote.request_id
          )
        );
      END IF;
    END LOOP;

    UPDATE public.material_checkouts
    SET status = 'paid', updated_at = now()
    WHERE id = v_group_id AND status IS DISTINCT FROM 'paid';

    IF NOT v_already_paid THEN
      FOR v_idx IN 1 .. coalesce(cardinality(v_conv_ids), 0)
      LOOP
        PERFORM public._notify_material_service_fee_paid(
          v_conv_ids[v_idx],
          v_client_id,
          v_conv_orders[v_idx],
          v_group_id,
          v_conv_counts[v_idx]
        );
      END LOOP;
    END IF;
  ELSE
    v_order := public._mark_material_order_fee_paid(p_order_id);

    SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
    SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
    SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

    IF NOT v_already_paid AND v_req.conversation_id IS NOT NULL THEN
      PERFORM public._notify_material_service_fee_paid(
        v_req.conversation_id,
        v_client_id,
        v_order.id,
        NULL,
        1
      );
    END IF;

    IF NOT v_already_paid THEN
      PERFORM public.enqueue_store_push(
        v_quote.store_id,
        'fee_paid',
        'YaChanga',
        'Pedido confirmado: el cliente pagó el costo de servicio. Prepará el pedido '
          || coalesce(v_order.order_code, '') || '.',
        jsonb_build_object(
          'type', 'store_board',
          'column', 'confirmadas',
          'orderId', v_order.id,
          'orderCode', v_order.order_code,
          'quoteId', v_quote.id,
          'requestId', v_quote.request_id
        )
      );
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text)
TO service_role;

COMMENT ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) IS
  'Acredita la seña de materiales (solo service_role). Una sola fila approved por orden: promueve la preferencia o inserta con ON CONFLICT DO NOTHING.';

-- ---------------------------------------------------------------------------
-- registrar_seña_aprobada
-- Cuerpo de partida: migrations/20260618140000_sena_trabajador_mensaje_exacto.sql
-- Único cambio: misma carrera webhook/retorno. Promueve la fila pendiente
-- del mismo tipo o inserta ON CONFLICT DO NOTHING. El chat y el guard de
-- service_role quedan igual. El índice parcial cubre
-- (contratacion_id, tipo_pago, mp_payment_id) approved.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_seña_aprobada(
  p_contratacion_id uuid,
  p_tipo_pago public.transaccion_tipo_pago,
  p_monto numeric,
  p_mp_payment_id text,
  p_mp_preference_id text,
  p_idempotency_key text,
  p_external_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_was_pending boolean;
  v_mp_id text := nullif(btrim(coalesce(p_mp_payment_id, '')), '');
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role';
  END IF;

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contratación inexistente';
  END IF;

  v_was_pending := v_row.estado_pago = 'pendiente_seña';

  BEGIN
    WITH target AS (
      SELECT t2.id
      FROM public.transacciones_pago t2
      WHERE t2.contratacion_id = p_contratacion_id
        AND t2.tipo_pago = p_tipo_pago
        AND t2.estado_mp IS DISTINCT FROM 'approved'
        AND (
          t2.mp_payment_id IS NULL
          OR btrim(t2.mp_payment_id) = ''
          OR v_mp_id IS NULL
          OR t2.mp_payment_id = v_mp_id
        )
        AND NOT (
          v_mp_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.transacciones_pago t3
            WHERE t3.contratacion_id = p_contratacion_id
              AND t3.tipo_pago = p_tipo_pago
              AND t3.estado_mp = 'approved'
              AND t3.mp_payment_id = v_mp_id
          )
        )
      ORDER BY t2.created_at DESC
      LIMIT 1
    ),
    upd AS (
      UPDATE public.transacciones_pago t
      SET
        estado_mp = 'approved',
        monto = p_monto,
        mp_payment_id = coalesce(v_mp_id, nullif(btrim(coalesce(t.mp_payment_id, '')), '')),
        mp_preference_id = coalesce(nullif(p_mp_preference_id, ''), t.mp_preference_id),
        external_reference = coalesce(nullif(p_external_reference, ''), t.external_reference),
        updated_at = now()
      FROM target
      WHERE t.id = target.id
      RETURNING t.id
    )
    INSERT INTO public.transacciones_pago (
      contratacion_id,
      cliente_id,
      tipo_pago,
      monto,
      estado_mp,
      mp_payment_id,
      mp_preference_id,
      idempotency_key,
      external_reference
    )
    SELECT
      p_contratacion_id,
      v_row.client_id,
      p_tipo_pago,
      p_monto,
      'approved',
      v_mp_id,
      p_mp_preference_id,
      p_idempotency_key,
      p_external_reference
    WHERE NOT EXISTS (SELECT 1 FROM upd)
      AND NOT (
        v_mp_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.transacciones_pago t3
          WHERE t3.contratacion_id = p_contratacion_id
            AND t3.tipo_pago = p_tipo_pago
            AND t3.estado_mp = 'approved'
            AND t3.mp_payment_id = v_mp_id
        )
      )
    ON CONFLICT DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  IF v_was_pending THEN
    UPDATE public.contrataciones
    SET
      estado_pago = 'seña_pagada',
      seña_pagada_at = now(),
      verification_pin = coalesce(verification_pin, public.generar_pin_verificacion()),
      pin_intentos_fallidos = 0,
      pin_bloqueado_hasta = NULL,
      recotizacion_precio_trabajador = NULL,
      recotizacion_precio_final = NULL,
      recotizacion_comision_app = NULL,
      estado_trabajo = CASE
        WHEN estado_trabajo = 'pendiente_pago_diferencia' THEN 'en_curso'
        ELSE estado_trabajo
      END
    WHERE id = p_contratacion_id;

    BEGIN
      PERFORM public._chat_insert_system_event(
        v_row.conversation_id,
        v_row.client_id,
        '✅ Seña pagada correctamente.' || E'\n\n'
          || 'Tu PIN de seguridad ha sido generado. Por motivos de seguridad, dáselo al trabajador '
          || 'únicamente cuando llegue a tu domicilio.' || E'\n\n'
          || 'La dirección de tu domicilio ha sido compartida con el trabajador para que pueda asistir.',
        jsonb_build_object(
          'event', 'seña_pagada_cliente',
          'contratacion_id', p_contratacion_id,
          'audience', 'cliente'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'registrar_seña chat cliente: %', SQLERRM;
    END;

    BEGIN
      PERFORM public._chat_insert_system_event(
        v_row.conversation_id,
        v_row.worker_id,
        'La seña fue pagada. Al llegar al domicilio, vas a tener que pedirle el PIN al cliente.',
        jsonb_build_object(
          'event', 'seña_pagada_trabajador',
          'contratacion_id', p_contratacion_id,
          'audience', 'trabajador'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'registrar_seña chat trabajador: %', SQLERRM;
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_seña_aprobada(
  uuid, public.transaccion_tipo_pago, numeric, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_seña_aprobada(
  uuid, public.transaccion_tipo_pago, numeric, text, text, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_seña_aprobada(
  uuid, public.transaccion_tipo_pago, numeric, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.registrar_seña_aprobada(
  uuid, public.transaccion_tipo_pago, numeric, text, text, text, text
) IS
  'Acredita la seña de un servicio (solo service_role). No duplica una fila approved del mismo mp_payment_id.';
