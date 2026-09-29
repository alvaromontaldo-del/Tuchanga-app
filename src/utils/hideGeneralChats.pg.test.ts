import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB = 'hide_general_chats_test';
const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260929220000_hide_general_chat_when_all_claims_closed.sql',
);
const INICIAR = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260925223000_iniciar_reclamo_garantia.sql'),
  'utf8',
);

const CLIENT = '11111111-1111-4111-8111-111111111111';
const WORKER = '22222222-2222-4222-8222-222222222222';

function psql(sql: string): string {
  return execFileSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', DB, '-At', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

function psqlScript(sql: string): void {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', DB], {
    encoding: 'utf8',
    input: sql,
  });
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(name);
  const end = source.indexOf('$$;', start);
  if (end < 0) throw new Error(`${name} end`);
  return source.slice(start, end + 3);
}

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

const setupSql = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
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

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  professional_status text NOT NULL
);

CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL
);

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL,
  trabajador_id uuid NOT NULL,
  primary_trade text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  contratacion_id uuid,
  CONSTRAINT conversations_distinct_participants CHECK (cliente_id <> trabajador_id)
);

CREATE UNIQUE INDEX ux_conversations_active_pair
  ON public.conversations (cliente_id, trabajador_id)
  WHERE deleted_at IS NULL AND contratacion_id IS NULL;

CREATE UNIQUE INDEX ux_conversations_active_contratacion
  ON public.conversations (contratacion_id)
  WHERE deleted_at IS NULL AND contratacion_id IS NOT NULL;

