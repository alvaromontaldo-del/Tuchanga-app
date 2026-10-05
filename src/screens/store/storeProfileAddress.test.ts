import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function assertStoreAddressLayout(source: string) {
  const addressBlock = sliceBetween(source, 'Teléfono / WhatsApp', '<StoreOpeningHoursEditor');
  expect(addressBlock).toContain('<AddressDeliveryField');
  expect(addressBlock).toContain('label="Dirección *"');
  expect(addressBlock).toContain('showUseCurrentLocation={false}');
  expect(addressBlock).toContain('showMap');
  expect(addressBlock).toContain('onGeoChange');
  expect(addressBlock).toContain('setLat(point.lat)');
  expect(addressBlock).toContain('setLng(point.lng)');
  expect(addressBlock).toContain('elegí una sugerencia para ver el mapa');
  expect(addressBlock).not.toContain('<AppTextInput');
  expect(addressBlock).not.toContain('<LocationMap');
  expect(addressBlock).not.toContain('onLocateMe');
  expect(addressBlock).not.toContain('Usar mi ubicación');
  expect(addressBlock).not.toContain('Usar ubicación GPS');
  expect(addressBlock).not.toContain('Ubicación del local');

  const afterHours = sliceBetween(source, '<StoreOpeningHoursEditor', 'Rubros *');
  expect(afterHours).not.toContain('AddressDeliveryField');
  expect(afterHours).not.toContain('<LocationMap');
  expect(afterHours).not.toContain('Usar mi ubicación');
  expect(afterHours).not.toContain('height: 220');
  expect(afterHours).not.toContain("overflow: 'hidden'");

  expect(source).toContain('<StoreOpeningHoursEditor');
  expect(source).toContain('Elegí una dirección de las sugerencias para ubicar el local.');
  expect(source).not.toContain('GPS o mapa');
  expect(source).not.toContain('getHighAccuracyPosition');
  expect(source).not.toContain('Usar mi ubicación (GPS)');
  expect(source).not.toContain('onLocateMe');
  expect(source).not.toContain('<LocationMap');
  expect(source).not.toContain('height: 220');
  expect(source).not.toContain("overflow: 'hidden'");
}

describe('perfil de comercio: dirección con buscador y mapa juntos', () => {
  it('el alta del local busca la calle, muestra el mapa al lado y no ofrece GPS', () => {
    assertStoreAddressLayout(readFileSync('src/screens/store/RegisterStoreScreen.tsx', 'utf8'));
  });

  it('la edición del local busca la calle, muestra el mapa al lado y no ofrece GPS', () => {
    assertStoreAddressLayout(readFileSync('src/screens/store/EditStoreScreen.tsx', 'utf8'));
  });
});
