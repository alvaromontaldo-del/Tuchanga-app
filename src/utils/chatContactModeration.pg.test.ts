import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const DB = 'chat_contact_moderation_test';
const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/20261001_p1_moderacion_chat_bucket_privado_card_67.sql'),
  'utf8',
);

const CLIENT = '11111111-1111-4111-8111-111111111111';
const WORKER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';
const IMAGE_PATH = `30123456_montaldo/chat/${CONV}/1730000000000-ab.jpg`;

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

function psql(sql: string): string {
  const out = execFileSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', DB, '-At', '-c', sql],
    { encoding: 'utf8' },
  );
  const lines = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? '';
}

function asRole(sql: string): string {
  return psql(`
    BEGIN;
    SELECT set_config('request.jwt.claim.sub', '${CLIENT}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `);
}

function psqlScript(sql: string): void {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', DB], {
    encoding: 'utf8',
    input: sql,
  });
}

function psqlError(sql: string): string {
  try {
    psql(sql);
    return '';
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const stderr = err.stderr ? String(err.stderr) : '';
    return `${stderr}\n${err.message ?? ''}`;
  }
}

const setupSql = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text,
  public boolean
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text
);

CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_to_array(name, '/');
$$;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  cliente_id uuid,
  trabajador_id uuid
);

