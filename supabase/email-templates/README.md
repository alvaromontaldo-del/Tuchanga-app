# Plantilla de correo — Confirm signup (YaChanga)

## Dónde pegarla

1. Abrí [Supabase Dashboard](https://supabase.com/dashboard) → tu proyecto.
2. **Authentication** → **Email Templates** → **Confirm signup**.
3. **Subject:** `Confirmá tu cuenta — YaChanga`
4. Pegá el contenido de `confirm-signup.html` (desde `<!DOCTYPE html>` inclusive) en el body HTML.
5. Guardá.

## Variables de Supabase usadas

- `{{ .Email }}` — email del usuario
- `{{ .ConfirmationURL }}` — enlace de confirmación

## Copy (o → u)

- “…trabajos **u** ofrecer…”
- “…trabajos **u** organizá…”
