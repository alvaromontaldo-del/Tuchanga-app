# Contrataciones — flujo de trabajo y pagos (YaChanga)

Documento de referencia para Fase 1 (Supabase). La app RN se adapta en fases posteriores.

## Tabla principal: `contrataciones`

Renombrada desde `service_jobs`. Una fila nace cuando el trabajador envía el **primer precio** (`estado_trabajo = precio_cotizado`).

### Cardinalidad

- **Una contratación activa por conversación** (`estado_trabajo` ∉ `finalizado`, `cancelado`, `disputa`).
- Tras `cancelado` o `disputa`, una nueva cotización crea **nueva fila** (no resetea la anterior).

### Dinero (comisión 22% sobre precio final)

```
precio_final   = round(precio_trabajador / (1 - 0.22), 2)
comision_app   = precio_final - precio_trabajador
```

- `precio_trabajador`: neto en mano del prestador (privado en UI del trabajador).
- `comision_app`: seña inicial (MercadoPago) o diferencia en recotización mayor.
- `precio_final`: visible para ambos.

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
| `recotizar_en_curso` | Trabajador | Nueva neto; A/B/C según diferencia |
| `aceptar_recotizacion` | Cliente | |
| `rechazar_recotizacion` | Cliente | → `finalizado` + crédito 90% |
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
