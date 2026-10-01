import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

/**
 * Regresión del PIN de materiales (seguimiento #63), contra Postgres local.
 * No toca producción: crea y borra la base material_pin_requester_test.
 *
 * Cliente antes y después de pagar, profesional que creó la solicitud
 * (material_requests.professional_id) antes y después, dueño del comercio
 * nunca, y cierre con completar_orden_material_con_pin.
 */

const DB = 'material_pin_requester_test';
const SQL = resolve(process.cwd(), 'supabase/20261001_card_63_pin_requester.sql');

const CLIENT = '11111111-1111-4111-8111-111111111111';
const PRO = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const SELF = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';

const STORE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STORE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQ_1 = 'c1111111-1111-4111-8111-111111111111';
const REQ_2 = 'c2222222-2222-4222-8222-222222222222';
const QUOTE_1 = 'd1111111-1111-4111-8111-111111111111';
const QUOTE_2 = 'd2222222-2222-4222-8222-222222222222';
const ORDER_UNPAID = 'e1111111-1111-4111-8111-111111111111';
const ORDER_PAID = 'e2222222-2222-4222-8222-222222222222';
const ORDER_SELF = 'e3333333-3333-4333-8333-333333333333';

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
  return execFileSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', DB, '-At'],
    { encoding: 'utf8', input: sql },
  ).trim();
}

function psqlAdmin(sql: string): void {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8',
    input: sql,
  });
}

function lastLine(sql: string): string {
  const lines = psql(sql)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

function asUser(uid: string | null, body: string): string {
  const value = uid ?? '';
  return `SELECT set_config('pinreq.test_uid', '${value}', false);\n${body}`;
}

function errorText(sql: string): string {
  try {
    psql(sql);
    return '';
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    return `${err.stderr ?? ''}\n${err.stdout ?? ''}`;
  }
}

function reveal(uid: string | null, orderId: string): string {
  return lastLine(
    asUser(
      uid,
      `SELECT coalesce(verification_pin, 'null') || '|' ||
              coalesce(store_phone, 'null') || '|' ||
              coalesce(store_address, 'null') || '|' ||
              coalesce(order_code, 'null') || '|' ||
              contact_revealed::text
       FROM public.get_material_order_reveal('${orderId}');`,
    ),
  );
}

function quoteReveal(uid: string | null, requestId: string, orderId: string): string {
  return lastLine(
    asUser(
      uid,
      `SELECT coalesce(
         (
           SELECT coalesce(verification_pin, 'null') || '|' ||
                  coalesce(store_phone, 'null') || '|' ||
                  coalesce(store_address, 'null') || '|' ||
                  coalesce(order_code, 'null')
           FROM public.list_material_request_quote_reveals('${requestId}')
           WHERE order_id = '${orderId}'
         ),
         'missing'
       );`,
    ),
  );
}

function myOrder(uid: string | null, orderId: string): string {
  return lastLine(
    asUser(
      uid,
      `SELECT CASE
         WHEN elem IS NULL THEN 'missing'
         ELSE coalesce(elem->>'verification_pin', 'null') || '|' ||
              coalesce(elem->>'store_phone', 'null') || '|' ||
              coalesce(elem->>'store_address', 'null')
       END
       FROM (
         SELECT (
           SELECT elem
           FROM jsonb_array_elements(public.list_my_material_solicitudes()) elem
           WHERE elem->>'order_id' = '${orderId}'
         ) AS elem
       ) s;`,
    ),
  );
}

const setupSql = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('pinreq.test_uid', true), '')::uuid;
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

CREATE TABLE public.stores (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  name text,
  phone text,
  address text,
  opening_hours jsonb
);

