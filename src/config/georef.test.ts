import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNominatimSuggestions } from './nominatim';
import {
  fetchGeorefAddressHits,
  parseCalles,
  parseDirecciones,
  parseUbicacion,
  prettyGeorefStreet,
  probeHeightsNear,
  resetGeorefCacheForTests,
  scopeFromUbicacion,
} from './georef';
import {
  clearAddressHeightRejections,
  enrichPositionedHits,
  type GeocodeHit,
} from '../utils/streetAddressQuery';

const snUbicacion = {
  ubicacion: {
    lat: -33.33,
    lon: -60.22,
    provincia: { id: '06', nombre: 'Buenos Aires' },
    departamento: { id: '06763', nombre: 'San Nicolás' },
    municipio: { id: '060763', nombre: 'San Nicolás' },
  },
};

const cabaUbicacion = {
  ubicacion: {
    lat: -34.588,
    lon: -58.43,
    provincia: { id: '02', nombre: 'Ciudad Autónoma de Buenos Aires' },
    departamento: { id: '02098', nombre: 'Comuna 14' },
  },
};

const voltaDirecciones = {
  cantidad: 2,
  direcciones: [
    {
      altura: { valor: 1140 },
      calle: { categoria: 'CALLE', id: '0676305003255', nombre: 'VOLTA' },
      departamento: { id: '06763', nombre: 'San Nicolás' },
      localidad_censal: { id: '06763050', nombre: 'San Nicolás de los Arroyos' },
      nomenclatura: 'VOLTA 1140, San Nicolás, Buenos Aires',
      ubicacion: { lat: -33.303482816028556, lon: -60.24172695049173 },
    },
    {
      altura: { valor: 1140 },
      calle: { categoria: 'CALLE', id: '0676305003255', nombre: 'VOLTA' },
      departamento: { id: '06763', nombre: 'San Nicolás' },
      localidad_censal: { id: '06763050', nombre: 'San Nicolás de los Arroyos' },
      nomenclatura: 'VOLTA 1140, San Nicolás, Buenos Aires',
      ubicacion: { lat: -33.29210752768384, lon: -60.255660594616664 },
    },
  ],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetGeorefCacheForTests();
  clearAddressHeightRejections();
});

