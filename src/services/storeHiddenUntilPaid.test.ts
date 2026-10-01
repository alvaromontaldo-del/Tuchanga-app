import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * La app no pide stores.phone, stores.address ni orders.verification_pin
 * en un select directo. Esos campos salen de un RPC después del fee.
 */
const FILES = [
  'src/services/clientQuotesSupabase.ts',
  'src/services/clientMaterialPickupsSupabase.ts',
  'src/services/materialRequestsSupabase.ts',
  'src/services/storeRegistrationSupabase.ts',
  'src/services/storeQuotesSupabase.ts',
];

function selectClauses(src: string): string[] {
  const out: string[] = [];
  const re = /\.select\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    out.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  const consts = /const (?:ORDER_COLUMNS|QUOTE_EMBED|SELECT_[A-Z0-9_]+) = `([^`]*)`/g;
  while ((match = consts.exec(src))) {
    out.push(match[1] ?? '');
  }
  return out;
}

describe('comercio oculto hasta pagar', () => {
  it('los select de stores, orders y materiales no piden teléfono, dirección ni PIN', () => {
    for (const file of FILES) {
      const selects = selectClauses(readFileSync(file, 'utf8'));
      expect(selects.length, file).toBeGreaterThan(0);
      for (const clause of selects) {
        expect(clause, file).not.toMatch(/\*/);
        expect(clause, file).not.toMatch(/\bverification_pin\b/);
        expect(clause, file).not.toMatch(/\bphone\b/);
        expect(clause, file).not.toMatch(/\baddress\b/);
      }
    }
  });

  it('el detalle y los retiros usan el RPC de revelado', () => {
    const quotes = readFileSync('src/services/clientQuotesSupabase.ts', 'utf8');
    const pickups = readFileSync('src/services/clientMaterialPickupsSupabase.ts', 'utf8');
    const edit = readFileSync('src/services/storeRegistrationSupabase.ts', 'utf8');
    expect(quotes).toContain('get_material_order_reveal');
    expect(quotes).toContain('list_material_request_quote_reveals');
    expect(pickups).toContain('list_my_material_solicitudes');
    expect(pickups).toContain('get_material_order_reveal');
    expect(edit).toContain('get_my_store_contact');
  });
});
