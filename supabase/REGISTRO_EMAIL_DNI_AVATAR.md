# Registro YaChanga — email, DNI único y avatares

## 1. Plantilla Confirm signup

1. Abrí `supabase/email-templates/confirm-signup.html`.
2. En Supabase → **Authentication → Email Templates → Confirm signup**:
   - **Subject:** `Confirmá tu cuenta — YaChanga`
   - **Body:** pegá el HTML (modo código fuente).
3. El logo apunta a:
   `https://kyxehrxcdealbujvvnxp.supabase.co/storage/v1/object/public/Yachanga/logo-yachanga-v22_bold_tracking1.png`
   (mismo del mail de recuperación).
   La plantilla también muestra el texto **YaChanga** por si el cliente de correo bloquea la imagen
   (Gmail a veces falla con URLs de Storage que setean cookies de Cloudflare).
   Si la imagen sigue rota: subí el PNG a un host estático sin cookies (ImgBB, Cloudinary, etc.)
   y reemplazá el `src` del `<img>` en la plantilla.

Colores: primario `#C62828`, fondo `#EBEBEB`, CTA **Validar cuenta** → `{{ .ConfirmationURL }}`.

## 2. DNI / email únicos — SQL

Antes de crear el índice UNIQUE, mirá duplicados:

```sql
SELECT dni, count(*) FROM public.profiles
GROUP BY dni HAVING count(*) > 1;
```

Si hay filas, unificá o corregí a mano. Después ejecutá en orden:

1. `supabase/migrations/20260721180000_profiles_dni_unique.sql`
2. `supabase/migrations/20260721181000_avatars_storage_rls_and_set_url.sql`
3. `supabase/migrations/20260721190000_profile_phone_is_registered.sql` (celular duplicado)

(La migración de email `auth_email_is_registered` ya debería estar; si no, también `20260529120000_auth_email_is_registered.sql`.)

La app, al registrar:

- Pre-chequea email, DNI y celular.
- Muestra toast + error en el campo: *«No se pudo crear la cuenta: este correo/DNI/celular ya está registrado.»*

## 3. Avatares

- Upload con `Uint8Array` desde la URI local (Expo File / fetch).
- Path: `{auth.uid()}/avatar-….jpg` (compatible con RLS).
- Persistencia: RPC `set_my_avatar_url` → `profiles.avatar_url`.

Tras el SQL de Storage, reiniciá la app (OTA) y volvé a subir la foto en **Mis datos** si algún usuario quedó sin avatar.
