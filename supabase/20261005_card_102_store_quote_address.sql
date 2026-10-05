-- Ticket #102: el comercio destinatario ve la calle del cliente para cotizar el flete.
-- Antes get_store_request_client_address solo devolvía la dirección con la orden pagada,
-- y la app caía a coordenadas redondeadas (~1 km), inútiles para el flete.
--
-- NO está aplicado. Ejecutar este archivo una sola vez en el SQL editor de Supabase.
--
-- Quién la ve: solo el dueño del comercio, y solo si ese comercio está en
-- request_target_stores de ese pedido. No devuelve lat/lng.
-- No abre profiles.direccion_texto al profesional ni a otros usuarios.
-- No toca PIN, fee, checkout, horarios ni el listado de retiros (#63, #48, #103).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_store_request_client_address(p_request_id uuid, p_store_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_address text;
  v_client uuid;
  v_professional uuid;
  v_conversation uuid;
BEGIN
  IF auth.uid() IS NULL OR p_request_id IS NULL OR p_store_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT public.is_store_owner(p_store_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.request_target_stores rts
    WHERE rts.request_id = p_request_id
      AND rts.store_id = p_store_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT
    nullif(btrim(mr.client_address), ''),
    mr.client_id,
    mr.professional_id,
    mr.conversation_id
    INTO v_address, v_client, v_professional, v_conversation
  FROM public.material_requests mr
  WHERE mr.id = p_request_id;

  -- Pedidos viejos pueden no tener la calle copiada (solo se guardaba con trabajo pagado).
  -- Se lee el domicilio del cliente del chat, nunca el del profesional.
  IF v_address IS NULL AND v_conversation IS NOT NULL THEN
    SELECT nullif(btrim(p.direccion_texto), '')
      INTO v_address
    FROM public.conversations c
    JOIN public.profiles p ON p.id = c.cliente_id
    WHERE c.id = v_conversation
      AND c.deleted_at IS NULL
      AND c.cliente_id IS NOT NULL
      AND (v_professional IS NULL OR c.cliente_id IS DISTINCT FROM v_professional);
  END IF;

  IF v_address IS NULL
     AND v_client IS NOT NULL
     AND (v_professional IS NULL OR v_client IS DISTINCT FROM v_professional) THEN
    SELECT nullif(btrim(p.direccion_texto), '')
      INTO v_address
    FROM public.profiles p
    WHERE p.id = v_client;
  END IF;

  RETURN v_address;
END;
$function$;

COMMENT ON FUNCTION public.get_store_request_client_address(uuid, uuid) IS
  'Calle de entrega para el dueño del comercio destinatario, para cotizar el flete. No devuelve coordenadas. No exige orden pagada.';

REVOKE ALL ON FUNCTION public.get_store_request_client_address(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_request_client_address(uuid, uuid) TO authenticated, service_role;

COMMIT;