CREATE TABLE public.user_blocks (
  blocker_id uuid,
  blocked_id uuid
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  body text,
  type text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY msg_select_participant ON public.messages
FOR SELECT TO authenticated
USING (sender_id = auth.uid());

CREATE OR REPLACE FUNCTION public.chat_cerrado_por_reclamo_conformidad(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT false;
$$;

CREATE OR REPLACE FUNCTION public.storage_owner_folder_for_me()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '30123456_montaldo'::text;
$$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT SELECT ON public.conversations TO authenticated;
GRANT SELECT ON public.user_blocks TO authenticated;
`;

describe.skipIf(!postgresAvailable())('moderación de chat y bucket privado', () => {
  beforeAll(() => {
    execFileSync(
      'sudo',
      ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${DB};`],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sudo',
      ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${DB};`],
      { encoding: 'utf8' },
    );
    psqlScript(setupSql);
    psqlScript(SQL);
    psql(`
      INSERT INTO public.conversations (id, cliente_id, trabajador_id)
      VALUES ('${CONV}', '${CLIENT}', '${WORKER}');

      CREATE OR REPLACE FUNCTION public._test_insert_system(p_body text)
      RETURNS uuid
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_id uuid;
      BEGIN
        INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
        VALUES ('${CONV}', '${CLIENT}', p_body, 'system', '{"event":"seña_pagada_cliente"}'::jsonb)
        RETURNING id INTO v_id;
        RETURN v_id;
      END;
      $fn$;

      GRANT EXECUTE ON FUNCTION public._test_insert_system(text) TO authenticated;
    `);
  });

  afterAll(() => {
    try {
      execFileSync(
        'sudo',
        ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${DB};`],
        { encoding: 'utf8', stdio: 'ignore' },
      );
    } catch {
      // La base de prueba puede no existir si el setup falló.
    }
  });

  it('deja pasar palabras de obra e importes, y bloquea teléfono y email', () => {
    const rows = psql(`
      SELECT public.contact_info_blocked_reason('Cinta'),
             public.contact_info_blocked_reason('Cable'),
             public.contact_info_blocked_reason('se viene el calor'),
             public.contact_info_blocked_reason('Cinta aisladora y cable de 2.5'),
             public.contact_info_blocked_reason('Nuevo presupuesto de materiales: $1.234.567. Tocá para ver el detalle.'),
             public.contact_info_blocked_reason('11 1234 5678'),
             public.contact_info_blocked_reason('364565566'),
             public.contact_info_blocked_reason('juan@mail.com'),
             public.contact_info_blocked_reason('+54 9 11 5555-6666');
    `);
    expect(rows).toBe('|||||telefono_num|telefono_num|email|telefono_num');
  });

  it('aplica el mismo criterio a text, image, budget y quotation', () => {
    expect(psql(`SELECT public.message_free_text_blocked_reason('text', 'cinta y cable', '{}'::jsonb);`)).toBe('');
    expect(psql(`SELECT public.message_free_text_blocked_reason('image', '📷 Foto', '{"caption":"cinta"}'::jsonb);`)).toBe('');
    expect(
      psql(`SELECT public.message_free_text_blocked_reason('image', '📷 Foto', '{"caption":"11 1234 5678"}'::jsonb);`),
    ).toBe('telefono_num');
    expect(
      psql(
        `SELECT public.message_free_text_blocked_reason('budget', 'Presupuesto', '{"service_detail":"se viene el calor"}'::jsonb);`,
      ),
    ).toBe('');
    expect(
      psql(
        `SELECT public.message_free_text_blocked_reason('budget', 'Presupuesto', '{"description":"juan@mail.com"}'::jsonb);`,
      ),
    ).toBe('email');
    expect(
      psql(
        `SELECT public.message_free_text_blocked_reason('quotation', 'Cotización', '{"service_detail":"364565566"}'::jsonb);`,
      ),
    ).toBe('telefono_num');
    expect(
      psql(
        `SELECT public.message_free_text_blocked_reason('system', '11 1234 5678', '{}'::jsonb);`,
      ),
    ).toBe('');
  });

  it('el cliente no inserta type=system; una función definer sí', () => {
    const denied = psqlError(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${CLIENT}', true);
      SET LOCAL ROLE authenticated;
      INSERT INTO public.messages (conversation_id, sender_id, body, type)
      VALUES ('${CONV}', '${CLIENT}', 'aviso falso', 'system');
      COMMIT;
    `);
    expect(denied).toContain('system_message_forbidden');

    const id = psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${CLIENT}', true);
      SET LOCAL ROLE authenticated;
      SELECT public._test_insert_system('Seña confirmada el 23/06/2026 17:16. PIN 4821.');
      COMMIT;
    `);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      psql(`SELECT type || '|' || body FROM public.messages WHERE id = '${id}';`),
    ).toContain('system|Seña confirmada');
  });

  it('guarda texto, imagen y presupuesto lícitos, y rechaza el contacto en cada tipo', () => {
    const asClient = (sql: string) => asRole(sql);
    const asClientFails = (sql: string) =>
      psqlError(`
        BEGIN;
        SELECT set_config('request.jwt.claim.sub', '${CLIENT}', true);
        SET LOCAL ROLE authenticated;
        ${sql}
        COMMIT;
      `);

    expect(
      asClient(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type)
        VALUES ('${CONV}', '${CLIENT}', 'Necesito cinta y cable, se viene el calor', 'text')
        RETURNING type;
      `),
    ).toBe('text');

    expect(asClientFails(`
      INSERT INTO public.messages (conversation_id, sender_id, body, type)
      VALUES ('${CONV}', '${CLIENT}', 'llámame al 11 1234 5678', 'text');
    `)).toContain('message_blocked_contact');

    expect(
      asClient(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
        VALUES (
          '${CONV}', '${CLIENT}', '📷 Foto', 'image',
          jsonb_build_object('image_bucket', 'chat', 'image_path', '${IMAGE_PATH}', 'caption', 'cinta aisladora')
        )
        RETURNING type;
      `),
    ).toBe('image');

    expect(asClientFails(`
      INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
      VALUES (
        '${CONV}', '${CLIENT}', '📷 Foto', 'image',
        jsonb_build_object('image_bucket', 'chat', 'image_path', '${IMAGE_PATH}', 'caption', 'juan@mail.com')
      );
    `)).toContain('message_blocked_contact');

    expect(
      asClient(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
        VALUES (
          '${CONV}', '${CLIENT}', 'Presupuesto de cinta', 'budget',
          jsonb_build_object('service_detail', 'cable de 2.5, se viene el calor')
        )
        RETURNING type;
      `),
    ).toBe('budget');

    expect(asClientFails(`
      INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
      VALUES (
        '${CONV}', '${CLIENT}', 'Cotización', 'quotation',
        jsonb_build_object('service_detail', '364565566')
      );
    `)).toContain('message_blocked_contact');
  });

  it('extrae el path de una URL pública vieja y marca el bucket chat como privado', () => {
    const legacy =
      'https://proj.supabase.co/storage/v1/object/public/job-photos/30123456_montaldo/chat/' +
      CONV +
      '/1730000000000-ab.jpg';
    expect(
      psql(
        `SELECT public.chat_image_object_path(jsonb_build_object('image_url', '${legacy}')) || '|' || public.chat_image_object_bucket(jsonb_build_object('image_url', '${legacy}'));`,
      ),
    ).toBe(`30123456_montaldo/chat/${CONV}/1730000000000-ab.jpg|job-photos`);

    expect(
      psql(
        `SELECT public.chat_image_object_path(jsonb_build_object('image_bucket','chat','image_path','${IMAGE_PATH}')) || '|' || public.chat_image_object_bucket(jsonb_build_object('image_bucket','chat','image_path','${IMAGE_PATH}'));`,
      ),
    ).toBe(`${IMAGE_PATH}|chat`);

    expect(psql(`SELECT public FROM storage.buckets WHERE id = 'chat';`)).toBe('f');
  });
});
