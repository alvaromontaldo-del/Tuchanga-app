import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PIN que tipea el comercio', () => {
  const files = [
    'src/screens/store/StoreMaterialRequestsScreen.tsx',
    'src/screens/store/StoreCloseOrderScreen.tsx',
  ];

  it('muestra los dígitos en claro, con teclado numérico y el largo del PIN', () => {
    const orderCode = readFileSync('src/utils/orderCode.ts', 'utf8');
    expect(orderCode).toContain('export const PIN_LENGTH = 4');
    expect(orderCode).toContain('slice(0, PIN_LENGTH)');
    expect(orderCode).toContain("padStart(PIN_LENGTH, '0')");

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const pinStart = src.indexOf(file.endsWith('StoreCloseOrderScreen.tsx') ? '>PIN<' : 'PIN del cliente');
      const pinBlock = src.slice(pinStart, src.indexOf('style={styles.pinInput}', pinStart));
      expect(pinBlock, file).not.toContain('secureTextEntry');
      expect(pinBlock, file).toContain('keyboardType="number-pad"');
      expect(pinBlock, file).toContain('maxLength={PIN_LENGTH}');
      expect(pinBlock, file).toContain('placeholder="0000"');
      expect(src, file).toContain('letterSpacing: 8');
      expect(src, file).toContain('fontSize: 22');
      expect(src, file).not.toMatch(/\bverification_pin\b/);
      expect(src, file).not.toMatch(/\bverificationPin\b/);
      expect(src, file).toContain('completarOrdenMaterialConPin');
    }
  });
});

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

  it('el reveal toma stores.opening_hours y no arma un horario fijo', () => {
    const src = readFileSync('src/services/clientQuotesSupabase.ts', 'utf8');
    const start = src.indexOf('export async function fetchMaterialOrderReveal');
    const end = src.indexOf('\nexport async function', start + 20);
    const body = src.slice(start, end === -1 ? undefined : end);
    const helperStart = src.indexOf('async function fetchOrderStoreOpeningHours');
    const helper = src.slice(helperStart, start);
    expect(body).toContain('store_opening_hours');
    expect(body).toContain('materialRevealOpeningHoursLabel');
    expect(body).toContain('fetchOrderStoreOpeningHours');
    expect(body).toContain('openingHoursRaw == null');
    expect(helper).toContain("select('quotes(stores(opening_hours))')");
    expect(body).not.toMatch(/\d{2}:\d{2}/);
    expect(helper).not.toMatch(/\bphone\b/);
    expect(helper).not.toMatch(/\baddress\b/);
  });

  it('tras pagar, el detalle muestra el horario del comercio junto a dirección y teléfono', () => {
    const detail = readFileSync('src/screens/client/MaterialOrderDetailScreen.tsx', 'utf8');
    const paid = detail.slice(detail.indexOf('reveals.map'));
    expect(paid).toContain('Dir:');
    expect(paid).toContain('Tel:');
    expect(paid).toContain('Horarios:');
    expect(paid).toContain('r.openingHoursLabel');
    expect(paid).toContain('No especificado');
    const unpaid = detail.slice(0, detail.indexOf('reveals.map'));
    expect(unpaid).not.toContain('Horarios:');
  });

  it('Mis pedidos arma la tarjeta con el PIN y el teléfono del RPC', () => {
    const pickups = readFileSync('src/screens/client/ClientMaterialPickupsScreen.tsx', 'utf8');
    const mapper = readFileSync('src/utils/clientMaterialPickups.ts', 'utf8');
    expect(pickups).toContain('content.pinDisplay');
    expect(pickups).toContain('content.totalLabel');
    expect(pickups).not.toContain('Total a abonar en el comercio');
    expect(mapper).toContain('formatPin(row.verification_pin)');
    expect(mapper).toContain('row.store_phone');
    expect(mapper).toContain('Teléfono del comercio');
    expect(mapper).toContain('Total abonado al comercio');
    expect(mapper).toContain("card.section === 'historial'");
  });
});