CREATE TABLE public.contrataciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  client_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  estado_trabajo text NOT NULL,
  estado_pago text NOT NULL DEFAULT 'pendiente_seña',
  completed_by_worker_at timestamptz,
  conformidad_aceptada boolean,
  conformidad_solicitada_at timestamptz,
  conformidad_respondida_at timestamptz,
  finalizado_at timestamptz,
  paid_at timestamptz,
  offline_pago_notificado_at timestamptz,
  offline_pago_confirmado_at timestamptz,
  disputa_motivo text NOT NULL DEFAULT '',
  is_claim_open boolean NOT NULL DEFAULT false,
  claim_status text NOT NULL DEFAULT 'none',
  claim_opened_at timestamptz,
  claim_marked_done_at timestamptz,
  claim_resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_hides (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE public.conversation_reads (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.hide_conversation_for_participants(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  ts timestamptz := now();
BEGIN
  SELECT c.cliente_id, c.trabajador_id INTO v_cliente, v_trabajador
  FROM public.conversations c
  WHERE c.id = p_conversation_id;
  IF v_cliente IS NULL OR v_trabajador IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.conversations
  SET deleted_at = coalesce(deleted_at, ts), updated_at = ts
  WHERE id = p_conversation_id;
  INSERT INTO public.conversation_hides (conversation_id, user_id, hidden_at)
  VALUES (p_conversation_id, v_cliente, ts), (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = EXCLUDED.hidden_at;
  INSERT INTO public.conversation_reads (conversation_id, user_id, read_at)
  VALUES (p_conversation_id, v_cliente, ts), (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at;
END;
$$;

CREATE FUNCTION public._assert_contratacion_participante(p_contratacion_id uuid)
RETURNS public.contrataciones
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  SELECT * INTO v_row FROM public.contrataciones WHERE id = p_contratacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contratación inexistente';
  END IF;
  IF v_row.client_id <> auth.uid() AND v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  RETURN v_row;
END;
$$;

CREATE FUNCTION public._chat_insert_system_event(
  p_conversation_id uuid,
  p_sender_id uuid,
  p_body text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
  VALUES (p_conversation_id, p_sender_id, p_body, 'system', coalesce(p_metadata, '{}'::jsonb));
END;
$$;

CREATE FUNCTION public._chat_notify_contratacion(p_conversation_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.messages (conversation_id, sender_id, body, type)
  VALUES (p_conversation_id, COALESCE(auth.uid(), p_conversation_id), p_body, 'system');
END;
$$;

CREATE FUNCTION public.try_archive_chat_after_job_complete(p_contratacion_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN false;
END;
$$;
`;

function seedPair(suffix: string): { client: string; worker: string } {
  const client = `11111111-1111-4111-8111-1111111111${suffix}`;
  const worker = `22222222-2222-4222-8222-2222222222${suffix}`;
  psql(
    `INSERT INTO public.profiles (id, professional_status)
     VALUES ('${client}', 'none'), ('${worker}', 'accepted');`,
  );
  return { client, worker };
}

function insertGeneral(client: string, worker: string): string {
  return psql(
    `INSERT INTO public.conversations (cliente_id, trabajador_id)
     VALUES ('${client}', '${worker}') RETURNING id;`,
  );
}

function insertClaimThread(client: string, worker: string): string {
  return psql(
    `INSERT INTO public.conversations (cliente_id, trabajador_id, contratacion_id)
     VALUES ('${client}', '${worker}', gen_random_uuid()) RETURNING id;`,
  );
}

function hidden(id: string): string {
  return psql(`SELECT deleted_at IS NOT NULL FROM public.conversations WHERE id = '${id}';`);
}

describe.skipIf(!postgresAvailable())('hide_pair_chats_if_done', () => {
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
    psqlScript(extractFunction(INICIAR, 'conversation_tiene_trabajo_vivo'));
    psqlScript(extractFunction(INICIAR, 'find_or_create_conversation'));
    psqlScript(readFileSync(MIGRATION, 'utf8'));
    psql(
      `INSERT INTO public.profiles (id, professional_status)
       VALUES ('${CLIENT}', 'none'), ('${WORKER}', 'accepted');`,
    );
  });

  afterAll(() => {
    execFileSync(
      'sudo',
      ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${DB};`],
      { encoding: 'utf8' },
    );
  });

  it('un trabajo finalizado, con las dos conformidades y pago, oculta el general y el contacto nuevo abre otro', () => {
    const general = insertGeneral(CLIENT, WORKER);
    psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo, estado_pago,
         completed_by_worker_at, conformidad_aceptada
       ) VALUES (
         '${general}', '${CLIENT}', '${WORKER}', 'finalizado', 'totalmente_pagado',
         now(), true
       );`,
    );
    psql(`SELECT public.hide_pair_chats_if_done('${CLIENT}', '${WORKER}');`);
    expect(hidden(general)).toBe('t');
    expect(psql(`SELECT count(*) FROM public.conversation_hides WHERE conversation_id = '${general}';`)).toBe(
      '2',
    );

    const created = psql(
      `SELECT set_config('request.jwt.claim.sub', '${CLIENT}', false);
       SELECT public.find_or_create_conversation('${WORKER}', 'Plomería');`,
    ).split('\n').pop();
    expect(created).toBeTruthy();
    expect(created).not.toBe(general);
    expect(
      psql(
        `SELECT contratacion_id IS NULL AND deleted_at IS NULL FROM public.conversations WHERE id = '${created}';`,
      ),
    ).toBe('t');
    const again = psql(
      `SELECT set_config('request.jwt.claim.sub', '${CLIENT}', false);
       SELECT public.find_or_create_conversation('${WORKER}', 'Plomería');`,
    ).split('\n').pop();
    expect(again).toBe(created);
  });

  it('un trabajo finalizado sin pago sigue visible, y se oculta cuando el pago se confirma después', () => {
    const { client, worker } = seedPair('01');
    const general = insertGeneral(client, worker);
    const job = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo, estado_pago,
         completed_by_worker_at, conformidad_aceptada, offline_pago_notificado_at
       ) VALUES (
         '${general}', '${client}', '${worker}', 'finalizado', 'seña_pagada',
         now(), true, now()
       ) RETURNING id;`,
    );
    psql(`SELECT public.hide_pair_chats_if_done('${client}', '${worker}');`);
    expect(hidden(general)).toBe('f');

    psql(
      `SELECT set_config('request.jwt.claim.sub', '${worker}', false);
       SELECT public.trabajador_confirmar_recepcion_offline('${job}'::uuid);`,
    );
    expect(psql(`SELECT estado_pago FROM public.contrataciones WHERE id = '${job}';`)).toBe(
      'totalmente_pagado',
    );
    expect(hidden(general)).toBe('t');
  });

  it('cerrar un reclamo con conformidad oculta ese hilo y el general', () => {
    const { client, worker } = seedPair('02');
    const general = insertGeneral(client, worker);
    const claim = insertClaimThread(client, worker);
    const job = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_marked_done_at
       ) VALUES (
         '${claim}', '${client}', '${worker}', 'finalizado',
         true, 'pending_approval', now() - interval '2 days', now() - interval '1 hour'
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${job}' WHERE id = '${claim}';`);

    const result = psql(
      `SELECT set_config('request.jwt.claim.sub', '${client}', false);
       SELECT public.confirmar_arreglo_garantia('${job}'::uuid)::text;`,
    ).split('\n').pop();
    expect(result).toContain('"claimStatus": "closed"');
    expect(hidden(claim)).toBe('t');
    expect(hidden(general)).toBe('t');
    expect(psql(`SELECT body FROM public.messages WHERE conversation_id = '${claim}';`)).toBe(
      '✅ El cliente confirmó el arreglo. Reclamo cerrado. La garantía de 30 días continúa sin reiniciarse.',
    );
  });

  it('otro trabajo en curso deja el general visible y no toca el hilo de un reclamo que sigue abierto', () => {
    const { client, worker } = seedPair('03');
    const general = insertGeneral(client, worker);
    const claim = insertClaimThread(client, worker);
    const closedClaim = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_marked_done_at, claim_resolved_at
       ) VALUES (
         '${claim}', '${client}', '${worker}', 'finalizado',
         false, 'closed', now(), now(), now()
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${closedClaim}' WHERE id = '${claim}';`);
    const openClaim = insertClaimThread(client, worker);
    const openJob = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at
       ) VALUES (
         '${openClaim}', '${client}', '${worker}', 'finalizado',
         true, 'open', now()
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${openJob}' WHERE id = '${openClaim}';`);
    psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo
       ) VALUES (
         '${general}', '${client}', '${worker}', 'en_curso'
       );`,
    );

    psql(`SELECT public.hide_pair_chats_if_done('${client}', '${worker}');`);
    expect(hidden(general)).toBe('f');
    expect(hidden(openClaim)).toBe('f');
    expect(hidden(claim)).toBe('t');
  });

  it('finalizar sin pago no oculta, y el pago anterior a la conformidad sí oculta al final', () => {
    const { client, worker } = seedPair('04');
    const general = insertGeneral(client, worker);
    const job = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo, estado_pago,
         offline_pago_notificado_at
       ) VALUES (
         '${general}', '${client}', '${worker}', 'en_curso', 'seña_pagada', now()
       ) RETURNING id;`,
    );
    psql(
      `SELECT set_config('request.jwt.claim.sub', '${worker}', false);
       SELECT public.trabajador_confirmar_recepcion_offline('${job}'::uuid);`,
    );
    expect(hidden(general)).toBe('f');
    psql(
      `UPDATE public.contrataciones SET estado_trabajo = 'en_curso' WHERE id = '${job}';
       SELECT set_config('request.jwt.claim.sub', '${worker}', false);
       SELECT public.trabajador_finalizar_trabajo('${job}'::uuid);`,
    );
    expect(psql(`SELECT conformidad_aceptada::text FROM public.contrataciones WHERE id = '${job}';`)).toBe(
      'true',
    );
    expect(hidden(general)).toBe('t');
    expect(
      psql(
        `SELECT count(*) FROM public.messages
         WHERE conversation_id = '${general}' AND metadata->>'event' = 'trabajo_finalizado';`,
      ),
    ).toBe('2');
  });

  it('anon y authenticated no pueden ejecutarla, y siguen los avisos del trabajador', () => {
    const meta = psql(
      `SELECT prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), '')
       FROM pg_proc WHERE proname = 'hide_pair_chats_if_done';`,
    );
    expect(meta).toBe('true|search_path=public');
    expect(
      psql(
        `SELECT has_function_privilege('anon', 'public.hide_pair_chats_if_done(uuid, uuid)', 'EXECUTE')::text
           || '|' || has_function_privilege('authenticated', 'public.hide_pair_chats_if_done(uuid, uuid)', 'EXECUTE')::text;`,
      ),
    ).toBe('false|false');

    const paused = seedPair('08');
    psql(`UPDATE public.profiles SET professional_status = 'paused' WHERE id = '${paused.worker}';`);
    expect(() =>
      psql(
        `SELECT set_config('request.jwt.claim.sub', '${paused.client}', false);
         SELECT public.find_or_create_conversation('${paused.worker}', '');`,
      ),
    ).toThrow(/worker_on_leave/);

    const unavailable = seedPair('09');
    psql(`UPDATE public.profiles SET professional_status = 'pending' WHERE id = '${unavailable.worker}';`);
    expect(() =>
      psql(
        `SELECT set_config('request.jwt.claim.sub', '${unavailable.client}', false);
         SELECT public.find_or_create_conversation('${unavailable.worker}', '');`,
      ),
    ).toThrow(/worker_unavailable/);
  });
});
