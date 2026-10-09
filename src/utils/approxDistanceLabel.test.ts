import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { approxDistanceCaption, showChatHeaderSubtitle } from './approxDistanceLabel';

describe('distancia aproximada del chat', () => {
  it('arma la frase y descarta coordenadas o texto inesperado', () => {
    expect(approxDistanceCaption('3,5')).toBe('a 3,5 km aprox.');
    expect(approxDistanceCaption('12')).toBe('a 12 km aprox.');
    expect(approxDistanceCaption('  menos de 1 km  ')).toBe('menos de 1 km');
    expect(approxDistanceCaption(null)).toBeNull();
    expect(approxDistanceCaption('')).toBeNull();
    expect(approxDistanceCaption('3.2')).toBeNull();
    expect(approxDistanceCaption('-34,603')).toBeNull();
    expect(approxDistanceCaption('-58,3817')).toBeNull();
    expect(approxDistanceCaption('Volta 1140')).toBeNull();
  });

  it('el cliente no pierde un subtítulo de oficio y el profesional cede «Cliente»', () => {
    expect(showChatHeaderSubtitle('Cliente', 'a 3,5 km aprox.')).toBe(false);
    expect(showChatHeaderSubtitle('Cliente', null)).toBe(true);
    expect(showChatHeaderSubtitle('Reclamo · Instalación', 'a 4 km aprox.')).toBe(true);
    expect(showChatHeaderSubtitle('Plomería', null)).toBe(true);
    expect(showChatHeaderSubtitle('   ', 'a 2 km aprox.')).toBe(false);
  });

  it('la RPC no devuelve coordenadas y anon no ejecuta', () => {
    const sql = readFileSync('supabase/20261009_distancia_aprox_chat.sql', 'utf8');
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.distancia_aprox_chat'));
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path TO 'public'");
    expect(body).toContain('RETURNS text');
    expect(body).toContain('auth.uid() IS DISTINCT FROM v_trabajador');
    expect(body).toContain('p.direccion_lat');
    expect(body).toContain('p.direccion_lng');
    expect(body).toContain('p.location');
    expect(body).toContain("RETURN 'menos de 1 km'");
    expect(body).toContain('v_km <= 10');
    expect(body).toContain('round(v_km * 2) / 2');
    expect(body).toContain('round(v_km, 0)');
    expect(body).not.toMatch(/RETURNS TABLE/i);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.distancia_aprox_chat(uuid) FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.distancia_aprox_chat(uuid) TO authenticated');
    expect(sql).not.toContain('GRANT EXECUTE ON FUNCTION public.distancia_aprox_chat(uuid) TO anon');
  });

  it('el encabezado la muestra solo al profesional y no achica el nombre', () => {
    const src = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const nameBlock = src.slice(src.indexOf('styles.headerNameColumn'), src.indexOf('styles.headerChipsInline'));
    expect(nameBlock).toContain('adjustsFontSizeToFit');
    expect(nameBlock).toContain('minimumFontScale={0.7}');
    expect(nameBlock.match(/adjustsFontSizeToFit/g)).toHaveLength(2);

    const header = src.slice(src.indexOf('<View style={styles.header}>'), src.indexOf('<KeyboardAvoidingView'));
    expect(header.indexOf('styles.headerTopRow')).toBeLessThan(header.indexOf('styles.headerDistanceRow'));
    expect(header).toContain('name="location-outline"');
    expect(header).toContain('size={11}');
    expect(header).toContain('color={colors.textSecondary}');
    expect(header).toContain('{distanceCaption}');
    expect(header.split('styles.headerTopRow').length - 1).toBe(1);
    expect(src).toContain("participants?.myRole !== 'trabajador'");
    expect(src).toContain('fetchApproxChatDistanceKm');
    expect(src).not.toContain('direccion_lat');
    expect(src).not.toContain('direccion_lng');
  });
});
