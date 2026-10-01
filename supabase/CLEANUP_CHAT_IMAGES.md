# Cierre de chat + purga de imágenes

## Cuándo se activa

Cuando **ambas** condiciones se cumplen:

1. El **cliente** deja la reseña (`worker_reviews`)
2. El **trabajador** confirma la recepción del pago (`estado_pago = totalmente_pagado`)

Hoy la espera es **0 días** (inmediato).  
Para pasar a 15 días más adelante, cambiá en SQL:

```sql
CREATE OR REPLACE FUNCTION public.chat_cleanup_retention_days()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 15; $$;
```

## Qué hace

| Acción | Detalle |
|--------|---------|
| Chat | Se **oculta** para cliente y trabajador (`conversation_hides`). **No** se borra de BD. |
| Imágenes | Se borran de Storage (`job-photos`) y las filas `messages` con `type = image`. |

## SQL a ejecutar

1. `20260803160000_chat_image_messages.sql` (si no está)
2. `20260803180000_purge_chat_images_after_finalizado.sql` (helpers base)
3. **`20260803190000_chat_cleanup_on_review_and_pago.sql`** ← criterio reseña+pago, hide, retención 0

## Edge Function

```bash
npx supabase functions deploy cleanup_chat_images --no-verify-jwt
```

Hace falta el secret `EDGE_FUNCTION_SECRET` (o el alias `CLEANUP_CRON_SECRET`). Sin secreto la función responde 503. Un Bearer anónimo, la anon key o la service role sola responden 401.

La app intenta invocarla al dejar reseña / confirmar pago. Ese invoke solo pasa si el cliente manda `x-function-secret` (no lo pongas en `EXPO_PUBLIC_*`). El camino de producción es el cron y los triggers de `supabase/20261001_edge_function_secret_headers.sql` (no está aplicado solo: hay que correrlo en el SQL editor).

## Schedule (respaldo)

Dashboard → Edge Functions → `cleanup_chat_images` → Schedules  
Cron: `0 * * * *` o diario; Method POST.  
Header `x-function-secret` con el mismo valor que `EDGE_FUNCTION_SECRET`.  
`Authorization: Bearer <service_role>` ya no alcanza. `x-cleanup-secret` sigue siendo un alias del mismo valor.
