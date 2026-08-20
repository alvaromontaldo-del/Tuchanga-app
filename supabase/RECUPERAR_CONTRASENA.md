# Recuperación de contraseña — Supabase + YaChanga

Configuración obligatoria en el dashboard para que el **código OTP** y el **enlace** funcionen en celular y PC.

## 0. Límite de emails (SMTP integrado de Supabase)

El SMTP **incluido** de Supabase permite muy pocos envíos (**~3–4 emails por hora por proyecto**). Si estuvieron probando recuperación de contraseña, registro, etc., aparece:

`429 — over_email_send_rate_limit — email rate limit exceeded`

**No es un bug de la app.** Opciones:

1. **Esperar ~1 hora** (se reinicia el cupo horario).
2. **Configurar SMTP propio** (recomendado): menú izquierdo **Authentication** → **Emails** → bajar hasta **SMTP Settings** → activar **Enable Custom SMTP** (Resend, SendGrid, etc.). Enlace directo: [Authentication → Emails](https://supabase.com/dashboard/project/kyxehrxcdealbujvvnxp/auth/emails).
3. Tras guardar SMTP, subir el límite en **Authentication → Rate Limits** → *Rate limit for sending emails*. Enlace: [Rate Limits](https://supabase.com/dashboard/project/kyxehrxcdealbujvvnxp/auth/rate-limits).

## 1. URL configuration (corrige el link roto)

En **Authentication → URL configuration**:

| Campo | Valor recomendado |
|-------|-------------------|
| **Site URL** | `tuchanga-app://reset-password` |
| **Redirect URLs** (añadir todas) | `tuchanga-app://reset-password` |
| | `tuchanga-app://**` |
| | `exp+tuchanga-app://reset-password` |
| | `exp+tuchanga-app://**` |

> **No uses `http://localhost:3000`** como Site URL en producción ni en pruebas desde el celular: el navegador intenta abrir tu PC y falla con `ERR_CONNECTION_REFUSED`.

Opcional en `.env` de la app:

```env
EXPO_PUBLIC_AUTH_REDIRECT_URL=tuchanga-app://reset-password
```

## 2. Plantilla de email con marca YaChanga

1. Subí el logo horizontal a **Storage** → bucket público `brand` (o el que uses):
   - Archivo local: `assets/brand/logo-yachanga-v22_bold_tracking1.png`
   - Ruta sugerida: `brand/logo-yachanga-horizontal.png`
2. Copiá la URL pública (ej. `https://TU_REF.supabase.co/storage/v1/object/public/brand/logo-yachanga-horizontal.png`).
3. Abrí `supabase/email-templates/recovery-password.html`, reemplazá `LOGO_URL` por esa URL.
4. En **Authentication → Email Templates → Reset password**:
   - **Subject:** `Recuperá tu contraseña — YaChanga`
   - **Body:** pegá el HTML editado (modo código fuente / HTML si el editor lo permite).

La plantilla incluye:

- Logo YaChanga
- Saludo del equipo
- **Código OTP** (`{{ .Token }}`) para ingresar en la app
- **Sin botón/enlace directo** (`{{ .ConfirmationURL }}`): Gmail/Outlook/antivirus suelen abrir el enlace solos y **invalidan el código** antes de que el usuario lo use (ver [email prefetching](https://supabase.com/docs/guides/auth/auth-email-templates#email-prefetching)).

## 3. Migración SQL — validar email registrado

Ejecutá en SQL Editor (o `supabase db push`):

`supabase/migrations/20260529120000_auth_email_is_registered.sql`

Crea la función `auth_email_is_registered` usada por la app antes de enviar el código.

## 4. Deep link en builds nativas

La app declara el esquema `tuchanga-app` en `app.json`. Tras cambiarlo hace falta **nueva build EAS** (OTA no alcanza para el esquema).

Flujo al tocar el enlace del mail:

1. Se abre la app con `tuchanga-app://reset-password#access_token=...`
2. La app establece sesión de recuperación
3. Navega a **Nueva contraseña** (sin pedir OTP otra vez)

## 5. Checklist de prueba

- [ ] Email inexistente → mensaje “No existe una cuenta registrada…”
- [ ] Email válido → llega mail con código y botón
- [ ] Código en app → restablece contraseña
- [ ] Enlace desde celular → abre app y pantalla nueva contraseña
- [ ] Site URL ya no apunta a `localhost:3000`
