import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * #77 / #214 contra Postgres local. No toca producción.
 * Cubre E1–E4 y A4: la identidad no se aprueba con una foto,
 * aprobar/rechazar el oficio no reescribe fotos ajenas a la versión actual,
 * authenticated no tiene DML ni TRUNCATE, y un número nuevo no recicla
 * una foto de la versión anterior.
 */

const DB = 'matricula_oficio_test';
const FIXTURE = resolve(process.cwd(), 'supabase/tests/card_77_214_fixture.sql');
const MIGRATION = resolve(process.cwd(), 'supabase/card_77_214_matriculas_por_oficio.sql');
const WORKER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';

function postgresAvailable(): boolean {
  try {
    execFileSync('sudo', ['-u', 'postgres', 'psql', '-tAc', 'SELECT 1'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

const hasPg = postgresAvailable();

function psqlAdmin(sql: string, database?: string): string {
  const args = ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q'];
  if (database) args.push('-d', database);
  return execFileSync('sudo', args, { encoding: 'utf8', input: sql });
}

function psql(sql: string): string {
  return execFileSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', DB, '-At'],
    { encoding: 'utf8', input: sql },
  ).trim();
}

function psqlFile(file: string): void {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', DB, '-f', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function claim(userId: string): string {
  return `SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);`;
}

function raises(sql: string, pattern: RegExp): void {
  let message = '';
  try {
    psql(sql);
  } catch (error) {
    message = error instanceof Error ? `${error.message}\n${'stderr' in error ? String((error as { stderr?: Buffer }).stderr ?? '') : ''}` : String(error);
  }
  expect(message).toMatch(pattern);
}

describe.skipIf(!hasPg)('matrícula por oficio en Postgres', () => {
  beforeAll(() => {
    psqlAdmin(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};`);
    psqlFile(FIXTURE);
    psql(`
      INSERT INTO public.profiles (id, nombre, apellido, professional_status, coverage_km, location)
      VALUES
        ('${WORKER}', 'Horacio', 'Torres', 'accepted', 10, ST_SetSRID(ST_MakePoint(-58.4, -34.6), 4326)::geography),
        ('${ADMIN}', 'Admin', 'Local', 'accepted', 10, ST_SetSRID(ST_MakePoint(-58.4, -34.6), 4326)::geography);
      INSERT INTO auth.users (id, email) VALUES
        ('${WORKER}', 'worker@example.test'),
        ('${ADMIN}', 'admin@example.test');
      INSERT INTO public.admin_users (user_id) VALUES ('${ADMIN}');
      INSERT INTO public.jobs (user_id, nombre_oficio, es_principal) VALUES
        ('${WORKER}', 'Gas', false),
        ('${WORKER}', 'Electricidad', true);
      INSERT INTO public.matriculas (user_id, numero, entidad, storage_paths, status)
      VALUES (
        '${WORKER}', 'LEG-1', 'Ente legado',
        ARRAY['${WORKER}/1730000000000-legacy1.jpg'],
        'aprobada'
      );
      INSERT INTO storage.objects (bucket_id, name, metadata)
      SELECT 'matriculas', '${WORKER}/' || name, jsonb_build_object('size', 1000)
      FROM unnest(ARRAY[
        '1730000000000-legacy1.jpg',
        '1730000000001-gasfoto.jpg',
        '1730000000002-gasfotb.jpg',
        '1730000000003-gasfotc.jpg',
        '1730000000004-gasfotd.jpg',
        '1730000000005-elecfot.jpg',
        '1730000000006-elecfotb.jpg',
        '1730000000007-elecfotc.jpg',
        '1730000000008-elecfotd.jpg'
      ]) AS name;
    `);
    psqlFile(MIGRATION);
  }, 30_000);

  afterAll(() => {
    if (hasPg) psqlAdmin(`DROP DATABASE IF EXISTS ${DB};`);
  });

  it('authenticated solo puede leer matricula_fotos; anon no', () => {
    expect(psql(`SELECT has_table_privilege('authenticated', 'public.matricula_fotos', 'SELECT')`)).toBe('t');
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      expect(
        psql(`SELECT has_table_privilege('authenticated', 'public.matricula_fotos', '${privilege}')`),
        privilege,
      ).toBe('f');
      expect(psql(`SELECT has_table_privilege('anon', 'public.matricula_fotos', '${privilege}')`)).toBe('f');
    }
    expect(psql(`SELECT has_table_privilege('anon', 'public.matricula_fotos', 'SELECT')`)).toBe('f');
    raises(
      `SET ROLE authenticated; INSERT INTO public.matricula_fotos (user_id, oficio_codigo, storage_path, identidad_version) VALUES ('${WORKER}', 'gas', '${WORKER}/1730000000001-gasfoto.jpg', 1);`,
      /permission denied/i,
    );
    raises(`SET ROLE authenticated; TRUNCATE public.matricula_fotos;`, /permission denied/i);
    raises(`SET ROLE anon; SELECT public.get_my_matriculas();`, /permission denied/i);
  });

  it('no recicla fotos viejas y las RPC de admin no aprueban ni reescriben de más', () => {
    expect(psql(`SELECT oficio_codigo || ':' || identidad_version::text || ':' || status FROM public.matriculas`)).toBe(
      'sin_vincular:1:aprobada',
    );
    expect(psql(`SELECT public._matricula_publica_verificada('${WORKER}'::uuid)`)).toBe('t');
    expect(psql(`SELECT public._matriculas_oficios_verificados('${WORKER}'::uuid)::text`)).toBe('{}');

    psql(`
      ${claim(WORKER)}
      SELECT public.submit_my_matricula_oficio('gas', 'GAS-10', 'ENARGAS', ARRAY['${WORKER}/1730000000001-gasfoto.jpg']);
      SELECT public.submit_my_matricula_oficio('electricidad', 'ELEC-1', 'ERSEP', ARRAY['${WORKER}/1730000000005-elecfot.jpg']);
      ${claim(ADMIN)}
      SELECT public.admin_aprobar_matricula_oficio('${WORKER}'::uuid, 'gas');
      SELECT public.admin_aprobar_matricula_oficio('${WORKER}'::uuid, 'electricidad');
    `);

    const gasFoto = psql(
      `SELECT id::text FROM public.matricula_fotos WHERE storage_path LIKE '%gasfoto.jpg'`,
    );
    psql(`
      ${claim(WORKER)}
      SELECT public.submit_my_matricula_oficio('gas', 'GAS-10', 'ENARGAS', ARRAY['${WORKER}/1730000000002-gasfotb.jpg']);
    `);
    const gasMisma = psql(
      `SELECT id::text FROM public.matricula_fotos WHERE storage_path LIKE '%gasfotb.jpg'`,
    );
    psql(`${claim(ADMIN)} SELECT public.admin_aprobar_matricula_foto('${gasMisma}'::uuid);`);
    expect(psql(`SELECT status FROM public.matriculas WHERE oficio_codigo = 'gas'`)).toBe('aprobada');
    expect(psql(`SELECT status || ':' || identidad_version::text FROM public.matricula_fotos WHERE id = '${gasMisma}'`)).toBe(
      'aprobada:1',
    );
    expect(psql(`SELECT status FROM public.matricula_fotos WHERE id = '${gasFoto}'`)).toBe('aprobada');

    raises(
      `${claim(WORKER)} SELECT public.submit_my_matricula_oficio('gas', 'GAS-99', 'ENARGAS', ARRAY[]::text[]);`,
      /foto nueva/,
    );
    expect(psql(`SELECT numero FROM public.matriculas WHERE oficio_codigo = 'gas'`)).toBe('GAS-10');

    psql(`
      ${claim(WORKER)}
      SELECT public.submit_my_matricula_oficio('gas', 'GAS-99', 'ENARGAS', ARRAY['${WORKER}/1730000000003-gasfotc.jpg']);
    `);
    const fotoNueva = psql(
      `SELECT id::text FROM public.matricula_fotos WHERE storage_path LIKE '%gasfotc.jpg'`,
    );
    expect(psql(`SELECT status || ':' || identidad_version::text || ':' || numero FROM public.matriculas WHERE oficio_codigo = 'gas'`)).toBe(
      'pendiente:2:GAS-99',
    );
    expect(psql(`SELECT identidad_version::text || ':' || status FROM public.matricula_fotos WHERE id = '${gasFoto}'`)).toBe(
      '1:aprobada',
    );
    expect(psql(`SELECT public._oficio_verificado('${WORKER}'::uuid, 'gas')`)).toBe('f');
    expect(psql(`SELECT public._oficio_verificado('${WORKER}'::uuid, 'electricidad')`)).toBe('t');
    expect(psql(`SELECT numero || ':' || status FROM public.matriculas WHERE oficio_codigo = 'sin_vincular'`)).toBe(
      'LEG-1:aprobada',
    );
    raises(
      `${claim(ADMIN)} SELECT public.admin_aprobar_matricula_foto('${fotoNueva}'::uuid);`,
      /no aprueba el número/,
    );
    expect(psql(`SELECT status FROM public.matriculas WHERE oficio_codigo = 'gas'`)).toBe('pendiente');
    expect(psql(`SELECT status FROM public.matricula_fotos WHERE id = '${fotoNueva}'`)).toBe('pendiente');
    expect(psql(`SELECT status FROM public.matricula_fotos WHERE id = '${gasFoto}'`)).toBe('aprobada');

    psql(`
      ${claim(WORKER)}
      SELECT public.submit_my_matricula_oficio('electricidad', 'ELEC-2', 'ERSEP', ARRAY['${WORKER}/1730000000006-elecfotb.jpg']);
      SELECT public.submit_my_matricula_oficio('electricidad', 'ELEC-2', 'ERSEP', ARRAY['${WORKER}/1730000000007-elecfotc.jpg']);
    `);
    const elecPendiente = psql(
      `SELECT id::text FROM public.matricula_fotos WHERE storage_path LIKE '%elecfotb.jpg'`,
    );
    const elecRechazo = psql(
      `SELECT id::text FROM public.matricula_fotos WHERE storage_path LIKE '%elecfotc.jpg'`,
    );
    const elecVieja = psql(
      `SELECT id::text FROM public.matricula_fotos WHERE storage_path LIKE '%elecfot.jpg'`,
    );
    psql(`
      ${claim(ADMIN)}
      SELECT public.admin_rechazar_matricula_foto('${elecRechazo}'::uuid, 'Foto cortada');
      SELECT public.admin_aprobar_matricula_oficio('${WORKER}'::uuid, 'electricidad');
    `);
    expect(psql(`SELECT status FROM public.matricula_fotos WHERE id = '${elecRechazo}'`)).toBe('rechazada');
    expect(psql(`SELECT status || ':' || identidad_version::text FROM public.matricula_fotos WHERE id = '${elecPendiente}'`)).toBe(
      'aprobada:2',
    );
    expect(psql(`SELECT status || ':' || identidad_version::text FROM public.matricula_fotos WHERE id = '${elecVieja}'`)).toBe(
      'aprobada:1',
    );
    expect(psql(`SELECT public._oficio_verificado('${WORKER}'::uuid, 'electricidad')`)).toBe('t');
    expect(psql(`SELECT numero FROM public.matriculas WHERE oficio_codigo = 'gas'`)).toBe('GAS-99');

    psql(`
      ${claim(ADMIN)}
      SELECT public.admin_rechazar_matricula_oficio('${WORKER}'::uuid, 'electricidad', 'No coincide el número');
    `);
    expect(psql(`SELECT status FROM public.matriculas WHERE oficio_codigo = 'electricidad'`)).toBe('rechazada');
    expect(psql(`SELECT status FROM public.matricula_fotos WHERE id = '${elecPendiente}'`)).toBe('aprobada');
    expect(psql(`SELECT status FROM public.matricula_fotos WHERE id = '${elecVieja}'`)).toBe('aprobada');
    expect(psql(`SELECT status FROM public.matricula_fotos WHERE id = '${elecRechazo}'`)).toBe('rechazada');
    expect(psql(`SELECT public._oficio_verificado('${WORKER}'::uuid, 'electricidad')`)).toBe('f');
    expect(psql(`SELECT status FROM public.matriculas WHERE oficio_codigo = 'gas'`)).toBe('pendiente');
    expect(psql(`SELECT status FROM public.matriculas WHERE oficio_codigo = 'sin_vincular'`)).toBe('aprobada');

    raises(
      `${claim(ADMIN)} SELECT public.admin_aprobar_matricula_oficio('${WORKER}'::uuid, 'electricidad');`,
      /foto nueva/,
    );

    const versiones = psql(`
      BEGIN;
      ${claim(WORKER)}
      SELECT public.delete_my_matricula_foto('${gasFoto}'::uuid);
      SELECT public.delete_my_matricula_foto('${gasMisma}'::uuid);
      SELECT public.submit_my_matricula_oficio('gas', 'GAS-100', 'ENARGAS', ARRAY['${WORKER}/1730000000004-gasfotd.jpg']);
      SELECT public.submit_my_matricula_oficio('gas', 'GAS-101', 'ENARGAS', ARRAY['${WORKER}/1730000000008-elecfotd.jpg']);
      SELECT identidad_version::text FROM public.matriculas WHERE oficio_codigo = 'gas';
      ROLLBACK;
    `);
    expect(versiones.split('\n').filter(Boolean).pop()).toBe('4');
    expect(psql(`SELECT identidad_version::text FROM public.matriculas WHERE oficio_codigo = 'gas'`)).toBe('2');
    expect(psql(`SELECT count(*) FROM public.matricula_fotos WHERE oficio_codigo = 'gas'`)).toBe('3');
  });
});