describe('Georef', () => {
  it('formatea el nombre de la calle y no recorta CABA a la comuna del usuario', () => {
    expect(prettyGeorefStreet('AV SANTA FE', 'AV')).toBe('Avenida Santa Fe');
    expect(prettyGeorefStreet('BARTOLOME MITRE', 'CALLE')).toBe('Bartolome Mitre');
    expect(prettyGeorefStreet('DE LA NACION', null)).toBe('De la Nacion');
    const caba = parseUbicacion(cabaUbicacion);
    expect(caba).not.toBeNull();
    expect(scopeFromUbicacion(caba!)).toEqual({
      provincia: 'Ciudad Autónoma de Buenos Aires',
    });
    const sn = parseUbicacion(snUbicacion);
    expect(scopeFromUbicacion(sn!)).toEqual({
      provincia: 'Buenos Aires',
      departamento: 'San Nicolás',
    });
  });

  it('para un hueco como Chiclana 148 prueba alturas cercanas, no el 9000', () => {
    const heights = probeHeightsNear(148, [{ min: 0, max: 561 }]);
    expect(heights).toContain(200);
    expect(heights.every((height) => Math.abs(height - 148) <= 200)).toBe(true);
    expect(heights).not.toContain(9000);
    expect(probeHeightsNear(1140, [{ min: 1801, max: 1900 }])).toEqual([]);
  });

  it('lee los dos Volta 1140 y descarta un homónimo que no es la calle', () => {
    const hits = parseDirecciones(
      {
        direcciones: [
          ...voltaDirecciones.direcciones,
          {
            calle: { id: 'x', nombre: 'GUARDIAS NACIONALES', categoria: 'CALLE' },
            localidad_censal: { nombre: 'San Nicolás de los Arroyos' },
            nomenclatura: 'GUARDIAS NACIONALES 1140',
            ubicacion: { lat: -33.32, lon: -60.22 },
          },
        ],
      },
      'Volta',
      'interpolated',
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]?.lat).toBeCloseTo(-33.30348, 4);
    expect(hits[1]?.lat).toBeCloseTo(-33.29211, 4);
    expect(hits.every((hit) => hit.positionQuality === 'interpolated')).toBe(true);
    expect(hits[0]?.parts.city).toBe('San Nicolás de los Arroyos');
  });

  it('arma el rango de Chiclana y de Garibaldi', () => {
    const ranges = parseCalles(
      {
        calles: [
          {
            id: '0676305001640',
            nombre: 'CHICLANA',
            categoria: 'CALLE',
            altura: { inicio: { derecha: 0, izquierda: 0 }, fin: { derecha: 561, izquierda: 350 } },
            localidad_censal: { nombre: 'San Nicolás de los Arroyos' },
          },
          {
            id: 'otro',
            nombre: 'VOLTAIRE',
            categoria: 'CALLE',
            altura: { inicio: { derecha: 0, izquierda: 0 }, fin: { derecha: 100, izquierda: 100 } },
            localidad_censal: { nombre: 'San Nicolás de los Arroyos' },
          },
        ],
      },
      'Chiclana',
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.range).toEqual({ min: 0, max: 561 });
    expect(ranges[0]?.locality).toBe('San Nicolás de los Arroyos');
  });

  it('si Georef no responde, Nominatim sigue y no se cae', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('nominatim.openstreetmap.org')) {
        return jsonResponse([
          {
            place_id: 17380512,
            lat: '-34.56833',
            lon: '-58.43660',
            display_name: 'Volta, Las Cañitas, Palermo, Buenos Aires, Argentina',
            class: 'highway',
            address: {
              road: 'Volta',
              neighbourhood: 'Las Cañitas',
              suburb: 'Palermo',
              city: 'Buenos Aires',
            },
          },
        ]);
      }
      throw new Error('georef caído');
    });
    vi.stubGlobal('fetch', fetchMock);

    const suggestions = await fetchNominatimSuggestions('Volta 1140', {
      countryCode: 'ar',
      near: { lat: -34.588, lng: -58.43 },
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.address).toContain('1140');
    expect(suggestions[0]?.address).toContain('Las Cañitas');
    expect(suggestions[0]?.lat).toBeCloseTo(-34.56833, 4);
  });

  it('Chiclana 148 en San Nicolás usa el ancla del 200 y no el tramo del usuario', async () => {
    const moreno = {
      place_id: 1,
      lat: '-33.31547',
      lon: '-60.25305',
      display_name: 'Felipe Chiclana, Moreno, San Nicolás de los Arroyos, Argentina',
      class: 'highway',
      address: {
        road: 'Felipe Chiclana',
        suburb: 'Moreno',
        city: 'San Nicolás de los Arroyos',
      },
    };
    const parque = {
      place_id: 2,
      lat: '-33.30580',
      lon: '-60.24257',
      display_name: 'Felipe Chiclana, Parque Sarmiento, San Nicolás de los Arroyos, Argentina',
      class: 'highway',
      address: {
        road: 'Felipe Chiclana',
        suburb: 'Parque Sarmiento',
        city: 'San Nicolás de los Arroyos',
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse([moreno, parque]);
      if (url.includes('/ubicacion')) return jsonResponse(snUbicacion);
      if (url.includes('/calles')) {
        return jsonResponse({
          calles: [
            {
              id: '0676305001640',
              nombre: 'CHICLANA',
              categoria: 'CALLE',
              altura: { inicio: { derecha: 0, izquierda: 0 }, fin: { derecha: 561, izquierda: 350 } },
              localidad_censal: { nombre: 'San Nicolás de los Arroyos' },
            },
          ],
        });
      }
      if (url.includes('/direcciones') && init?.method === 'POST') {
        return jsonResponse({
          resultados: [
            { parametros: { direccion: { altura: { valor: '100' } } }, direcciones: [], total: 0 },
            { parametros: { direccion: { altura: { valor: '150' } } }, direcciones: [], total: 0 },
            {
              parametros: { direccion: { altura: { valor: '200' } } },
              direcciones: [
                {
                  calle: { id: '0676305001640', nombre: 'CHICLANA', categoria: 'CALLE' },
                  localidad_censal: { nombre: 'San Nicolás de los Arroyos' },
                  nomenclatura: 'CHICLANA 200, San Nicolás, Buenos Aires',
                  ubicacion: { lat: -33.3098928562045, lon: -60.2468050626151 },
                },
              ],
              total: 1,
            },
          ],
        });
      }
      if (url.includes('/direcciones')) return jsonResponse({ direcciones: [], total: 0 });
      throw new Error(`url inesperada ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const centro = { lat: -33.33, lng: -60.22 };
    const sur = { lat: -33.37, lng: -60.25 };
    const desdeCentro = await fetchNominatimSuggestions('Chiclana 148', { countryCode: 'ar', near: centro });
    resetGeorefCacheForTests();
    const desdeSur = await fetchNominatimSuggestions('Chiclana 148', { countryCode: 'ar', near: sur });

    expect(desdeCentro[0]?.lat).toBeCloseTo(-33.30989, 4);
    expect(desdeCentro[0]?.lng).toBeCloseTo(-60.24681, 4);
    expect(desdeSur[0]?.lat).toBe(desdeCentro[0]?.lat);
    expect(desdeSur[0]?.lng).toBe(desdeCentro[0]?.lng);
    expect(desdeCentro[0]?.address).toContain('148');
    expect(desdeCentro[0]?.address).not.toContain('9000');
    expect(desdeCentro[0]?.lat).not.toBeCloseTo(-33.31547, 3);
  });

  it('Chiclana 9000 no se ofrece y Garibaldi 123555 tampoco', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('nominatim.openstreetmap.org')) {
        return jsonResponse([
          {
            place_id: 9,
            lat: '-33.30968',
            lon: '-60.24655',
            display_name: 'Felipe Chiclana, San Nicolás de los Arroyos, Argentina',
            class: 'highway',
            address: { road: 'Felipe Chiclana', city: 'San Nicolás de los Arroyos' },
          },
        ]);
      }
      if (url.includes('/ubicacion')) return jsonResponse(snUbicacion);
      if (url.includes('/direcciones')) return jsonResponse({ direcciones: [], total: 0 });
      if (url.includes('/calles')) {
        return jsonResponse({
          calles: [
            {
              id: '0676305001640',
              nombre: 'CHICLANA',
              categoria: 'CALLE',
              altura: { inicio: { derecha: 0, izquierda: 0 }, fin: { derecha: 561, izquierda: 350 } },
              localidad_censal: { nombre: 'San Nicolás de los Arroyos' },
            },
          ],
        });
      }
      throw new Error(url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const suggestions = await fetchNominatimSuggestions('Chiclana 9000', {
      countryCode: 'ar',
      near: { lat: -33.33, lng: -60.22 },
    });
    expect(suggestions).toEqual([]);

    const absurd = await fetchNominatimSuggestions('Garibaldi 123555', {
      countryCode: 'ar',
      near: { lat: -33.33, lng: -60.22 },
    });
    expect(absurd).toEqual([]);
  });

  it('Alejandro Volta 1140 busca también Volta en el padrón', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('nominatim')) return jsonResponse([]);
      if (url.includes('/ubicacion')) return jsonResponse(snUbicacion);
      if (url.includes('/direcciones') && url.includes('Alejandro')) {
        return jsonResponse({ direcciones: [], total: 0 });
      }
      if (url.includes('/direcciones')) return jsonResponse(voltaDirecciones);
      throw new Error(url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const suggestions = await fetchNominatimSuggestions('Alejandro Volta 1140', {
      countryCode: 'ar',
      near: { lat: -33.33, lng: -60.22 },
    });
    expect(calls.some((url) => url.includes('direccion=Volta+1140') || url.includes('direccion=Volta%201140'))).toBe(
      true,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => /\b1140\b/.test(item.address))).toBe(true);
    expect(suggestions[0]?.lat).toBeCloseTo(-33.30348, 3);
  });
});

describe('enrichPositionedHits', () => {
  it('le pone barrio distinto a cada Volta 1140', () => {
    const positioned: GeocodeHit[] = [
      {
        id: 'a',
        lat: -33.30348,
        lng: -60.24173,
        displayName: 'VOLTA 1140',
        parts: { road: 'Volta', city: 'San Nicolás de los Arroyos' },
        positionQuality: 'interpolated',
        streetId: '0676305003255',
      },
      {
        id: 'b',
        lat: -33.29211,
        lng: -60.25566,
        displayName: 'VOLTA 1140',
        parts: { road: 'Volta', city: 'San Nicolás de los Arroyos' },
        positionQuality: 'interpolated',
        streetId: '0676305003255',
      },
    ];
    const osm: GeocodeHit[] = [
      {
        id: 'sarmiento',
        lat: -33.30376,
        lng: -60.24138,
        displayName: 'Alejandro Volta, Parque Sarmiento',
        parts: {
          road: 'Alejandro Volta',
          suburb: 'Parque Sarmiento',
          city: 'San Nicolás de los Arroyos',
        },
        osmClass: 'highway',
      },
      {
        id: 'barrancas',
        lat: -33.29355,
        lng: -60.25375,
        displayName: 'Alessandro Volta, Barrancas del Yaguarón',
        parts: {
          road: 'Alessandro Volta',
          suburb: 'Barrancas del Yaguarón',
          city: 'San Nicolás de los Arroyos',
        },
        osmClass: 'highway',
      },
    ];
    const enriched = enrichPositionedHits(positioned, osm);
    expect(enriched[0]?.parts.suburb).toBe('Parque Sarmiento');
    expect(enriched[0]?.parts.road).toBe('Alejandro Volta');
    expect(enriched[1]?.parts.suburb).toBe('Barrancas del Yaguarón');
    expect(enriched[1]?.parts.road).toBe('Alessandro Volta');
  });
});

describe('fetchGeorefAddressHits timeout', () => {
  it('devuelve null si la ubicación no responde', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const result = await fetchGeorefAddressHits('Chiclana 148', { lat: -33.33, lng: -60.22 });
    expect(result).toBeNull();
  });
});
