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
  SELECT c.cliente_id, c.trabajador_id
    INTO v_cliente, v_trabajador
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF v_cliente IS NULL OR v_trabajador IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.conversations
  SET deleted_at = coalesce(deleted_at, ts),
      updated_at = ts
  WHERE id = p_conversation_id;

  INSERT INTO public.conversation_hides (conversation_id, user_id, hidden_at)
  VALUES
    (p_conversation_id, v_cliente, ts),
    (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET hidden_at = EXCLUDED.hidden_at;

  INSERT INTO public.conversation_reads (conversation_id, user_id, read_at)
  VALUES
    (p_conversation_id, v_cliente, ts),
    (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET read_at = EXCLUDED.read_at;
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
  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contratación inexistente';
  END IF;
  IF v_row.client_id <> auth.uid() AND v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  RETURN v_row;
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

function insertThreads(client: string, worker: string): { general: string; claim: string } {
  const general = psql(
    `INSERT INTO public.conversations (cliente_id, trabajador_id)
     VALUES ('${client}', '${worker}')
     RETURNING id;`,
  );
  const claim = psql(
    `INSERT INTO public.conversations (cliente_id, trabajador_id, contratacion_id)
     VALUES ('${client}', '${worker}', gen_random_uuid())
     RETURNING id;`,
  );
  return { general, claim };
}

describe.skipIf(!postgresAvailable())('ocultar el chat general cuando todos los reclamos cerraron', () => {
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

  it('un par con todos los reclamos cerrados oculta el general y el siguiente contacto crea otro', () => {
    const { general, claim } = insertThreads(CLIENT, WORKER);
    const job = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_resolved_at
       ) VALUES (
         '${claim}', '${CLIENT}', '${WORKER}', 'finalizado',
         false, 'closed', now(), now()
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${job}' WHERE id = '${claim}';`);

    psql(`SELECT public.hide_general_chats_if_all_claims_closed('${CLIENT}', '${WORKER}');`);

    expect(psql(`SELECT deleted_at IS NOT NULL FROM public.conversations WHERE id = '${general}';`)).toBe(
      't',
    );
    expect(psql(`SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${claim}';`)).toBe('t');
    expect(psql(`SELECT contratacion_id::text FROM public.conversations WHERE id = '${claim}';`)).toBe(job);
    expect(
      psql(`SELECT count(*) FROM public.conversation_hides WHERE conversation_id = '${general}';`),
    ).toBe('2');
    expect(
      psql(`SELECT count(*) FROM public.conversation_reads WHERE conversation_id = '${general}';`),
    ).toBe('2');

    const created = psql(
      `SELECT set_config('request.jwt.claim.sub', '${CLIENT}', false);
       SELECT public.find_or_create_conversation('${WORKER}', 'Plomería');`,
    ).split('\n').pop();
    expect(created).toBeTruthy();
    expect(created).not.toBe(general);
    expect(created).not.toBe(claim);
    expect(psql(`SELECT contratacion_id IS NULL AND deleted_at IS NULL FROM public.conversations WHERE id = '${created}';`)).toBe(
      't',
    );

    const again = psql(
      `SELECT set_config('request.jwt.claim.sub', '${CLIENT}', false);
       SELECT public.find_or_create_conversation('${WORKER}', 'Plomería');`,
    ).split('\n').pop();
    expect(again).toBe(created);
  });

  it('un reclamo abierto del par no oculta el chat general', () => {
    const { client, worker } = seedPair('01');
    const { general, claim } = insertThreads(client, worker);
    const job = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at
       ) VALUES (
         '${claim}', '${client}', '${worker}', 'finalizado',
         true, 'open', now()
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${job}' WHERE id = '${claim}';`);
    psql(`SELECT public.hide_general_chats_if_all_claims_closed('${client}', '${worker}');`);
    expect(psql(`SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${general}';`)).toBe('t');
    expect(psql(`SELECT count(*) FROM public.conversation_hides WHERE conversation_id = '${general}';`)).toBe(
      '0',
    );
  });

  it('cerrar uno no oculta el general mientras otro reclamo del par sigue abierto', () => {
    const { client, worker } = seedPair('02');
    const { general, claim } = insertThreads(client, worker);
    const closing = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_marked_done_at
       ) VALUES (
         '${claim}', '${client}', '${worker}', 'finalizado',
         true, 'pending_approval', now(), now()
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${closing}' WHERE id = '${claim}';`);
    const otherClaim = psql(
      `INSERT INTO public.conversations (cliente_id, trabajador_id, contratacion_id)
       VALUES ('${client}', '${worker}', gen_random_uuid()) RETURNING id;`,
    );
    const openJob = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at
       ) VALUES (
         '${otherClaim}', '${client}', '${worker}', 'finalizado',
         true, 'pending_approval', now()
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${openJob}' WHERE id = '${otherClaim}';`);

    psql(
      `SELECT set_config('request.jwt.claim.sub', '${client}', false);
       SELECT public.confirmar_arreglo_garantia('${closing}'::uuid);`,
    );
    expect(psql(`SELECT claim_status FROM public.contrataciones WHERE id = '${closing}';`)).toBe('closed');
    expect(psql(`SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${general}';`)).toBe('t');
    expect(psql(`SELECT claim_status FROM public.contrataciones WHERE id = '${openJob}';`)).toBe(
      'pending_approval',
    );
  });

  it('un trabajo finalizado sin reclamo no oculta el chat', () => {
    const { client, worker } = seedPair('03');
    const general = psql(
      `INSERT INTO public.conversations (cliente_id, trabajador_id)
       VALUES ('${client}', '${worker}') RETURNING id;`,
    );
    psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo
       ) VALUES (
         '${general}', '${client}', '${worker}', 'finalizado'
       );`,
    );
    psql(`SELECT public.hide_general_chats_if_all_claims_closed('${client}', '${worker}');`);
    expect(psql(`SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${general}';`)).toBe('t');
  });

  it('un trabajo en curso en el hilo general lo mantiene aunque los reclamos estén cerrados', () => {
    const { client, worker } = seedPair('04');
    const { general, claim } = insertThreads(client, worker);
    const job = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_resolved_at
       ) VALUES (
         '${claim}', '${client}', '${worker}', 'finalizado',
         false, 'closed', now(), now()
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${job}' WHERE id = '${claim}';`);
    psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo
       ) VALUES (
         '${general}', '${client}', '${worker}', 'en_curso'
       );`,
    );
    psql(`SELECT public.hide_general_chats_if_all_claims_closed('${client}', '${worker}');`);
    expect(psql(`SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${general}';`)).toBe('t');
  });

  it('confirmar el único arreglo oculta el general, deja el hilo de reclamo y conserva el aviso', () => {
    const { client, worker } = seedPair('05');
    const { general, claim } = insertThreads(client, worker);
    const job = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_marked_done_at
       ) VALUES (
         '${claim}', '${client}', '${worker}', 'finalizado',
         true, 'pending_approval', now() - interval '1 day', now() - interval '1 hour'
       ) RETURNING id;`,
    );
    psql(`UPDATE public.conversations SET contratacion_id = '${job}' WHERE id = '${claim}';`);

    const result = psql(
      `SELECT set_config('request.jwt.claim.sub', '${client}', false);
       SELECT public.confirmar_arreglo_garantia('${job}'::uuid)::text;`,
    ).split('\n').pop();
    expect(result).toContain('"claimStatus": "closed"');
    expect(psql(`SELECT deleted_at IS NOT NULL FROM public.conversations WHERE id = '${general}';`)).toBe(
      't',
    );
    expect(psql(`SELECT deleted_at IS NULL AND contratacion_id::text = '${job}' FROM public.conversations WHERE id = '${claim}';`)).toBe(
      't',
    );
    expect(psql(`SELECT body FROM public.messages WHERE conversation_id = '${claim}';`)).toBe(
      '✅ El cliente confirmó el arreglo. Reclamo cerrado. La garantía de 30 días continúa sin reiniciarse.',
    );
  });

  it('la autoaprobación oculta el par solo cuando cierra el último reclamo vencido', () => {
    const closedPair = seedPair('06');
    const openPair = seedPair('07');
    const closedThreads = insertThreads(closedPair.client, closedPair.worker);
    const openThreads = insertThreads(openPair.client, openPair.worker);

    const first = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_marked_done_at
       ) VALUES (
         '${closedThreads.claim}', '${closedPair.client}', '${closedPair.worker}', 'finalizado',
         true, 'pending_approval', now() - interval '5 days', now() - interval '80 hours'
       ) RETURNING id;`,
    );
    const secondThread = psql(
      `INSERT INTO public.conversations (cliente_id, trabajador_id, contratacion_id)
       VALUES ('${closedPair.client}', '${closedPair.worker}', gen_random_uuid()) RETURNING id;`,
    );
    const second = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_marked_done_at
       ) VALUES (
         '${secondThread}', '${closedPair.client}', '${closedPair.worker}', 'finalizado',
         true, 'pending_approval', now() - interval '5 days', now() - interval '73 hours'
       ) RETURNING id;`,
    );
    psql(
      `UPDATE public.conversations SET contratacion_id = '${first}' WHERE id = '${closedThreads.claim}';
       UPDATE public.conversations SET contratacion_id = '${second}' WHERE id = '${secondThread}';`,
    );

    const stillOpen = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_marked_done_at
       ) VALUES (
         '${openThreads.claim}', '${openPair.client}', '${openPair.worker}', 'finalizado',
         true, 'open', now() - interval '2 days', NULL
       ) RETURNING id;`,
    );
    const staleThread = psql(
      `INSERT INTO public.conversations (cliente_id, trabajador_id, contratacion_id)
       VALUES ('${openPair.client}', '${openPair.worker}', gen_random_uuid()) RETURNING id;`,
    );
    const stale = psql(
      `INSERT INTO public.contrataciones (
         conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, claim_opened_at, claim_marked_done_at
       ) VALUES (
         '${staleThread}', '${openPair.client}', '${openPair.worker}', 'finalizado',
         true, 'pending_approval', now() - interval '4 days', now() - interval '90 hours'
       ) RETURNING id;`,
    );
    psql(
      `UPDATE public.conversations SET contratacion_id = '${stillOpen}' WHERE id = '${openThreads.claim}';
       UPDATE public.conversations SET contratacion_id = '${stale}' WHERE id = '${staleThread}';`,
    );

    expect(psql(`SELECT public.auto_approve_stale_warranty_claims();`)).toBe('3');
    expect(
      psql(`SELECT deleted_at IS NOT NULL FROM public.conversations WHERE id = '${closedThreads.general}';`),
    ).toBe('t');
    expect(
      psql(`SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${closedThreads.claim}';`),
    ).toBe('t');
    expect(
      psql(`SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${secondThread}';`),
    ).toBe('t');
    expect(
      psql(`SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${openThreads.general}';`),
    ).toBe('t');
    expect(psql(`SELECT claim_status FROM public.contrataciones WHERE id = '${stillOpen}';`)).toBe('open');
    expect(psql(`SELECT claim_status FROM public.contrataciones WHERE id = '${stale}';`)).toBe('closed');
    expect(psql(`SELECT count(*) FROM public.messages WHERE body LIKE '✅ Reclamo de garantía cerrado automáticamente%';`)).toBe(
      '3',
    );
  });

  it('anon y authenticated no pueden ejecutarla, y find_or_create sigue con los avisos del trabajador', () => {
    const meta = psql(
      `SELECT prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), '')
       FROM pg_proc
       WHERE proname = 'hide_general_chats_if_all_claims_closed';`,
    );
    expect(meta).toBe('true|search_path=public');
    const privileges = psql(
      `SELECT has_function_privilege('anon', 'public.hide_general_chats_if_all_claims_closed(uuid, uuid)', 'EXECUTE')::text
         || '|' || has_function_privilege('authenticated', 'public.hide_general_chats_if_all_claims_closed(uuid, uuid)', 'EXECUTE')::text;`,
    );
    expect(privileges).toBe('false|false');

    const findDef = psql(
      `SELECT pg_get_functiondef(p.oid)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'find_or_create_conversation';`,
    );
    expect(findDef).toContain('worker_on_leave');
    expect(findDef).toContain('worker_unavailable');
    expect(findDef).toContain('worker_not_found');

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
