-- Rellena Display name y Phone en Auth Users desde public.profiles.
-- El UID (UUID) no se puede cambiar.
-- El teléfono de la app vive en profiles.telefono; este script lo copia a auth.users
-- para que el dashboard Auth no muestre "-".

UPDATE auth.users u
SET
  raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'display_name', x.label,
    'full_name', x.label,
    'name', x.label,
    'phone', COALESCE(x.phone_e164, '')
  ),
  phone = CASE
    WHEN NULLIF(x.phone_e164, '') IS NULL THEN u.phone
    WHEN EXISTS (
      SELECT 1 FROM auth.users o
      WHERE o.phone = x.phone_e164 AND o.id <> u.id
    ) THEN u.phone
    ELSE x.phone_e164
  END,
  phone_confirmed_at = CASE
    WHEN NULLIF(x.phone_e164, '') IS NOT NULL
      AND u.phone_confirmed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.users o
        WHERE o.phone = x.phone_e164 AND o.id <> u.id
      )
      THEN now()
    ELSE u.phone_confirmed_at
  END
FROM (
  SELECT
    p.id,
    (
      regexp_replace(COALESCE(p.dni, ''), '[^0-9]', '', 'g')
      || '_'
      || initcap(
        regexp_replace(
          translate(
            lower(trim(COALESCE(p.apellido, ''))),
            'áàäâãéèëêíìïîóòöôõúùüûñç',
            'aaaaaeeeeiiiiooooouuuunc'
          ),
          '[^a-z0-9]+',
          '',
          'g'
        )
      )
    ) AS label,
    CASE
      WHEN length(regexp_replace(COALESCE(p.telefono, ''), '[^0-9]', '', 'g')) < 8 THEN NULL
      WHEN regexp_replace(COALESCE(p.telefono, ''), '[^0-9]', '', 'g') LIKE '54%'
        THEN '+' || regexp_replace(p.telefono, '[^0-9]', '', 'g')
      ELSE '+' || '54' || regexp_replace(
        regexp_replace(COALESCE(p.telefono, ''), '[^0-9]', '', 'g'),
        '^0',
        ''
      )
    END AS phone_e164
  FROM public.profiles p
  WHERE COALESCE(p.dni, '') ~ '[0-9]'
    AND length(trim(COALESCE(p.apellido, ''))) > 0
) x
WHERE
  u.id = x.id
  AND length(x.label) > 2;
