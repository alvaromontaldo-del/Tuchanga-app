# Contrataciones — flujo de trabajo y pagos (YaChanga)

Documento de referencia para Fase 1 (Supabase). La app RN se adapta en fases posteriores.

## Tabla principal: `contrataciones`

Renombrada desde `service_jobs`. Una fila nace cuando el trabajador envía el **primer precio** (`estado_trabajo = precio_cotizado`).

### Cardinalidad

- **Una contratación activa por conversación** (`estado_trabajo` ∉ `finalizado`, `cancelado`, `disputa`).
- Tras `cancelado` o `disputa`, una nueva cotización crea **nueva fila** (no resetea la anterior).

### Dinero (costo de servicio por tramos, guardado al cotizar)

El monto del profesional es `precio_trabajador`. El costo de servicio es marginal:

- $0–$50.000: 10%
- $50.000–$200.000: 6% sobre ese tramo
- $200.000–$500.000: 3% sobre ese tramo
- por encima de $500.000: tope fijo $23.000
- piso $5.000

```
comision_app   = calc_yachanga_service_fee(ceil(precio_trabajador))
precio_final   = precio_trabajador + comision_app
```

La función autoritativa es `public.calc_yachanga_service_fee`, llamada desde `calc_precios_contratacion`. `crear_cotizacion` y `recotizar_en_curso` guardan `comision_app` y `precio_final` en la fila. Una contratación ya creada no se recalcula sola.

El costo de servicio de materiales es otra función (`calculate_material_service_fee`) y no usa estos tramos.

**Recotización con costo de servicio ya pagado (`recotizar_en_curso`, opción A).** Si la contratación tiene la seña acreditada (`seña_pagada` / `totalmente_pagado`, o transacciones MP aprobadas de `seña_inicial`/`diferencia_seña`), `comision_app` queda en lo ya pagado: no baja (#39) y tampoco sube. `precio_final = neto + esa comisión`. El cliente no paga ningún costo adicional. `aceptar_recotizacion` no cambia `estado_pago` y nunca vuelve a `pendiente_seña`.

- `precio_trabajador`: neto en mano del prestador (privado en UI del trabajador).
- `comision_app`: seña inicial (MercadoPago) o base de la diferencia en recotización mayor.
- `precio_final`: visible para ambos. Incluye el costo de servicio.

### Enums

**`estado_trabajo`:** `pendiente`, `precio_cotizado`, `precio_aceptado`, `aceptado`, `en_curso`, `pendiente_pago_diferencia`, `finalizado`, `cancelado`, `disputa`

**`estado_pago`:** `pendiente_seña`, `seña_pagada`, `totalmente_pagado`

### Seguridad PIN

- Columna `verification_pin` **no** está en GRANT SELECT de `authenticated`.
- Cliente: RPC `obtener_pin_cliente(contratacion_id)`.
- Trabajador: RPC `verificar_pin(contratacion_id, pin_ingresado)` → pasa a `en_curso` si OK.
- Auditoría: tabla `pin_intentos`. Máx. **5 fallos** → bloqueo **15 min** (`pin_bloqueado_hasta`).

### Dirección del cliente

- RPC `obtener_direccion_cliente(contratacion_id)` solo si `estado_pago >= seña_pagada` y agenda aceptada (`fecha_trabajo` not null).
- Devuelve `direccion_texto` + coordenadas.

### Chat

- Cotización nueva → mensaje `messages.type = 'quotation'` con `metadata.contratacion_id`.
- Link “Ver servicio” en app: visible tras **agenda aceptada** (`precio_aceptado` + fechas + paso a pendiente de seña).

### Pagos MercadoPago

- Tabla `transacciones_pago` (auditoría).
- Edge Functions: `mp_crear_preferencia` (checkout) + `mp_webhook` (notificaciones). Ver `PAGOS_MERCADOPAGO.md`.
- Webhook: `external_reference = contratacion_id:{uuid}|tipo_pago:{seña_inicial|diferencia_seña}`.
- App: WebView + deep link `tuchanga-app://pagos/retorno`.
- Sin credenciales MP: `EXPO_PUBLIC_MP_ENABLED` off → botón “Próximamente”.
- Seña $0 si `saldo_credito` cubre 100% de `comision_app`: RPC `aplicar_seña_con_credito`.

### Crédito (cliente)

- `profiles.saldo_credito` (default 0).
- Rechazo recotización (fase UI): **90%** de `comision_app` acreditado (RPC preparado).

### RPCs principales (MVP)

| RPC | Actor | Descripción |
|-----|-------|-------------|
| `crear_cotizacion` | Trabajador | Precio neto + detalle; crea fila + mensaje quotation |
| `aceptar_precio_cotizado` | Cliente | → `precio_aceptado` |
| `rechazar_precio_cotizado` | Cliente | → `cancelado` |
| `proponer_disponibilidad` | Trabajador | Fecha/horas |
| `aceptar_disponibilidad` | Cliente | Calcula comisión; listo para seña |
| `rechazar_disponibilidad` | Cliente | → `precio_aceptado` (re-agendar) |
| `aplicar_seña_con_credito` | Cliente | Seña sin MP si crédito alcanza |
| `registrar_seña_aprobada` | service_role | Webhook MP |
| `obtener_pin_cliente` | Cliente | PIN post-seña |
| `verificar_pin` | Trabajador | → `en_curso` |
| `obtener_direccion_cliente` | Trabajador | Post-seña |
| `recotizar_en_curso` | Trabajador | (#4) Monto nuevo + fundamentos, con PIN validado. Queda pendiente del cliente; una sola a la vez. La comisión queda en lo ya pagado |
| `aceptar_recotizacion` | Cliente | Aplica el monto del profesional y la comisión ya pagada. No cobra diferencia y no pasa a `pendiente_seña` |
| `rechazar_recotizacion` | Cliente | (#4) Sigue el monto original y el trabajo vuelve a `en_curso`. Ya no finaliza ni acredita crédito |
| `cliente_notificar_pago_offline` | Cliente | Conciliación |
| `trabajador_confirmar_recepcion_offline` | Trabajador | → `totalmente_pagado` |
| `trabajador_finalizar_trabajo` | Trabajador | Pide conformidad |
| `cliente_responder_conformidad` | Cliente | Sí → `finalizado`; No → `disputa` |

### Migración legacy

- Filas existentes de `service_jobs` + datos de `chat_quotes` → `finalizado` / `totalmente_pagado`.
- `chat_quotes` eliminada tras data migration en la misma transacción.
- Mensajes históricos `quotation` generados por cada cotización migrada.

### Realtime

- `contrataciones` en publication `supabase_realtime` (Agenda + Detalle).
