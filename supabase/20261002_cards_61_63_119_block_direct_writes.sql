-- Cards #61 / #63 (reabiertas en la re-auditoría 2026-10-02) y #119
-- (escribir directo en las tablas saltea reglas). Proyecto TuChangaAPP.
--
-- #61/#63: el cliente, el profesional o el comercio podían hacer UPDATE/INSERT directo
-- en public.orders (contact_revealed_at, deposit_status, status, verification_pin) y
-- las funciones de reveal lo tomaban como pagado. Ahora la tabla orders solo la escriben
-- funciones del servidor: accept_material_quote / create_material_checkout (crean la orden
-- en 'pending'), _mark_material_order_fee_paid (solo desde registrar_sena_material_aprobada,
-- que llama la edge function de Mercado Pago con service_role), reject_material_quote y
-- completar_orden_material_con_pin. La app no escribe orders directo (solo un fallback
-- viejo para cuando no existía accept_material_quote).
--
-- #119: comercio que se auto-aprueba, cliente que edita cotizaciones y la policy de
-- reseñas que comparaba c.worker_id = c.worker_id.
-- Ninguna función existente se recrea en este archivo.

-- ===================== #61 / #63: orders =====================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM anon, authenticated;
DROP POLICY IF EXISTS orders_insert ON public.orders;
DROP POLICY IF EXISTS orders_update ON public.orders;

-- Defensa extra: aunque alguien vuelva a dar permisos, un usuario de la app no puede
-- escribir orders directo. Las funciones SECURITY DEFINER corren como postgres y pasan.
CREATE OR REPLACE FUNCTION public.orders_block_direct_client_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'orders_direct_write_forbidden' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.orders_block_direct_client_writes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_block_direct_client_writes ON public.orders;
CREATE TRIGGER trg_orders_block_direct_client_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_block_direct_client_writes();

-- ===================== #119.1: stores =====================
-- El dueño sigue pudiendo crear y editar su comercio (nombre, teléfono, dirección,
-- ubicación, horarios, foto), pero no el estado ni la aprobación: eso solo el admin
-- (admin_* RPC) o el servidor.
CREATE OR REPLACE FUNCTION public.stores_protect_admin_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending_approval';
    NEW.trial_ends_at := NULL;
    NEW.approved_at := NULL;
    NEW.approved_by := NULL;
    NEW.rejection_reason := '';
  ELSE
    NEW.user_id := OLD.user_id;
    NEW.status := OLD.status;
    NEW.trial_ends_at := OLD.trial_ends_at;
    NEW.approved_at := OLD.approved_at;
    NEW.approved_by := OLD.approved_by;
    NEW.rejection_reason := OLD.rejection_reason;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.stores_protect_admin_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stores_protect_admin_fields ON public.stores;
CREATE TRIGGER trg_stores_protect_admin_fields
  BEFORE INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.stores_protect_admin_fields();

-- ===================== #119.2: quotes =====================
-- Nadie actualiza cotizaciones directo: aceptar/rechazar va por accept_material_quote,
-- create_material_checkout y reject_material_quote (SECURITY DEFINER). El comercio
-- solo puede crear su cotización en estado 'sent'.
REVOKE UPDATE ON public.quotes FROM anon, authenticated;
DROP POLICY IF EXISTS quotes_update ON public.quotes;
ALTER POLICY quotes_insert_store ON public.quotes
  WITH CHECK (
    is_store_owner(store_id)
    AND store_is_request_target(request_id, store_id)
    AND store_can_see_request(request_id)
    AND status = 'sent'
  );

-- ===================== #119.3: worker_reviews =====================
ALTER POLICY worker_reviews_insert_client ON public.worker_reviews
  WITH CHECK (
    client_id = auth.uid()
    AND job_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.contrataciones c
      WHERE c.id = worker_reviews.job_id
        AND c.client_id = auth.uid()
        AND c.worker_id = worker_reviews.worker_id
        AND c.estado_trabajo = 'finalizado'::contratacion_estado_trabajo
        AND (c.conversation_id IS NULL OR worker_reviews.conversation_id = c.conversation_id)
    )
  );
