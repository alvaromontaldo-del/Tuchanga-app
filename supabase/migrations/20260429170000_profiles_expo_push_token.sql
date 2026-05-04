-- Tu Changa — Expo Push Token para notificaciones

alter table if exists public.profiles
  add column if not exists expo_push_token text;

create index if not exists idx_profiles_expo_push_token
  on public.profiles (expo_push_token);

