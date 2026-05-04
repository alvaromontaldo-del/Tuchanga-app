-- Profesional: baja sin borrar usuario + years_experience nullable + fecha de nacimiento.

-- 1) Columna separada para descripción profesional (no mezclar con bio de cliente).
alter table if exists public.profiles
  add column if not exists professional_description text not null default '';

comment on column public.profiles.professional_description is
  'Descripción técnica del trabajador (perfil profesional). Vacío = no configurado.';

-- 2) Fecha de nacimiento (opcional para usuarios existentes; editable).
alter table if exists public.profiles
  add column if not exists birth_date date null;

comment on column public.profiles.birth_date is
  'Fecha de nacimiento (YYYY-MM-DD).';

-- Publicaciones: ocultamiento lógico cuando un trabajador se da de baja.
alter table if exists public.posts
  add column if not exists hidden_by_worker boolean not null default false;

comment on column public.posts.hidden_by_worker is
  'Si es true, el trabajador dio de baja su perfil profesional y sus publicaciones no aparecen en el feed.';

-- 3) years_experience flexible: nullable, validación 1–50 cuando no es null.
alter table if exists public.jobs
  alter column years_experience drop default,
  alter column years_experience drop not null;

alter table if exists public.jobs
  drop constraint if exists jobs_years_experience_range;

-- Normalizar datos existentes antes del CHECK:
-- - 0 o negativos → NULL (equivale a “vacío”)
-- - >50 → 50
update public.jobs
set years_experience = null
where years_experience is not null and years_experience < 1;

update public.jobs
set years_experience = 50
where years_experience is not null and years_experience > 50;

alter table if exists public.jobs
  add constraint jobs_years_experience_range
  check (years_experience is null or (years_experience >= 1 and years_experience <= 50));

-- 4) RPC update_worker_jobs: aceptar yearsExperience null y clamp 1–50 cuando venga.
drop function if exists public.update_worker_jobs(jsonb);

create function public.update_worker_jobs(p_jobs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  has_primary boolean;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.jobs where user_id = uid;

  if p_jobs is null then
    return;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(p_jobs) j
    where coalesce((j->>'isPrimary')::boolean, false) = true
  ) into has_primary;

  insert into public.jobs (user_id, nombre_oficio, descripcion, foto_url, es_principal, years_experience)
  select
    uid,
    nullif(trim(j->>'name'), ''),
    coalesce(trim(j->>'description'), ''),
    nullif(trim(j->>'photoUrl'), ''),
    case
      when has_primary then coalesce((j->>'isPrimary')::boolean, false)
      else (ord = 1)
    end,
    case
      when nullif(trim(j->>'yearsExperience'), '') is null then null
      else greatest(1, least(50, (j->>'yearsExperience')::int))
    end
  from (
    select
      j,
      row_number() over () as ord
    from jsonb_array_elements(p_jobs) j
    where nullif(trim(j->>'name'), '') is not null
    limit 5
  ) s;
end;
$$;

revoke all on function public.update_worker_jobs(jsonb) from public;
grant execute on function public.update_worker_jobs(jsonb) to authenticated;

-- 5) Dar de baja perfil profesional: borrar jobs + sacar cobertura + limpiar descripción profesional.
drop function if exists public.deactivate_professional_profile();

create function public.deactivate_professional_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.jobs where user_id = uid;

  update public.posts
  set hidden_by_worker = true
  where worker_id = uid;

  update public.profiles
  set
    coverage_km = null,
    professional_description = '',
    updated_at = now()
  where id = uid;

  if not found then
    raise exception 'profile not found';
  end if;
end;
$$;

revoke all on function public.deactivate_professional_profile() from public;
grant execute on function public.deactivate_professional_profile() to authenticated;

