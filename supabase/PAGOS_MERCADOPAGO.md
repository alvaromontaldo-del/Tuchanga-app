# MercadoPago — Fase 2 (Edge Functions + app)

## Arquitectura

| Componente | Rol |
|------------|-----|
| `mp_crear_preferencia` | Cliente autenticado → Checkout Pro preference + fila `transacciones_pago` pending |
| `mp_confirmar_sena` | *(opcional)* Backup manual vía API; la app ya no lo invoca |
| `mp_webhook` | **Fuente de verdad** — notificaciones MP → SDK `payment.get` → RPC `registrar_seña_aprobada` |
| App RN | WebView checkout + Realtime en `contrataciones` (sin botón «Ya pagué») |

### external_reference

```
contratacion_id:{uuid}|tipo_pago:{seña_inicial|diferencia_seña}
```

## Secrets (Supabase → Project Settings → Edge Functions)

| Secret | Descripción |
|--------|-------------|
| `MP_ACCESS_TOKEN` | Access token de producción o test (Mercado Pago Developers) |
| `MP_SANDBOX` | *(opcional)* `1` en pruebas, `0` en producción (recomendado) |
| `MP_TEST_BUYER_EMAIL` | *(opcional, sandbox)* Email del comprador de prueba (`test_user_…@testuser.com`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (también acepta `SERVICE_ROLE_KEY`) |
| `SUPABASE_ANON_KEY` | Anon key (validar JWT en `mp_crear_preferencia`) |
| `MP_NOTIFICATION_URL` | *(opcional)* URL pública del webhook si difiere de la default |
| `MP_WEBHOOK_SECRET` | *(opcional)* Clave de firma de webhooks (Mercado Pago → Webhooks) |
| `MP_APP_RETURN_SCHEME` | *(opcional)* Default: `tuchanga-app` |

## Deploy

```bash
cd tuchanga-app
supabase functions deploy mp_crear_preferencia
supabase functions deploy mp_confirmar_sena
supabase functions deploy mp_webhook --no-verify-jwt
```

Webhook URL (default):

```
https://<PROJECT_REF>.supabase.co/functions/v1/mp_webhook
```

Registrar en Mercado Pago → Tu integración → Webhooks → eventos **Payments**.

## App (.env)

```env
EXPO_PUBLIC_MP_ENABLED=1
EXPO_PUBLIC_APP_SCHEME=tuchanga-app
```

Sin `EXPO_PUBLIC_MP_ENABLED=1` la UI muestra **MercadoPago · Próximamente** aunque el backend esté listo.

## Flujo

1. Cliente en `DetalleServicioScreen` → **Pagar con MercadoPago**
2. Edge Function crea preference (monto = `comision_app` o diferencia recotización)
3. App abre `PagoCheckoutScreen` (WebView)
4. MP notifica `mp_webhook` → acredita seña en `contrataciones` (`estado_pago = seña_pagada` + PIN)
5. App escucha Realtime en `contrataciones` y muestra confirmación sin intervención del usuario

## Pruebas sandbox

1. Credenciales de **cuenta de prueba** en [Mercado Pago Developers](https://www.mercadopago.com.ar/developers)
2. `MP_ACCESS_TOKEN` = Access Token de **Credenciales de prueba** (`APP_USR-...`)
3. En el checkout WebView:
   - **No** iniciés sesión con tu Mercado Pago real (celular/email personal)
   - Pagá **como invitado** con tarjeta de prueba (sin tocar Ingresar)
   - Tarjeta: `4509 9535 6623 3704` · CVV `123` · titular **`APRO`** · DNI `12345678` · **1 cuota**
   - Opcional: secret `MP_TEST_BUYER_EMAIL` = email del comprador de prueba (Developers → Cuentas de prueba)
4. **Dinero en cuenta** solo si entrás con el **comprador de prueba** (no tu cuenta real)
5. Error *「Una de las partes… es de prueba」* = mezclaste cuenta real + sandbox, o la app MP del celular tomó sesión real. Pagá sin login.
6. Si tenés la **app Mercado Pago** instalada, puede abrir tu cuenta real: cerrá sesión en el checkout o probá sin ingresar.

Tras cambiar código MP, redeploy:

```bash
npx supabase functions deploy mp_crear_preferencia
```

## Troubleshooting

| Síntoma | Causa probable |
|---------|----------------|
| `mp_not_configured` | Falta `MP_ACCESS_TOKEN` en secrets |
| Botón deshabilitado “Próximamente” | Falta `EXPO_PUBLIC_MP_ENABLED=1` en `.env` |
| Seña no se acredita | Webhook no configurado o pago aún `pending` |
| `monto_cero_usar_credito` | Usar botón “Usar crédito” |
