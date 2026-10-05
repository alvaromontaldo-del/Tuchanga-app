-- #95 regresión: el endurecimiento de seguridad (#100/#119/#120) dejó a `authenticated`
-- solo con UPDATE (expo_push_token) en public.profiles. La app guarda la descripción
-- profesional y la bio con PATCH directo → 403 "permission denied for table profiles".
-- Fix SQL-only (apps instaladas se recuperan sin OTA): UPDATE por columna, solo de
-- texto libre propio. RLS profiles_update_own (id = auth.uid()) limita a la fila propia.
-- Siguen bloqueadas: role, professional_status, saldo_credito, apellido, telefono, dni,
-- location, coverage_km, atiende_urgencias (RPC), intro_video_path, avatar_url (RPC), etc.
GRANT UPDATE (professional_description, bio) ON public.profiles TO authenticated;

-- Tope de largo (la RPC update_professional_description ya limita a 500).
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_professional_description_len_check,
  DROP CONSTRAINT IF EXISTS profiles_bio_len_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_professional_description_len_check
    CHECK (professional_description IS NULL OR char_length(professional_description) <= 2000),
  ADD CONSTRAINT profiles_bio_len_check
    CHECK (bio IS NULL OR char_length(bio) <= 2000);
