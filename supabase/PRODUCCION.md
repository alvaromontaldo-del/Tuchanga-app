# Supabase en producción — Tu Changa

Guía para dejar el proyecto remoto alineado con el código de `tuchanga-app`.

## 1. Requisitos previos

- Proyecto creado en [Supabase Dashboard](https://supabase.com/dashboard) (región cercana a tus usuarios).
- **PostGIS**: en *Database → Extensions* activá `postgis` (la migración `001` también hace `CREATE EXTENSION IF NOT EXISTS postgis`).
- En la app: `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` apuntando a **ese** proyecto (ver `.env.example`).

## 2. Orden de migraciones

Aplicá los archivos en este orden (el CLI de Supabase los ejecuta por nombre de archivo):

| Orden | Archivo |
|------|---------|
| 1 | `001_initial_schema.sql` |
| 2 | `002_update_profile_geo_coverage.sql` |
| 3 | `20260410120000_chat_conversations.sql` |
| 4 | `20260410200000_search_workers_rpc.sql` |
| 5 | `20260413190000_profile_bio.sql` |
| 6 | `20260413203000_update_profile_registration.sql` |
| 7 | `20260414120000_storage_job_photos_update.sql` |

### Cómo aplicarlas

**Opción A — Supabase CLI** (recomendado si tenés el repo linkeado):

```bash
cd tuchanga-app
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

**Opción B — SQL Editor** en el dashboard: abrí *SQL → New query*, pegá el contenido de cada archivo **en el orden de la tabla** y ejecutá. Si algo falla por “ya existe”, revisá el mensaje: muchas migraciones usan `IF NOT EXISTS` / `DROP IF EXISTS` para ser idempotentes en parte.

> **Proyecto que ya tiene datos:** antes hacé backup (*Settings → Database → Backups*) o probá primero en un proyecto staging.

## 3. RLS (resumen)

Con las migraciones queda así la intención de seguridad:

| Tabla | Rol `authenticated` |
|-------|---------------------|
| `profiles` | `SELECT` todos los perfiles (búsqueda/listados). `INSERT` solo fila con `id = auth.uid()`. `UPDATE` solo la fila propia. |
| `jobs` | `SELECT` todos. `INSERT/UPDATE/DELETE` solo filas con `user_id = auth.uid()`. |
| `conversations` | `SELECT` si sos `cliente_id` o `trabajador_id`. `INSERT` solo como cliente (`cliente_id = auth.uid()`). |
| `messages` | `SELECT/INSERT` solo si participás de la conversación (vía join a `conversations`). |

Los **RPC `SECURITY DEFINER`** (`insert_profile_with_location`, `update_profile_registration`, `update_profile_geo_coverage`, `find_or_create_conversation`, `search_workers_for_client`) ejecutan con privilegios del owner pero siguen usando `auth.uid()` dentro del SQL para acotar efectos.

**Nota:** `search_workers_for_client` tiene `GRANT EXECUTE` a **`anon`** además de `authenticated`: cualquiera con la anon key puede listar trabajadores que cumplan filtros (diseño típico de “búsqueda pública”). Si en producción querés solo usuarios logueados, quitá el `GRANT ... TO anon` en una migración nueva y asegurate de que la app siempre envíe JWT en esa llamada.

## 4. Storage: buckets `avatars` y `job-photos`

Definidos en `001` como **públicos** (`public = true`):

- **`avatars`**: lectura pública; escritura solo en carpeta cuyo **primer segmento del path** sea el UUID del usuario (`{userId}/...`), vía políticas `avatars_insert_own` / `avatars_update_own`.
- **`job-photos`**: igual patrón para subida; lectura pública. La migración `20260414120000_storage_job_photos_update.sql` agrega **`UPDATE`** para la misma carpeta, necesaria porque la app sube con **`upsert: true`** (segunda subida al mismo path = actualizar objeto).

Verificá en *Storage* que existan los buckets `avatars` y `job-photos`. Si creaste el proyecto a mano sin correr `001`, creálos como públicos o volvé a ejecutar la sección Storage de `001`.

## 5. Confirmación de email (“Confirm email”)

Supabase → **Authentication → Providers → Email**:

| Objetivo | Configuración sugerida |
|----------|-------------------------|
| **Producción seria** | Dejá **Confirm email** activado. Los usuarios deben abrir el enlace del mail antes de tener sesión completa. La app ya guarda el formulario en pendiente y aplica el perfil al primer login (`pendingProfileSignup` + `tryApplyPendingProfileSignup`). |
| **Solo desarrollo / demos** | Podés desactivar **Confirm email** para registrar y entrar en un paso (menos fricción, peor higiene). |

Revisá también:

- **Authentication → URL configuration**: *Site URL* y *Redirect URLs* acordes a tu app (Expo: esquemas `exp://`, `tuapp://`, y URLs web si usás web).
- Plantillas de email en *Authentication → Email templates* si querés marca y textos en español.

## 6. Checklist post-despliegue

- [ ] `auth.users` crea usuario y, tras registro con sesión o primer login, existe fila en `public.profiles`.
- [ ] Subida de avatar y fotos de oficios sin error 403/RLS en Storage.
- [ ] Búsqueda de trabajadores (si usás anon en el RPC) o login obligatorio según lo que hayas elegido.
- [ ] Chat: crear conversación y enviar mensaje entre dos usuarios de prueba.
- [ ] *Database → Publications*: `supabase_realtime` incluye `public.messages` (lo agrega `001`; si falló al ejecutar, repetí solo esa línea o habilitá la tabla en Realtime desde el dashboard).

## 7. Salud y límites

- Proyecto **no pausado** (plan free se pausa por inactividad).
- Límites de **rate** de Auth y de **Nominatim** en el cliente (la app geocodifica desde el dispositivo; en producción masiva conviene proxy propio o proveedor pag).

---

Si cambiás políticas o RPCs a mano en el dashboard, documentá el diff o agregá una migración nueva en `migrations/` para que el repo siga siendo la fuente de verdad.
