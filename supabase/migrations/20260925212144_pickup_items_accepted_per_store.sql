-- #51: cada tarjeta de comercio (Para retirar / Historial) debe listar solo
-- los materiales que el cliente aceptó en ESA cotización. La versión anterior
-- devolvía todos los request_items del pedido en todos los comercios.

CREATE OR REPLACE FUNCTION public.list_my_material_solicitudes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sort_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      o.id AS order_id,
      mr.id AS request_id,
      upper(left(replace(mr.id::text, '-', ''), 8)) AS numero_solicitud,
      regexp_replace(coalesce(o.order_code, ''), '[^0-9]', '', 'g') AS numero_pedido,
      o.order_code,
      coalesce(nullif(trim(mr.title), ''), 'Pedido de materiales') AS title,
      coalesce(nullif(trim(s.name), ''), 'Comercio') AS store_name,
      coalesce(nullif(trim(s.address), ''), '') AS store_address,
      coalesce(s.opening_hours, '[]'::jsonb) AS store_opening_hours,
      coalesce(o.contact_revealed_at, o.updated_at, o.created_at) AS available_at,
      o.completed_at,
      CASE
        WHEN nullif(btrim(coalesce(o.verification_pin, '')), '') IS NOT NULL
        THEN lpad(btrim(o.verification_pin), 4, '0')
        ELSE NULL
      END AS verification_pin,
      o.accepted_total,
      coalesce(o.include_freight, true) AS include_freight,
      q.freight_type,
      q.freight_cost,
      o.status AS order_status,
      o.deposit_status,
      CASE
        WHEN o.status = 'completed' THEN 'historial'
        ELSE 'activa'
      END AS list_bucket,
      CASE
        WHEN o.status = 'completed' THEN coalesce(o.completed_at, o.updated_at, o.created_at)
        ELSE coalesce(o.contact_revealed_at, o.updated_at, o.created_at)
      END AS sort_at,
      coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', qi.id,
              'request_item_id', ri.id,
              'description', ri.description,
              'quantity', ri.quantity,
              'unit', ri.unit,
              'sort_order', ri.sort_order,
              'sortOrder', ri.sort_order,
              'client_decision', qi.client_decision,
              'variant_label', nullif(btrim(coalesce(qi.variant_label, '')), ''),
              'alternative_description', nullif(btrim(coalesce(qi.alternative_description, '')), ''),
              'in_stock', qi.in_stock,
              'brand', CASE
                WHEN qi.in_stock IS FALSE
                  THEN nullif(btrim(coalesce(qi.alternative_description, qi.variant_label, '')), '')
                ELSE nullif(btrim(coalesce(qi.variant_label, '')), '')
              END
            )
            ORDER BY ri.sort_order, ri.created_at, qi.variant_index, qi.created_at
          )
          FROM public.quote_items qi
          JOIN public.request_items ri ON ri.id = qi.request_item_id
          WHERE qi.quote_id = q.id
            AND qi.client_decision = 'accepted'
        ),
        '[]'::jsonb
      ) AS items
    FROM public.orders o
    JOIN public.quotes q ON q.id = o.quote_id
    JOIN public.material_requests mr ON mr.id = q.request_id
    JOIN public.stores s ON s.id = q.store_id
    WHERE coalesce(o.status, '') IS DISTINCT FROM 'cancelled'
      AND o.deposit_status IN ('paid', 'waived')
      AND (
        o.status = 'deposit_paid'
        OR o.status = 'completed'
      )
      AND nullif(btrim(coalesce(o.verification_pin, '')), '') IS NOT NULL
      AND nullif(btrim(coalesce(o.order_code, '')), '') IS NOT NULL
      AND (
        mr.client_id = uid
        OR mr.professional_id = uid
        OR q.client_id = uid
        OR o.client_id = uid
      )
  ) x;

  RETURN v_rows;
END;
$function$;

COMMENT ON FUNCTION public.list_my_material_solicitudes() IS
  'Pedidos de materiales listos para retirar o ya retirados. items = solo quote_items aceptados de esa cotización (ese comercio).';
