-- #54 Incluye garantía (1 a 60 días)
--
-- Aplicar en el SQL Editor de Supabase (proyecto TuChangaAPP) si esta
-- migración todavía no corrió. Es idempotente.
--
-- Qué hace
-- 1. Asegura las columnas warranty_days y warranty_anchor_at en public.contrataciones.
--    En producción ya existen; este paso cubre una base creada solo con las
--    migraciones del repo.
-- 2. Limita warranty_days a NULL (sin garantía) o un entero de 1 a 60.
--    El check anterior en producción permitía hasta 365.
-- 3. Reemplaza public.crear_cotizacion(..., p_warranty_days) para rechazar
--    días fuera de 1–60. NULL o un valor <= 0 se guarda como sin garantía.
--    Se elimina la sobrecarga vieja de 3 argumentos para que PostgREST no
--    quede ambiguo.
-- 4. Asegura el trigger que fija warranty_anchor_at la primera vez que
--    estado_trabajo pasa a finalizado. La app descuenta días corridos de 24 h
--    desde esa fecha. El ancla no se vuelve a escribir, así que un reclamo
--    posterior no reinicia la garantía.
--
-- No hace falta tocar filas existentes: las garantías guardadas están en 30 días.

ALTER TABLE public.contrataciones
  ADD COLUMN IF NOT EXISTS warranty_days integer,
  ADD COLUMN IF NOT EXISTS warranty_anchor_at timestamptz;

ALTER TABLE public.contrataciones
  DROP CONSTRAINT IF EXISTS contrataciones_warranty_days_check;

ALTER TABLE public.contrataciones
  ADD CONSTRAINT contrataciones_warranty_days_check
  CHECK (warranty_days IS NULL OR (warranty_days >= 1 AND warranty_days <= 60));

COMMENT ON COLUMN public.contrataciones.warranty_days IS
  'Días de garantía ofrecidos en la cotización. NULL = sin garantía. Rango 1–60.';

COMMENT ON COLUMN public.contrataciones.warranty_anchor_at IS
  'Inicio de la garantía: primer momento en que el trabajo pasó a finalizado. No se reinicia.';

GRANT SELECT (warranty_days, warranty_anchor_at) ON TABLE public.contrataciones TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_contratacion_set_warranty_anchor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado_trabajo = 'finalizado'
     AND (TG_OP = 'INSERT' OR OLD.estado_trabajo IS DISTINCT FROM 'finalizado') THEN
    IF NEW.warranty_anchor_at IS NULL THEN
      NEW.warranty_anchor_at := coalesce(NEW.finalizado_at, NEW.completed_by_worker_at, now());
    END IF;
    IF NEW.finalizado_at IS NULL THEN
      NEW.finalizado_at := NEW.warranty_anchor_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contratacion_set_warranty_anchor ON public.contrataciones;

CREATE TRIGGER trg_contratacion_set_warranty_anchor
  BEFORE INSERT OR UPDATE OF estado_trabajo, finalizado_at, completed_by_worker_at
  ON public.contrataciones
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_contratacion_set_warranty_anchor();

DROP FUNCTION IF EXISTS public.crear_cotizacion(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.crear_cotizacion(
  p_conversation_id uuid,
  p_precio_trabajador numeric,
  p_service_detail text DEFAULT '',
  p_warranty_days integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv public.conversations%rowtype;
  v_precios record;
  v_id uuid;
  v_detail text;
  v_neto numeric;
  v_warranty_days integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversación inexistente';
  END IF;

  IF v_conv.trabajador_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede cotizar';
  END IF;

  v_detail := coalesce(trim(p_service_detail), '');
  IF v_detail = '' THEN
    RAISE EXCEPTION 'El detalle del servicio es obligatorio';
  END IF;

  IF p_warranty_days IS NULL OR p_warranty_days <= 0 THEN
    v_warranty_days := NULL;
  ELSIF p_warranty_days > 60 THEN
    RAISE EXCEPTION 'Los días de garantía deben ser entre 1 y 60';
  ELSE
    v_warranty_days := p_warranty_days;
  END IF;

  PERFORM public._assert_sin_contratacion_activa(p_conversation_id);

  v_neto := ceil(p_precio_trabajador);
  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);

  INSERT INTO public.contrataciones (
    conversation_id,
    worker_id,
    client_id,
    precio_trabajador,
    precio_final,
    comision_app,
    service_detail,
    estado_trabajo,
    estado_pago,
    warranty_days
  )
  VALUES (
    p_conversation_id,
    v_conv.trabajador_id,
    v_conv.cliente_id,
    v_neto,
    v_precios.precio_final,
    v_precios.comision_app,
    v_detail,
    'precio_cotizado',
    'pendiente_seña',
    v_warranty_days
  )
  RETURNING id INTO v_id;

  INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
  VALUES (
    p_conversation_id,
    auth.uid(),
    v_detail,
    'quotation',
    jsonb_build_object(
      'contratacion_id', v_id,
      'precio_final', v_precios.precio_final,
      'precio_trabajador', v_neto,
      'service_detail', v_detail,
      'warranty_days', v_warranty_days
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) TO authenticated, service_role;
