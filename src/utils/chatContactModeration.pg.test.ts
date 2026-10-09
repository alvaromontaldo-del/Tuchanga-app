import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const DB = 'chat_contact_moderation_test';
const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/20261001_p1_moderacion_chat_bucket_privado_card_67.sql'),
  'utf8',
);
const ANTIPUENTEO = readFileSync(
  resolve(process.cwd(), 'supabase/20261009_antipuenteo_contacto.sql'),
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

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT false;
$$;

CREATE OR REPLACE FUNCTION public._admin_require()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN;
END;
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  telefono text,
  direccion_texto text,
  direccion_completa text
);

CREATE TABLE public.material_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  client_id uuid,
  professional_id uuid,
  title text
);

CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  notes text
);

CREATE TABLE public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid,
  item_note text,
  alternative_description text,
  variant_label text
);

CREATE TABLE public.request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  description text
);

CREATE TABLE public.contrataciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  service_detail text,
  recotizacion_fundamentos text
);

CREATE TABLE public.recotizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratacion_id uuid,
  fundamentos text
);

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
    psqlScript(ANTIPUENTEO);
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

  it('ya no rechaza por la palabra ni por el dato', () => {
    const rows = psql(`
      SELECT coalesce(public.contact_info_blocked_reason('Cinta'), ''),
             coalesce(public.contact_info_blocked_reason('¿cuál es la dirección?'), ''),
             coalesce(public.contact_info_blocked_reason('11 1234 5678'), ''),
             coalesce(public.contact_info_blocked_reason('juan@mail.com'), '');
    `);
    expect(rows).toBe('|||');
    expect(
      psql(`
        SELECT (public.redact_offplatform_contact('¿cuál es la dirección?')->>'text')
          || '|' || (public.redact_offplatform_contact('11 1234 5678')->>'text')
          || '|' || (public.redact_offplatform_contact('juan@mail.com')->>'text')
          || '|' || (public.redact_offplatform_contact('$300.000')->>'text')
          || '|' || (public.redact_offplatform_contact('10 bolsas de cemento')->>'text')
          || '|' || (public.redact_offplatform_contact('Av. San Martín 2300')->>'text');
      `),
    ).toBe('¿cuál es la dirección?|•••|•••|$300.000|10 bolsas de cemento|•••');
  });

  it('el motivo de bloqueo queda vacío en text, image, budget, quotation y system', () => {
    expect(psql(`SELECT coalesce(public.message_free_text_blocked_reason('text', 'cinta y cable', '{}'::jsonb), '');`)).toBe('');
    expect(
      psql(`SELECT coalesce(public.message_free_text_blocked_reason('image', '📷 Foto', '{"caption":"11 1234 5678"}'::jsonb), '');`),
    ).toBe('');
    expect(
      psql(
        `SELECT coalesce(public.message_free_text_blocked_reason('quotation', 'Cotización', '{"service_detail":"364565566"}'::jsonb), '');`,
      ),
    ).toBe('');
    expect(
      psql(
        `SELECT coalesce(public.message_free_text_blocked_reason('system', '11 1234 5678', '{}'::jsonb), '');`,
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

  it('guarda el mensaje y reemplaza teléfono, mail y dirección', () => {
    const asClient = (sql: string) => asRole(sql);

    expect(
      asClient(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type)
        VALUES ('${CONV}', '${CLIENT}', 'Necesito cinta y cable, se viene el calor', 'text')
        RETURNING type;
      `),
    ).toBe('text');

    expect(
      asClient(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type)
        VALUES ('${CONV}', '${CLIENT}', 'llámame al 11 1234 5678', 'text')
        RETURNING body;
      `),
    ).toBe('llámame al •••');
    expect(
      psql(
        `SELECT kinds::text FROM public.offplatform_contact_detections WHERE field_name = 'body' ORDER BY created_at DESC LIMIT 1;`,
      ),
    ).toBe('{telefono}');

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

    expect(
      asClient(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
        VALUES (
          '${CONV}', '${CLIENT}', '📷 Foto', 'image',
          jsonb_build_object('image_bucket', 'chat', 'image_path', '${IMAGE_PATH}', 'caption', 'juan@mail.com')
        )
        RETURNING metadata->>'caption';
      `),
    ).toBe('•••');

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

    expect(
      asClient(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
        VALUES (
          '${CONV}', '${CLIENT}', 'Cotización', 'quotation',
          jsonb_build_object('service_detail', 'Volta 1140')
        )
        RETURNING metadata->>'service_detail';
      `),
    ).toBe('•••');

    expect(
      asClient(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type)
        VALUES ('${CONV}', '${CLIENT}', '¿cuál es la dirección?', 'text')
        RETURNING body;
      `),
    ).toBe('¿cuál es la dirección?');

    const systemId = psql(`
      SELECT public._test_insert_system('Seña de $15.000 confirmada el 23/06/2026 17:16. PIN 4821. 11 1234 5678');
    `);
    expect(
      psql(`SELECT body FROM public.messages WHERE id = '${systemId}';`),
    ).toBe('Seña de $15.000 confirmada el 23/06/2026 17:16. PIN 4821. 11 1234 5678');

    expect(
      psqlError(`SET ROLE anon; SELECT count(*) FROM public.offplatform_contact_detections;`),
    ).toMatch(/permission denied/i);
    expect(
      psqlError(`SET ROLE authenticated; SELECT count(*) FROM public.offplatform_contact_detections;`),
    ).toMatch(/permission denied/i);
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

  it('enmascara los cinco mensajes que se colaron', () => {
    const rows = psql(`
      SELECT (public.redact_offplatform_contact('Te paso mi dirección')->>'text')
        || '|' || (public.redact_offplatform_contact('Pellegrini 570, piso 2')->>'text')
        || '|' || (public.redact_offplatform_contact('La ubicación te la paso por Whatsapp pásame tu telefono')->>'text')
        || '|' || (public.redact_offplatform_contact('3364312302')->>'text')
        || '|' || (public.redact_offplatform_contact('11 cero 2 veinte nueve 67')->>'text')
        || '|' || (public.redact_offplatform_contact('Tres tres 6 y van más 4 trentaiuno 23 02')->>'text')
        || '|' || (public.redact_offplatform_contact('veinte mil')->>'text')
        || '|' || (public.redact_offplatform_contact('25 lucas')->>'text')
        || '|' || (public.redact_offplatform_contact('las 15:30')->>'text')
        || '|' || (public.redact_offplatform_contact('¿me pasás el teléfono?')->>'text')
        || '|' || (public.redact_offplatform_contact('hablamos por whatsapp en la obra')->>'text');
    `);
    expect(rows).toBe(
      'Te paso mi dirección|•••, •••|La ubicación te la paso ••• •••|•••|•••|•••|veinte mil|25 lucas|las 15:30|¿me pasás el teléfono?|hablamos por whatsapp en la obra',
    );
  });

  it('compara contra el perfil cargado y no loguea el dato', () => {
    const req = '44444444-4444-4444-8444-444444444444';
    const quote = '55555555-5555-4555-8555-555555555555';
    psql(`
      INSERT INTO public.profiles (id, telefono, direccion_texto, direccion_completa)
      VALUES
        ('${CLIENT}', '5493364312302', 'Pellegrini 570 piso 2', 'Pellegrini 570, Rosario'),
        ('${WORKER}', '5491112345678', NULL, NULL);
      INSERT INTO public.material_requests (id, conversation_id, client_id, professional_id, title)
      VALUES ('${req}', '${CONV}', '${CLIENT}', '${WORKER}', 'cemento');
    `);

    expect(
      psql(`
        SELECT public.redact_offplatform_contextual(
          '$300.000', 'probe_fp', NULL, 'body', '${CLIENT}', '${CONV}', false
        );
      `),
    ).toBe('$300.000');
    expect(
      psql(`
        SELECT public.redact_offplatform_contextual(
          'veinte mil', 'probe_fp', NULL, 'body', '${CLIENT}', '${CONV}', false
        );
      `),
    ).toBe('veinte mil');
    expect(
      psql(`
        SELECT public.redact_offplatform_contextual(
          '25 lucas', 'probe_fp', NULL, 'body', '${CLIENT}', '${CONV}', false
        );
      `),
    ).toBe('25 lucas');
    expect(
      psql(`
        SELECT public.redact_offplatform_contextual(
          'las 15:30', 'probe_fp', NULL, 'body', '${CLIENT}', '${CONV}', false
        );
      `),
    ).toBe('las 15:30');
    expect(
      psql(`
        SELECT public.redact_offplatform_contextual(
          'piso 2', 'probe_fp', NULL, 'body', '${CLIENT}', '${CONV}', false
        );
      `),
    ).toBe('•••');
    expect(
      psql(`
        SELECT kinds::text
        FROM public.offplatform_contact_detections
        WHERE source = 'probe_fp'
        ORDER BY created_at DESC
        LIMIT 1;
      `),
    ).toBe('{direccion}');

    expect(
      asRole(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type)
        VALUES ('${CONV}', '${CLIENT}', 'Pellegrini', 'text')
        RETURNING body;
      `),
    ).toBe('Pellegrini');
    expect(
      asRole(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type)
        VALUES ('${CONV}', '${CLIENT}', '570', 'text')
        RETURNING body;
      `),
    ).toBe('•••');
    expect(
      psql(`
        SELECT (kinds @> ARRAY['match_perfil']::text[])::text
        FROM public.offplatform_contact_detections
        WHERE field_name = 'body'
        ORDER BY created_at DESC
        LIMIT 1;
      `),
    ).toBe('true');

    const asWorker = (sql: string) =>
      psql(`
        BEGIN;
        SELECT set_config('request.jwt.claim.sub', '${WORKER}', true);
        SET LOCAL ROLE authenticated;
        ${sql}
        COMMIT;
      `);
    expect(
      asWorker(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type)
        VALUES ('${CONV}', '${WORKER}', '1234', 'text')
        RETURNING body;
      `),
    ).toBe('1234');
    expect(
      asWorker(`
        INSERT INTO public.messages (conversation_id, sender_id, body, type)
        VALUES ('${CONV}', '${WORKER}', '5678', 'text')
        RETURNING body;
      `),
    ).toBe('•••');

    expect(
      psql(`
        INSERT INTO public.quotes (id, request_id, notes)
        VALUES ('${quote}', '${req}', 'Pellegrini 570')
        RETURNING notes;
      `),
    ).toBe('•••');
    expect(
      psql(`
        SELECT (kinds @> ARRAY['match_perfil']::text[])::text
        FROM public.offplatform_contact_detections
        WHERE source = 'quote' AND field_name = 'notes'
        ORDER BY created_at DESC
        LIMIT 1;
      `),
    ).toBe('true');

    expect(
      psql(`
        SELECT count(*)::text
        FROM public.offplatform_contact_detections
        WHERE source = 'probe_fp' AND kinds @> ARRAY['match_perfil']::text[];
      `),
    ).toBe('0');
    expect(
      psqlError(`SET ROLE anon; SELECT public._offplatform_phone_tails('5493364312302');`),
    ).toMatch(/permission denied/i);
    expect(
      psqlError(`SET ROLE authenticated; SELECT public.redact_offplatform_contextual('570', 'x', NULL, 'body', '${CLIENT}', '${CONV}', true);`),
    ).toMatch(/permission denied/i);
  });
});
