import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isJobAddressPaid,
  jobAddressCardMode,
  jobAddressWriteRejection,
  visibleJobAddressLabel,
} from './jobAddressCard';

const sql = readFileSync('supabase/20261026_card_96_direccion_temporal.sql', 'utf8');

function fnBody(name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION', start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe('dirección temporal del trabajo', () => {
  it('la tarjeta la ve solo el cliente, y desaparece después del pago', () => {
    expect(jobAddressCardMode({ role: 'trabajador', paid: false, confirmed: false })).toBe('hidden');
    expect(jobAddressCardMode({ role: null, paid: false, confirmed: false })).toBe('hidden');
    expect(jobAddressCardMode({ role: 'cliente', paid: true, confirmed: false })).toBe('hidden');
    expect(jobAddressCardMode({ role: 'cliente', paid: true, confirmed: true })).toBe('hidden');
    expect(jobAddressCardMode({ role: 'cliente', paid: false, confirmed: false })).toBe('confirm');
    expect(jobAddressCardMode({ role: 'cliente', paid: false, confirmed: true })).toBe('change');
    expect(isJobAddressPaid('seña_pagada')).toBe(true);
    expect(isJobAddressPaid('totalmente_pagado')).toBe(true);
    expect(isJobAddressPaid('pendiente_seña')).toBe(false);
    expect(isJobAddressPaid(null)).toBe(false);
  });

  it('la RPC rechaza si no es el cliente, si ya se pagó o si el punto no sirve', () => {
    const base = {
      isClient: true,
      deleted: false,
      paid: false,
      text: 'Volta 1140, Rosario',
      lat: -32.95,
      lng: -60.66,
    };
    expect(jobAddressWriteRejection(base)).toBeNull();
    expect(jobAddressWriteRejection({ ...base, isClient: false })).toBe('not_client');
    expect(jobAddressWriteRejection({ ...base, deleted: true })).toBe('not_client');
    expect(jobAddressWriteRejection({ ...base, paid: true })).toBe('paid');
    expect(jobAddressWriteRejection({ ...base, text: '   ' })).toBe('invalid');
    expect(jobAddressWriteRejection({ ...base, text: 'x'.repeat(301) })).toBe('invalid');
    expect(jobAddressWriteRejection({ ...base, lat: 0, lng: 0 })).toBe('invalid');
    expect(jobAddressWriteRejection({ ...base, lat: null, lng: -60 })).toBe('invalid');
    expect(jobAddressWriteRejection({ ...base, lat: 91, lng: -60 })).toBe('invalid');
    expect(jobAddressWriteRejection({ ...base, lat: -32, lng: 181 })).toBe('invalid');

    const setFn = fnBody('set_conversation_job_address');
    expect(setFn).toContain('not_conversation_client');
    expect(setFn).toContain('job_address_locked_after_payment');
    expect(setFn).toContain('invalid_job_address');
    expect(setFn).toContain("v_uid IS DISTINCT FROM v_cliente");
    expect(setFn).toContain("estado_pago IN ('seña_pagada', 'totalmente_pagado')");
    expect(setFn).toContain('p_lat = 0 AND p_lng = 0');
    expect(setFn).toContain('PERFORM public.set_my_direccion_exacta');
    expect(setFn).toContain('PERFORM public.update_profile_geo_coverage');
    expect(setFn).toContain('SECURITY DEFINER');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.set_conversation_job_address(uuid, text, double precision, double precision, boolean) FROM anon',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.set_conversation_job_address(uuid, text, double precision, double precision, boolean) TO authenticated',
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.set_conversation_job_address[^;]*TO anon/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.confirm_conversation_job_address[^;]*TO anon/);
  });

  it('el cliente ve el texto, nunca un par de coordenadas', () => {
    expect(visibleJobAddressLabel('  Mitre  500 ', 'Perfil 1')).toBe('Mitre 500');
    expect(visibleJobAddressLabel(null, '  Perfil 1  ')).toBe('Perfil 1');
    expect(visibleJobAddressLabel('', '')).toBe('');
    expect(visibleJobAddressLabel('-32.9442, -60.6505', 'Perfil')).toBe('-32.9442, -60.6505');
    expect(visibleJobAddressLabel(null, 'Perfil')).not.toMatch(/^-?\d+\.\d+$/);
  });

  it('con dirección temporal la distancia cambia de fuente y el profesional no recibe el punto', () => {
    const distance = fnBody('distancia_aprox_chat');
    expect(distance.indexOf('conversation_job_address')).toBeLessThan(distance.indexOf('direccion_lat'));
    expect(distance).toContain("RETURN 'menos de 1 km'");
    expect(distance).toContain('v_km <= 10');
    expect(distance).toContain('round(v_km * 2) / 2');
    expect(distance).toContain('round(v_km, 0)');
    expect(distance).toContain("v_label !~ '^[0-9]+(,[0-9])?$'");
    expect(distance).toContain('auth.uid() IS DISTINCT FROM v_trabajador');
    expect(distance).toContain('RETURNS text');
    expect(distance).not.toMatch(/RETURNS TABLE/i);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.distancia_aprox_chat(uuid) FROM anon');
    expect(sql).not.toContain('GRANT EXECUTE ON FUNCTION public.distancia_aprox_chat(uuid) TO anon');
    expect(sql).toContain('dd6fe793763ea5fd5bfaf8f276e681ca');
    const store = fnBody('get_store_request_client_address');
    expect(store).toContain('conversation_job_address');
    expect(store).toContain('is_store_owner');
    expect(store).not.toContain('ST_Y');
    expect(store).not.toContain('verification_pin');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_store_request_client_address(uuid, uuid) FROM anon');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.get_store_request_client_address[^;]*TO anon/);

    expect(sql).toContain('86fa0f176593602bfd4315d6a7a97dc2');
    expect(sql).toContain('e97eb5d8c39119b8af0e72625b2296b4');
    expect(sql).toContain('87587b575c0d60d2dfe9b6d9d311a623');
    expect(sql).toContain('b63b3abb85892a049d9ce7df0133fcb6');

    const delivery = fnBody('get_conversation_client_delivery_address');
    expect(delivery.indexOf('conversation_job_address')).toBeLessThan(delivery.indexOf('p.direccion_texto'));
    expect(delivery).toContain('k.conversation_id = p_conversation_id');
    expect(delivery).toContain('auth.uid() IS DISTINCT FROM v_cliente AND NOT v_paid_here');
    expect(delivery).not.toContain('k.worker_id = v_trabajador');
    expect(delivery).not.toContain('round(');
    expect(delivery).toContain("estado_pago IN ('seña_pagada', 'totalmente_pagado')");

    const exact = fnBody('obtener_direccion_cliente');
    expect(exact).toContain("RAISE EXCEPTION 'Dirección no disponible hasta pagar la seña'");
    expect(exact.indexOf('conversation_job_address')).toBeLessThan(exact.indexOf('p.direccion_texto'));

    const materials = fnBody('material_requests_apply_client_job_address');
    expect(materials.indexOf('conversation_job_address')).toBeLessThan(materials.indexOf('p.direccion_texto'));
    expect(materials).toContain('k.conversation_id = NEW.conversation_id');
    expect(materials).not.toContain('k.worker_id = v_trabajador');
    expect(materials).not.toContain('round(');
    expect(materials).toContain('NEW.client_address := v_address');
    expect(materials).toContain('CASE WHEN v_paid_here THEN v_lat ELSE NULL END');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.material_requests_apply_client_job_address() FROM anon',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.material_requests_apply_client_job_address() FROM authenticated',
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.material_requests_apply_client_job_address\(\) TO anon/,
    );
  });

  it('Realtime solo publica el tick: la dirección no está en conversations ni en la publicación', () => {
    const alter = sql.slice(
      sql.indexOf('ALTER TABLE public.conversations'),
      sql.indexOf('COMMENT ON COLUMN public.conversations.job_address_updated_at'),
    );
    expect(alter).toContain('job_address_updated_at timestamptz');
    expect(alter).not.toContain('job_address_text');
    expect(alter).not.toContain('job_lat');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('conversation_job_address_select_client');
    expect(sql).toContain('c.cliente_id = auth.uid()');
    expect(sql).not.toMatch(/POLICY conversation_job_address[\s\S]*FOR INSERT/);
    expect(sql).not.toMatch(/POLICY conversation_job_address[\s\S]*FOR UPDATE/);
    expect(sql).not.toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE[^;]*conversation_job_address/);
    expect(sql).toContain('REVOKE ALL ON TABLE public.conversation_job_address FROM anon');
    expect(sql).not.toMatch(/GRANT[^;]*ON TABLE public\.conversation_job_address TO anon/);

    const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const gate = chat.slice(chat.indexOf("participants?.myRole === 'cliente'"), chat.indexOf('<KeyboardAvoidingView'));
    expect(gate).toContain('<JobAddressBanner');
    expect(gate).toContain('role="cliente"');
    expect(chat).toContain('subscribeConversationDistanceTick');
    expect(chat).not.toContain('conversation_job_address');
    expect(chat).not.toContain('job_lat');
    expect(chat).not.toContain('job_address_text');

    const realtime = readFileSync('src/services/chatSupabase.ts', 'utf8');
    const tick = realtime.slice(
      realtime.indexOf('function subscribeConversationDistanceTick'),
      realtime.indexOf('function fetchApproxChatDistanceKm'),
    );
    expect(tick).toContain('job_address_updated_at');
    expect(tick).toContain("table: 'conversations'");
    expect(tick).not.toContain('job_address_text');
    expect(tick).not.toContain('job_lat');
    expect(tick).not.toContain('conversation_job_address');
  });
});
