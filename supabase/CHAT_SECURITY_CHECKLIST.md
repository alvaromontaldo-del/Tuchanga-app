# Seguridad del chat — checklist (6 puntos)

Ejecutar en Supabase SQL Editor (o `supabase db push`):

`migrations/20260519120000_chat_security_hardening.sql`  
`migrations/20260520120000_realtime_conversation_reads.sql` (Realtime)  
`migrations/20260521120000_explicit_data_api_grants.sql` (GRANTs Data API / oct 2026)  
`migrations/20260527130000_content_moderation_expand.sql` (moderación ampliada + posts/cotizaciones)  
`migrations/20260527140000_moderation_spanish_number_words.sql` (números en palabras: "seis siete noventa")  
`migrations/20260527150000_moderation_area_code_evasion.sql` (característica/localidad + dígitos: "San Nicolás y 312302")  
`migrations/20260527160000_user_blocks_peer_select.sql` (RLS: ver si el otro te bloqueó)

| # | Ítem | Estado |
|---|------|--------|
| 1 | `get_unread_counts` solo cuenta hilos donde el usuario participa | Migración |
| 2 | Moderación anti-contacto en servidor (`enforce_message_rules`) | Migración + app |
| 3 | RLS `profiles`: sin SELECT global para `authenticated` | Migración |
| 4 | Chat: volver atrás si no sos participante | App |
| 5 | Rate limit: 30 mensajes / minuto por usuario | Migración |
| 6 | Bloqueo y reporte (`user_blocks`, `user_reports`) | Migración + app |

## Verificación manual

1. Usuario A no puede leer mensajes de un `conversation_id` ajeno (lista vacía).
2. Insertar mensaje con "whatsapp" desde API → error `message_blocked_contact`.
3. Perfil ajeno sin relación: `select dni` falla o vacío.
4. Abrir chat con UUID random → toast y `goBack`.
5. Enviar 31 mensajes en 1 min → `rate_limit_exceeded`.
6. Bloquear → no se puede crear chat ni enviar mensaje.
