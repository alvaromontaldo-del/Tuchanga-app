import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PIN visible para el profesional que retira', () => {
  it('la comparación muestra el PIN cuando el RPC lo devuelve, también en solo lectura', () => {
    const compare = readFileSync('src/screens/client/ClientCompareQuotesScreen.tsx', 'utf8');
    const contact = compare.slice(compare.indexOf('styles.contactBlock'));
    expect(contact).toContain('card.verificationPin');
    expect(contact).toContain('card.storePhone');
    expect(contact).not.toContain('!readOnly && (card.orderCode || card.verificationPin)');
    expect(contact).toContain('!readOnly || card.orderCode || card.verificationPin');
  });

  it('el detalle de la orden muestra el PIN y el teléfono que devolvió el RPC', () => {
    const detail = readFileSync('src/screens/client/MaterialOrderDetailScreen.tsx', 'utf8');
    expect(detail).toContain('r.verificationPin');
    expect(detail).toContain('r.storePhone');
    expect(detail).toContain('r.storeAddress');
  });

  it('Mis pedidos arma la tarjeta con el PIN y el teléfono del RPC', () => {
    const pickups = readFileSync('src/screens/client/ClientMaterialPickupsScreen.tsx', 'utf8');
    const mapper = readFileSync('src/utils/clientMaterialPickups.ts', 'utf8');
    expect(pickups).toContain('content.pinDisplay');
    expect(mapper).toContain('formatPin(row.verification_pin)');
    expect(mapper).toContain('row.store_phone');
    expect(mapper).toContain('Teléfono del comercio');
  });
});
