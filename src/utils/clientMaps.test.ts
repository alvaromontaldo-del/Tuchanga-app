import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clientMapsUrls } from './clientMaps';

const VOLTA = {
  lat: -33.3037563,
  lng: -60.2413808,
  direccionTexto: 'Alejandro Volta 1140, Parque Sarmiento',
};

const VOLTA_COMPLETA =
  'Alejandro Volta 1140, Parque Sarmiento, San Nicolás de los Arroyos, Partido de San Nicolás, Buenos Aires';

describe('abrir Maps en la dirección del cliente', () => {
  it('Volta 1140 Parque Sarmiento clava el pin y no busca el texto que cae en CABA', () => {
    const urls = clientMapsUrls(VOLTA);
    const pin = encodeURIComponent('-33.3037563,-60.2413808(Alejandro Volta 1140, Parque Sarmiento)');
    expect(urls.web).toBe(`https://www.google.com/maps/search/?api=1&query=${pin}`);
    expect(urls.web).toContain('-33.3037563');
    expect(urls.web).not.toBe(
      'https://www.google.com/maps/search/?api=1&query=Alejandro%20Volta%201140%2C%20Parque%20Sarmiento',
    );
    expect(urls.android).toBe(
      'geo:0,0?q=-33.3037563,-60.2413808(Alejandro%20Volta%201140%2C%20Parque%20Sarmiento)',
    );
    expect(urls.ios).toBe(
      'maps://?ll=-33.3037563,-60.2413808&q=Alejandro%20Volta%201140%2C%20Parque%20Sarmiento',
    );
    expect(urls.iosGoogle).toContain('center=-33.3037563,-60.2413808');
    expect(urls.ios).not.toContain('sll=');
  });

  it('sin texto sigue abriendo el punto', () => {
    const urls = clientMapsUrls({ lat: VOLTA.lat, lng: VOLTA.lng, direccionTexto: '   ' });
    expect(urls.web).toBe(
      'https://www.google.com/maps/search/?api=1&query=-33.3037563,-60.2413808',
    );
    expect(urls.android).toBe('geo:-33.3037563,-60.2413808?q=-33.3037563,-60.2413808');
    expect(urls.ios).toBe('maps://?daddr=-33.3037563,-60.2413808');
    expect(urls.iosGoogle).toBeNull();
  });

  it('sin localidad clava el pin en las coordenadas con el texto de etiqueta', () => {
    const urls = clientMapsUrls({
      lat: VOLTA.lat,
      lng: VOLTA.lng,
      direccionTexto: 'Volta 1140',
    });
    expect(urls.android).toBe('geo:0,0?q=-33.3037563,-60.2413808(Volta%201140)');
    expect(urls.web).toContain('query=-33.3037563%2C-60.2413808');
    expect(urls.ios).toContain('ll=-33.3037563,-60.2413808');
  });

  it('sin coordenadas busca la dirección completa y le agrega Argentina', () => {
    const urls = clientMapsUrls({
      lat: null,
      lng: null,
      direccionTexto: VOLTA.direccionTexto,
      direccionCompleta: VOLTA_COMPLETA,
    });
    const query = encodeURIComponent(`${VOLTA_COMPLETA}, Argentina`);
    expect(urls.web).toBe(`https://www.google.com/maps/search/?api=1&query=${query}`);
    expect(urls.android).toBe(`geo:0,0?q=${query}`);
    expect(urls.ios).toBe(`maps://?q=${query}`);
    expect(urls.web).toContain('Partido%20de%20San%20Nicol%C3%A1s');
    expect(urls.web).not.toContain('-33.3037563');
  });

  it('sin dirección completa el fallback usa el texto corto y Argentina', () => {
    const urls = clientMapsUrls({
      lat: 0,
      lng: 0,
      direccionTexto: VOLTA.direccionTexto,
    });
    expect(urls.web).toContain(
      encodeURIComponent('Alejandro Volta 1140, Parque Sarmiento, Argentina'),
    );
  });

  it('el detalle del servicio abre Maps con el pin y muestra la calle recién paga', () => {
    const screen = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
    expect(screen).toContain('openClientInMaps');
    expect(screen).toContain('direccionData.direccion_texto');
    expect(screen).toContain('direccionCompleta: direccionData.direccion_completa');
    expect(screen).toContain("estado_pago !== 'pendiente_seña'");
    expect(screen).not.toContain('geo:${lat},${lng}?q=${lat},${lng}');
    expect(screen).not.toContain('query=${lat},${lng}');
  });
});
