-- YaChanga — Repair board: Confirmadas vs Cotizadas post fee-paid.
--
-- Alinea datos inconsistentes tras accept_only_on_service_fee_paid:
-- - Orden pagada pero quote aún `sent` → quote `accepted`
-- - contact_revealed / deposit incoherente → deposit_paid + paid
-- - quote `accepted` sin pago real → vuelve a `sent` (Cotizadas)
-- - request `accepted` solo con fee pendiente → `quoted`

-- 1) Señal de revelación / fee pagado a medias → normalizar orden.
UPDATE public.orders o
SET
  deposit_status = 'paid',
  status = CASE
    WHEN o.status = 'completed' THEN 'completed'
    ELSE 'deposit_paid'
  END,
  contact_revealed_at = coalesce(o.contact_revealed_at, now()),
  updated_at = now()
WHERE (
    o.contact_revealed_at IS NOT NULL
    OR o.deposit_status = 'paid'
    OR o.status = 'deposit_paid'
  )
  AND o.status IS DISTINCT FROM 'completed'
  AND (
    o.deposit_status IS DISTINCT FROM 'paid'
    OR o.status IS DISTINCT FROM 'deposit_paid'
  );

-- 2) Orden ya pagada → quote debe ser accepted (Confirmadas).
UPDATE public.quotes q
SET status = 'accepted', updated_at = now()
FROM public.orders o
WHERE o.quote_id = q.id
  AND (
    o.deposit_status IN ('paid', 'waived')
    OR o.status IN ('deposit_paid', 'completed')
    OR o.contact_revealed_at IS NOT NULL
  )
  AND q.status IS DISTINCT FROM 'accepted'
  AND q.status IS DISTINCT FROM 'rejected';

-- 3) accepted sin pago real → sent (Cotizadas / esperando fee).
UPDATE public.quotes q
SET status = 'sent', updated_at = now()
WHERE q.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.quote_id = q.id
      AND (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
  );

-- 4) Pedido marcado accepted sin ninguna orden pagada → quoted.
UPDATE public.material_requests mr
SET status = 'quoted', updated_at = now()
WHERE mr.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM public.quotes q
    JOIN public.orders o ON o.quote_id = q.id
    WHERE q.request_id = mr.id
      AND (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
  );

-- 5) Pedido con fee pagado debe quedar accepted (si no completed).
UPDATE public.material_requests mr
SET status = 'accepted', updated_at = now()
WHERE mr.status IN ('quoted', 'sent', 'pending')
  AND EXISTS (
    SELECT 1
    FROM public.quotes q
    JOIN public.orders o ON o.quote_id = q.id
    WHERE q.request_id = mr.id
      AND (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
  );
