import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB = 'reclamo_garantia_test';
const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260925223000_iniciar_reclamo_garantia.sql',
);

const CLIENT = '11111111-1111-4111-8111-111111111111';

function psql(database: string, sql: string): string {
  return execFileSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', database, '-At', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

function psqlScript(database: string, sql: string): void {
  execFileSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { encoding: 'utf8', input: sql },
  );
}

const setupSql = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('reclamo.test_uid', true), '')::uuid;
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

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL,
  trabajador_id uuid NOT NULL,
  primary_trade text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT conversations_distinct_participants CHECK (cliente_id <> trabajador_id)
);

CREATE UNIQUE INDEX ux_conversations_active_pair
  ON public.conversations (cliente_id, trabajador_id)
  WHERE deleted_at IS NULL;

CREATE TABLE public.contrataciones (
  id uuid PRIMARY KEY,
  conversation_id uuid,
  client_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  estado_trabajo text NOT NULL,
  warranty_days int,
  warranty_anchor_at timestamptz,
  finalizado_at timestamptz,
  completed_by_worker_at timestamptz,
  is_claim_open boolean NOT NULL DEFAULT false,
  claim_status text NOT NULL DEFAULT 'none',
  claim_opened_at timestamptz,
  claim_marked_done_at timestamptz,
  claim_resolved_at timestamptz,
  service_detail text NOT NULL DEFAULT '',
  fecha_trabajo date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_hides (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  hidden_at timestamptz NOT NULL DEFAULT now(),
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

CREATE FUNCTION public.hide_conversation_for_participants(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
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
  SET deleted_at = coalesce(deleted_at, ts), updated_at = ts
  WHERE id = p_conversation_id;
  INSERT INTO public.conversation_hides (conversation_id, user_id, hidden_at)
  VALUES
    (p_conversation_id, v_cliente, ts),
    (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET hidden_at = EXCLUDED.hidden_at;
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
`;

function callRpc(contratacionId: string): string {
  return psql(
    DB,
    `SELECT set_config('reclamo.test_uid', '${CLIENT}', false);
     SELECT public.iniciar_reclamo_garantia('${contratacionId}'::uuid);`,
  ).split('\n').pop() ?? '';
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

describe.skipIf(!postgresAvailable())('iniciar_reclamo_garantia en Postgres', () => {
  beforeAll(() => {
    execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${DB};`], {
      encoding: 'utf8',
    });
    execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${DB};`], {
      encoding: 'utf8',
    });
    psqlScript(DB, setupSql);
    psqlScript(DB, readFileSync(MIGRATION, 'utf8'));
  });

  afterAll(() => {
    execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${DB};`], {
      encoding: 'utf8',
    });
  });

  it('queda security definer, search_path public, y anon no puede ejecutarla', () => {
    const meta = psql(
      DB,
      `SELECT prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), '')
       FROM pg_proc
       WHERE proname = 'iniciar_reclamo_garantia';`,
    );
    expect(meta.startsWith('true|')).toBe(true);
    expect(meta).toContain('search_path=public');

    const privileges = psql(
      DB,
      `SELECT has_function_privilege('anon', 'public.iniciar_reclamo_garantia(uuid)', 'EXECUTE')::text
         || '|' || has_function_privilege('authenticated', 'public.iniciar_reclamo_garantia(uuid)', 'EXECUTE')::text
         || '|' || has_function_privilege('service_role', 'public.iniciar_reclamo_garantia(uuid)', 'EXECUTE')::text;`,
    );
    expect(privileges).toBe('false|true|true');
  });

  it('reabre el chat propio activo, saca los hides y no duplica el evento', () => {
    const conv = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const job = '34e896fa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const worker = '22222222-2222-4222-8222-222222222221';
    psql(
      DB,
      `INSERT INTO public.conversations (id, cliente_id, trabajador_id)
       VALUES ('${conv}', '${CLIENT}', '${worker}');
       INSERT INTO public.contrataciones (
         id, conversation_id, client_id, worker_id, estado_trabajo,
         warranty_days, warranty_anchor_at, service_detail, fecha_trabajo
       ) VALUES (
         '${job}', '${conv}', '${CLIENT}', '${worker}', 'finalizado',
         30, now(), 'Pintura', DATE '2026-09-12'
       );
       INSERT INTO public.conversation_hides (conversation_id, user_id)
       VALUES ('${conv}', '${CLIENT}'), ('${conv}', '${worker}');`,
    );

    expect(callRpc(job)).toBe(conv);
    expect(callRpc(job)).toBe(conv);

    expect(
      psql(DB, `SELECT count(*) FROM public.conversation_hides WHERE conversation_id = '${conv}';`),
    ).toBe('0');
    expect(
      psql(
        DB,
        `SELECT count(*) || '|' || min(body)
         FROM public.messages
         WHERE metadata->>'contratacion_id' = '${job}';`,
      ),
    ).toBe(
      '1|El cliente inició un reclamo de garantía. Coordinen la revisión por este chat. La garantía sigue su curso.',
    );
    expect(
      psql(DB, `SELECT estado_trabajo || '|' || is_claim_open::text FROM public.contrataciones WHERE id = '${job}';`),
    ).toBe('finalizado|true');
  });

  it('con conversation_id NULL crea un chat y el segundo llamado no duplica el aviso', () => {
    const job = '34e896fa-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const worker = '22222222-2222-4222-8222-222222222222';
    psql(
      DB,
      `INSERT INTO public.contrataciones (
         id, conversation_id, client_id, worker_id, estado_trabajo,
         warranty_days, warranty_anchor_at, is_claim_open, claim_status, claim_opened_at,
         service_detail
       ) VALUES (
         '${job}', NULL, '${CLIENT}', '${worker}', 'finalizado',
         30, now(), true, 'open', now() - interval '1 hour',
         'Plomería'
       );`,
    );

    const first = callRpc(job);
    const second = callRpc(job);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      psql(DB, `SELECT conversation_id::text FROM public.contrataciones WHERE id = '${job}';`),
    ).toBe(first);
    expect(
      psql(DB, `SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${first}';`),
    ).toBe('t');
    expect(
      psql(
        DB,
        `SELECT count(*) FROM public.messages WHERE metadata->>'contratacion_id' = '${job}';`,
      ),
    ).toBe('1');
  });

  it('no oculta el chat activo de un trabajo en curso y nombra el servicio y la fecha', () => {
    const worker = '22222222-2222-4222-8222-222222222223';
    const deleted = '17ff17ff-17ff-417f-817f-17ff17ff17ff';
    const active = '3cef3cef-3cef-43ce-83ce-3cef3cef3cef';
    const finished = '84c11c6f-1111-4111-8111-111111111111';
    const inProgress = 'e2846e27-2222-4222-8222-222222222222';
    psql(
      DB,
      `INSERT INTO public.conversations (id, cliente_id, trabajador_id, deleted_at)
       VALUES
         ('${deleted}', '${CLIENT}', '${worker}', now()),
         ('${active}', '${CLIENT}', '${worker}', NULL);
       INSERT INTO public.contrataciones (
         id, conversation_id, client_id, worker_id, estado_trabajo,
         warranty_days, warranty_anchor_at, service_detail, fecha_trabajo
       ) VALUES (
         '${finished}', '${deleted}', '${CLIENT}', '${worker}', 'finalizado',
         30, now(), 'Pintura de frente', DATE '2026-09-12'
       );
       INSERT INTO public.contrataciones (
         id, conversation_id, client_id, worker_id, estado_trabajo, warranty_days
       ) VALUES (
         '${inProgress}', '${active}', '${CLIENT}', '${worker}', 'en_curso', 0
       );
       INSERT INTO public.conversation_hides (conversation_id, user_id)
       VALUES ('${active}', '${CLIENT}'), ('${active}', '${worker}');`,
    );

    expect(callRpc(finished)).toBe(active);
    expect(callRpc(finished)).toBe(active);

    expect(
      psql(DB, `SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${active}';`),
    ).toBe('t');
    expect(
      psql(DB, `SELECT deleted_at IS NOT NULL FROM public.conversations WHERE id = '${deleted}';`),
    ).toBe('t');
    expect(
      psql(DB, `SELECT conversation_id::text FROM public.contrataciones WHERE id = '${finished}';`),
    ).toBe(active);
    expect(
      psql(DB, `SELECT count(*) FROM public.conversation_hides WHERE conversation_id = '${active}';`),
    ).toBe('0');
    expect(
      psql(
        DB,
        `SELECT count(*)::text || '|' || min(body)
         FROM public.messages
         WHERE conversation_id = '${active}'
           AND metadata->>'event' = 'reclamo_garantia_iniciado';`,
      ),
    ).toBe(
      '1|El cliente inició un reclamo de garantía por «Pintura de frente» del 12/09/2026. Coordinen la revisión por este chat. La garantía sigue su curso.',
    );
  });

  it('cierra el otro chat solo si ese trabajo está finalizado y sin reclamo, y crea uno nuevo', () => {
    const worker = '22222222-2222-4222-8222-222222222224';
    const deleted = '17171717-1717-4171-8171-171717171717';
    const stale = '35353535-3535-4353-8353-353535353535';
    const claimJob = '84848484-1111-4111-8111-111111111184';
    const staleJob = 'e2e2e2e2-2222-4222-8222-222222222222';
    psql(
      DB,
      `INSERT INTO public.conversations (id, cliente_id, trabajador_id, deleted_at)
       VALUES
         ('${deleted}', '${CLIENT}', '${worker}', now()),
         ('${stale}', '${CLIENT}', '${worker}', NULL);
       INSERT INTO public.contrataciones (
         id, conversation_id, client_id, worker_id, estado_trabajo,
         warranty_days, warranty_anchor_at, service_detail, fecha_trabajo
       ) VALUES (
         '${claimJob}', '${deleted}', '${CLIENT}', '${worker}', 'finalizado',
         30, now(), 'Electricidad', DATE '2026-08-01'
       );
       INSERT INTO public.contrataciones (
         id, conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status, warranty_days
       ) VALUES (
         '${staleJob}', '${stale}', '${CLIENT}', '${worker}', 'finalizado',
         false, 'closed', 0
       );`,
    );

    const created = callRpc(claimJob);
    expect(created).not.toBe(stale);
    expect(created).not.toBe(deleted);
    expect(
      psql(DB, `SELECT deleted_at IS NOT NULL FROM public.conversations WHERE id = '${stale}';`),
    ).toBe('t');
    expect(
      psql(DB, `SELECT conversation_id::text FROM public.contrataciones WHERE id = '${claimJob}';`),
    ).toBe(created);
    expect(
      psql(DB, `SELECT body FROM public.messages WHERE conversation_id = '${created}';`),
    ).toBe(
      'El cliente inició un reclamo de garantía. Coordinen la revisión por este chat. La garantía sigue su curso.',
    );
    expect(callRpc(claimJob)).toBe(created);
    expect(
      psql(DB, `SELECT count(*) FROM public.messages WHERE metadata->>'contratacion_id' = '${claimJob}';`),
    ).toBe('1');
  });

  it('no cierra el chat de un trabajo finalizado que tiene reclamo abierto', () => {
    const worker = '22222222-2222-4222-8222-222222222225';
    const deleted = '18181818-1818-4181-8181-181818181818';
    const claimed = '36363636-3636-4363-8363-363636363636';
    const job = '85858585-1111-4111-8111-111111111185';
    const other = 'e3e3e3e3-2222-4222-8222-222222222223';
    psql(
      DB,
      `INSERT INTO public.conversations (id, cliente_id, trabajador_id, deleted_at)
       VALUES
         ('${deleted}', '${CLIENT}', '${worker}', now()),
         ('${claimed}', '${CLIENT}', '${worker}', NULL);
       INSERT INTO public.contrataciones (
         id, conversation_id, client_id, worker_id, estado_trabajo,
         warranty_days, finalizado_at, service_detail
       ) VALUES (
         '${job}', '${deleted}', '${CLIENT}', '${worker}', 'finalizado',
         30, '2026-09-02T02:30:00Z', 'Gasista'
       );
       INSERT INTO public.contrataciones (
         id, conversation_id, client_id, worker_id, estado_trabajo,
         is_claim_open, claim_status
       ) VALUES (
         '${other}', '${claimed}', '${CLIENT}', '${worker}', 'finalizado',
         true, 'pending_approval'
       );`,
    );

    expect(callRpc(job)).toBe(claimed);
    expect(
      psql(DB, `SELECT deleted_at IS NULL FROM public.conversations WHERE id = '${claimed}';`),
    ).toBe('t');
    expect(
      psql(DB, `SELECT body FROM public.messages WHERE conversation_id = '${claimed}';`),
    ).toBe(
      'El cliente inició un reclamo de garantía por «Gasista» del 01/09/2026. Coordinen la revisión por este chat. La garantía sigue su curso.',
    );
  });
});