CREATE TABLE public.material_requests (
  id uuid PRIMARY KEY,
  professional_id uuid,
  client_id uuid,
  title text,
  status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.material_checkouts (
  id uuid PRIMARY KEY,
  client_id uuid
);

CREATE TABLE public.quotes (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  store_id uuid NOT NULL,
  client_id uuid,
  status text,
  freight_type text,
  freight_cost numeric
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  quote_id uuid NOT NULL,
  client_id uuid,
  payment_group_id uuid,
  order_code text,
  status text,
  deposit_status text,
  deposit_amount numeric,
  accepted_total numeric,
  verification_pin text,
  contact_revealed_at timestamptz,
  include_freight boolean,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.request_items (
  id uuid PRIMARY KEY,
  description text,
  quantity numeric,
  unit text,
  sort_order int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.quote_items (
  id uuid PRIMARY KEY,
  quote_id uuid,
  request_item_id uuid,
  client_decision text,
  variant_label text,
  alternative_description text,
  in_stock boolean,
  variant_index int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.is_store_owner(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.user_id = auth.uid()
  );
$$;

CREATE FUNCTION public._material_order_payer_can_reveal(p_order_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = p_order_id
      AND (
        o.client_id = p_uid
        OR EXISTS (
          SELECT 1 FROM public.material_checkouts mc
          WHERE mc.id = o.payment_group_id AND mc.client_id = p_uid
        )
        OR EXISTS (
          SELECT 1 FROM public.quotes q
          WHERE q.id = o.quote_id AND q.client_id = p_uid
        )
        OR EXISTS (
          SELECT 1
          FROM public.quotes q
          JOIN public.material_requests mr ON mr.id = q.request_id
          WHERE q.id = o.quote_id AND mr.client_id = p_uid
        )
      )
  );
$$;

CREATE FUNCTION public.generar_pin_verificacion()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT '0000';
$$;

CREATE FUNCTION public.generate_store_order_code()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT '9090';
$$;

CREATE FUNCTION public.enqueue_store_push(
  p_store_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE sql
AS $$
  SELECT gen_random_uuid();
$$;

CREATE FUNCTION public.completar_orden_material_con_pin(p_order_code text, p_pin text)
RETURNS TABLE (order_id uuid, order_code text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_raw text := upper(trim(coalesce(p_order_code, '')));
  v_digits text := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_pin text := lpad(trim(coalesce(p_pin, '')), 4, '0');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF v_digits = '' OR trim(coalesce(p_pin, '')) = '' THEN
    RAISE EXCEPTION 'code_or_pin_required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = (
    SELECT o.id
    FROM public.orders o
    WHERE o.order_code = v_digits
       OR regexp_replace(o.order_code, '[^0-9]', '', 'g') = v_digits
    ORDER BY o.created_at DESC
    LIMIT 1
  )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  IF v_store.user_id <> v_uid THEN
    RAISE EXCEPTION 'not_store_owner';
  END IF;

  IF v_order.status = 'completed' THEN
    order_id := v_order.id;
    order_code := v_order.order_code;
    status := v_order.status;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.deposit_status <> 'paid' OR v_order.status <> 'deposit_paid' THEN
    RAISE EXCEPTION 'deposit_not_paid';
  END IF;

  IF lpad(trim(coalesce(v_order.verification_pin, '')), 4, '0') IS DISTINCT FROM v_pin THEN
    RAISE EXCEPTION 'invalid_pin';
  END IF;

  UPDATE public.orders AS o
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE o.id = v_order.id
  RETURNING * INTO v_order;

  UPDATE public.material_requests AS mr
  SET status = 'completed', updated_at = now()
  WHERE mr.id = v_quote.request_id
    AND mr.status IN ('accepted', 'quoted', 'sent');

  PERFORM public.enqueue_store_push(
    v_quote.store_id, 'order_completed', 'YaChanga', 'cerrado', '{}'::jsonb
  );

  order_id := v_order.id;
  order_code := v_order.order_code;
  status := v_order.status;
  RETURN NEXT;
END;
$$;
`;

const seedSql = `
INSERT INTO public.stores (id, user_id, name, phone, address)
VALUES
  ('${STORE_A}', '${OWNER}', 'Corralón Norte', '1144440000', 'Calle Falsa 123'),
  ('${STORE_B}', '${SELF}', 'Mi comercio', '1155550000', 'Av Autocompra 9');

INSERT INTO public.material_requests (id, professional_id, client_id, title, status)
VALUES
  ('${REQ_1}', '${PRO}', '${CLIENT}', 'Obra cliente', 'accepted'),
  ('${REQ_2}', '${SELF}', '${CLIENT}', 'Autocompra', 'accepted');

INSERT INTO public.quotes (id, request_id, store_id, client_id, status, freight_type, freight_cost)
VALUES
  ('${QUOTE_1}', '${REQ_1}', '${STORE_A}', '${CLIENT}', 'accepted', 'pickup', 0),
  ('${QUOTE_2}', '${REQ_2}', '${STORE_B}', '${CLIENT}', 'accepted', 'pickup', 0);

INSERT INTO public.orders (
  id, quote_id, client_id, order_code, status, deposit_status,
  deposit_amount, accepted_total, verification_pin, include_freight
) VALUES
  (
    '${ORDER_UNPAID}', '${QUOTE_1}', '${CLIENT}', '3003', 'pending_deposit', 'pending',
    500, 8000, '9999', false
  ),
  (
    '${ORDER_PAID}', '${QUOTE_1}', '${CLIENT}', '1001', 'deposit_paid', 'paid',
    500, 8000, '4242', false
  ),
  (
    '${ORDER_SELF}', '${QUOTE_2}', '${CLIENT}', '2002', 'deposit_paid', 'paid',
    500, 2400, '5757', false
  );
`;

describe('contrato SQL del PIN para el creador', () => {
  const sql = readFileSync(SQL, 'utf8');

  it('conserva los guards y no abre el PIN al dueño del comercio', () => {
    for (const guard of [
      'not_authenticated',
      'order_not_found',
      'not_order_client',
      'request_not_found',
      'not_request_party',
    ]) {
      expect(sql).toContain(`'${guard}'`);
    }
    expect(sql).toContain('mr.professional_id');
    expect(sql).toContain('v_req.professional_id = v_uid');
    expect(sql).toContain('public.is_store_owner');
    expect(sql).not.toContain('FUNCTION public.completar_orden_material_con_pin');
  });
});

describe.skipIf(!postgresAvailable())('PIN de materiales para cliente y creador', () => {
  beforeAll(() => {
    psqlAdmin(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};`);
    psql(setupSql);
    psql(readFileSync(SQL, 'utf8'));
    psql(seedSql);
  });

  afterAll(() => {
    try {
      psqlAdmin(`DROP DATABASE IF EXISTS ${DB};`);
    } catch {
      // La base de prueba no tiene que sobrevivir al fallo de conexión.
    }
  });

  it('rechaza anónimo, orden inexistente, ajeno y pedido inexistente', () => {
    expect(errorText(asUser(null, `SELECT * FROM public.get_material_order_reveal('${ORDER_PAID}');`))).toMatch(
      /not_authenticated/,
    );
    expect(
      errorText(asUser(CLIENT, `SELECT * FROM public.get_material_order_reveal('${STRANGER}');`)),
    ).toMatch(/order_not_found/);
    expect(errorText(asUser(OWNER, `SELECT * FROM public.get_material_order_reveal('${ORDER_PAID}');`))).toMatch(
      /not_order_client/,
    );
    expect(errorText(asUser(STRANGER, `SELECT * FROM public.get_material_order_reveal('${ORDER_PAID}');`))).toMatch(
      /not_order_client/,
    );
    expect(
      errorText(asUser(CLIENT, `SELECT * FROM public.list_material_request_quote_reveals('${STRANGER}');`)),
    ).toMatch(/request_not_found/);
    expect(
      errorText(asUser(OWNER, `SELECT * FROM public.list_material_request_quote_reveals('${REQ_1}');`)),
    ).toMatch(/not_request_party/);
    expect(errorText(asUser(null, `SELECT public.list_my_material_solicitudes();`))).toMatch(
      /not_authenticated/,
    );
  });

  it('antes de pagar, cliente y profesional no ven PIN, teléfono ni dirección', () => {
    expect(reveal(CLIENT, ORDER_UNPAID)).toBe('null|null|null|null|false');
    expect(reveal(PRO, ORDER_UNPAID)).toBe('null|null|null|null|false');
    expect(quoteReveal(CLIENT, REQ_1, ORDER_UNPAID)).toBe('null|null|null|null');
    expect(quoteReveal(PRO, REQ_1, ORDER_UNPAID)).toBe('null|null|null|null');
    expect(myOrder(CLIENT, ORDER_UNPAID)).toBe('missing');
    expect(myOrder(PRO, ORDER_UNPAID)).toBe('missing');
    expect(psql(`SELECT verification_pin FROM public.orders WHERE id = '${ORDER_UNPAID}';`)).toBe('9999');
  });

  it('después de pagar, el cliente y el profesional ven PIN, teléfono y dirección', () => {
    expect(reveal(CLIENT, ORDER_PAID)).toBe('4242|1144440000|Calle Falsa 123|1001|true');
    expect(reveal(PRO, ORDER_PAID)).toBe('4242|1144440000|Calle Falsa 123|1001|true');
    expect(quoteReveal(CLIENT, REQ_1, ORDER_PAID)).toBe('4242|1144440000|Calle Falsa 123|1001');
    expect(quoteReveal(PRO, REQ_1, ORDER_PAID)).toBe('4242|1144440000|Calle Falsa 123|1001');
    expect(myOrder(CLIENT, ORDER_PAID)).toBe('4242|1144440000|Calle Falsa 123');
    expect(myOrder(PRO, ORDER_PAID)).toBe('4242|1144440000|Calle Falsa 123');
    expect(psql(`SELECT client_id FROM public.orders WHERE id = '${ORDER_PAID}';`)).toBe(CLIENT);
  });

  it('el dueño del comercio no ve el PIN, ni aunque haya creado la solicitud', () => {
    expect(errorText(asUser(OWNER, `SELECT * FROM public.get_material_order_reveal('${ORDER_PAID}');`))).toMatch(
      /not_order_client/,
    );
    expect(myOrder(OWNER, ORDER_PAID)).toBe('missing');
    expect(quoteReveal(SELF, REQ_2, ORDER_SELF)).toBe('null|null|null|2002');
    expect(reveal(SELF, ORDER_SELF)).toBe('null|null|null|2002|true');
    expect(myOrder(SELF, ORDER_SELF)).toBe('null|null|null');
    expect(reveal(CLIENT, ORDER_SELF)).toBe('5757|1155550000|Av Autocompra 9|2002|true');
    expect(myOrder(CLIENT, ORDER_SELF)).toBe('5757|1155550000|Av Autocompra 9');
    expect(quoteReveal(CLIENT, REQ_2, ORDER_SELF)).toBe('5757|1155550000|Av Autocompra 9|2002');
  });

  it('el comercio cierra la orden tipeando el PIN y un PIN incorrecto no la cierra', () => {
    expect(
      errorText(asUser(OWNER, `SELECT * FROM public.completar_orden_material_con_pin('3003', '9999');`)),
    ).toMatch(/deposit_not_paid/);
    expect(
      errorText(asUser(CLIENT, `SELECT * FROM public.completar_orden_material_con_pin('1001', '4242');`)),
    ).toMatch(/not_store_owner/);
    expect(
      errorText(asUser(OWNER, `SELECT * FROM public.completar_orden_material_con_pin('1001', '0000');`)),
    ).toMatch(/invalid_pin/);
    expect(psql(`SELECT status FROM public.orders WHERE id = '${ORDER_PAID}';`)).toBe('deposit_paid');

    expect(
      lastLine(asUser(OWNER, `SELECT status FROM public.completar_orden_material_con_pin('1001', '4242');`)),
    ).toBe('completed');
    expect(reveal(CLIENT, ORDER_PAID)).toBe('4242|1144440000|Calle Falsa 123|1001|true');
    expect(reveal(PRO, ORDER_PAID)).toBe('4242|1144440000|Calle Falsa 123|1001|true');
    expect(myOrder(CLIENT, ORDER_PAID)).toMatch(/^4242\|/);
    expect(
      errorText(asUser(OWNER, `SELECT * FROM public.get_material_order_reveal('${ORDER_PAID}');`)),
    ).toMatch(/not_order_client/);

    expect(reveal(SELF, ORDER_SELF)).toBe('null|null|null|2002|true');
    expect(
      lastLine(asUser(SELF, `SELECT status FROM public.completar_orden_material_con_pin('2002', '5757');`)),
    ).toBe('completed');
    expect(reveal(CLIENT, ORDER_SELF)).toBe('5757|1155550000|Av Autocompra 9|2002|true');
    expect(reveal(SELF, ORDER_SELF)).toBe('null|null|null|2002|true');
  });
});
