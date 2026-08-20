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
npx supabase functions deploy cleanup_chat_images --project-ref kyxehrxcdealbujvvnxp
```

La app también la invoca al dejar reseña / confirmar pago (además de triggers SQL que ocultan el chat al instante).

## Schedule (respaldo)

Dashboard → Edge Functions → `cleanup_chat_images` → Schedules  
Cron: `0 * * * *` o diario; Method POST; Authorization con service role.
