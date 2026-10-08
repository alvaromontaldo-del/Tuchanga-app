import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clientMapsUrls } from './clientMaps';

const VOLTA = {
  lat: -33.3037563,
  lng: -60.2413808,
  direccionTexto: 'Alejandro Volta 1140, Parque Sarmiento',
};

describe('abrir Maps en la dirección del cliente', () => {
  it('busca el texto y no manda solo las coordenadas', () => {
    const urls = clientMapsUrls(VOLTA);
    expect(urls.web).toBe(
      'https://www.google.com/maps/search/?api=1&query=Alejandro%20Volta%201140%2C%20Parque%20Sarmiento',
    );
    expect(urls.android).toBe(
      'geo:-33.3037563,-60.2413808?q=Alejandro%20Volta%201140%2C%20Parque%20Sarmiento',
    );
    expect(urls.ios).toBe(
      'maps://?q=Alejandro%20Volta%201140%2C%20Parque%20Sarmiento&sll=-33.3037563,-60.2413808',
    );
    expect(urls.iosGoogle).toBe(
      'comgooglemaps://?q=Alejandro%20Volta%201140%2C%20Parque%20Sarmiento&center=-33.3037563,-60.2413808',
    );
    expect(urls.web).not.toContain('-33.3037563');
    expect(urls.android).not.toContain('?q=-33.3037563,-60.2413808');
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
    expect(urls.ios).toContain('sll=-33.3037563,-60.2413808');
  });

  it('el detalle del servicio abre Maps con la dirección, no solo con lat/lng', () => {
    const screen = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
    expect(screen).toContain('openClientInMaps');
    expect(screen).toContain('direccionData.direccion_texto');
    expect(screen).not.toContain('geo:${lat},${lng}?q=${lat},${lng}');
    expect(screen).not.toContain('query=${lat},${lng}');
  });
});
