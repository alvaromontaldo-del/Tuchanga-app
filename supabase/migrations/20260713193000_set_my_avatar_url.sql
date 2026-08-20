-- Guardar avatar_url sin chocar con RLS (alta de usuario / ediciones).

CREATE OR REPLACE FUNCTION public.set_my_avatar_url (p_url TEXT)
RETURNS VOID AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
  SET
    avatar_url = NULLIF(trim(COALESCE(p_url, '')), ''),
    updated_at = now()
  WHERE
    id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.set_my_avatar_url (TEXT) TO authenticated;
