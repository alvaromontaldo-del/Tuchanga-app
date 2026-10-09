import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCompleteAddress,
  formatCompleteAddress,
  formatShortAddress,
  mapsQueryWithArgentina,
} from './formatAddress';

describe('dirección completa para el pin', () => {
  it('arma localidad, partido y provincia y la ficha corta los saca', () => {
    const full = buildCompleteAddress(
      {
        road: 'Alejandro Volta',
        house_number: '1140',
        suburb: 'Parque Sarmiento',
        city: 'San Nicolás de los Arroyos',
        county: 'San Nicolás',
        state: 'Buenos Aires',
      },
    );
    expect(full).toBe(
      'Alejandro Volta 1140, Parque Sarmiento, San Nicolás de los Arroyos, Partido de San Nicolás, Buenos Aires',
    );
    expect(formatShortAddress(full)).not.toMatch(/Partido de San Nicolás|Buenos Aires/);
    expect(formatShortAddress(full)).toMatch(/Parque Sarmiento/);
  });

  it('el display_name pierde el país y el CPA, no el partido', () => {
    const full = formatCompleteAddress(
      'Alejandro Volta, Parque Sarmiento, San Nicolás de los Arroyos, Partido de San Nicolás, Buenos Aires, B2900, Argentina',
    );
    expect(full).toBe(
      'Alejandro Volta, Parque Sarmiento, San Nicolás de los Arroyos, Partido de San Nicolás, Buenos Aires',
    );
    expect(mapsQueryWithArgentina(full)).toMatch(/, Argentina$/);
    expect(mapsQueryWithArgentina(`${full}, Argentina`)).toBe(`${full}, Argentina`);
  });
});

describe('SQL de ubicación exacta', () => {
  const sql = readFileSync('supabase/20261009_card_206_direccion_exacta.sql', 'utf8');

  it('agrega las columnas, no abre la dirección antes del pago y no da EXECUTE a anon', () => {
    expect(sql).toContain('direccion_lat double precision');
    expect(sql).toContain('direccion_lng double precision');
    expect(sql).toContain('direccion_completa text');
    expect(sql).toContain('set_my_direccion_exacta');
    expect(sql).toContain("RAISE EXCEPTION 'Dirección no disponible hasta pagar la seña'");
    expect(sql).toContain("RAISE EXCEPTION 'Solo el trabajador puede ver la dirección'");
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.set_my_direccion_exacta');
    expect(sql).toContain('FROM anon');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.set_my_direccion_exacta[\s\S]*TO anon/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.obtener_direccion_cliente\(uuid\) TO anon/);
  });
});

describe('script de direcciones viejas', () => {
  const script = readFileSync('supabase/scripts/backfill_direccion_exacta.mjs', 'utf8');

  it('usa Nominatim y avisa que no hace falta una clave nueva', () => {
    expect(script).toContain('nominatim.openstreetmap.org');
    expect(script).toContain('sin clave nueva');
    expect(script).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(script).not.toMatch(/GOOGLE_MAPS_API_KEY|GEOCODING_API_KEY/);
  });
});
