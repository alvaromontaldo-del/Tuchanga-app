import { describe, expect, it } from 'vitest';
import { normalizeDisplayAddress } from './formatAddress';
import {
  addressFromPick,
  addressToPersist,
  ensureTypedHeightSuggestion,
  houseNumberDigits,
  parseStreetAddressQuery,
  rankGeocodeHits,
  retainHouseNumber,
  type GeocodeHit,
} from './streetAddressQuery';

const palermo = { lat: -34.5683254, lng: -58.4365969 };
const altaGracia = { lat: -31.6677625, lng: -64.4389076 };
const baNear = { lat: -34.6037, lng: -58.3816 };

function hit(partial: GeocodeHit): GeocodeHit {
  return partial;
}

describe('parseStreetAddressQuery', () => {
  it('separa calle y altura', () => {
    expect(parseStreetAddressQuery('Volta 1140')).toEqual({
      street: 'Volta',
      houseNumber: '1140',
      unit: null,
      locality: null,
    });
    expect(parseStreetAddressQuery('  volta   1140 ')).toMatchObject({
      street: 'volta',
      houseNumber: '1140',
    });
  });

  it('deja 1140 como altura cuando hay piso o depto', () => {
    expect(parseStreetAddressQuery('Volta 1140 4B')).toEqual({
      street: 'Volta',
      houseNumber: '1140',
      unit: '4B',
      locality: null,
    });
    expect(parseStreetAddressQuery('Volta 1140 4 B')).toMatchObject({
      houseNumber: '1140',
      unit: '4 B',
    });
    expect(parseStreetAddressQuery('Volta 1140 piso 4')).toMatchObject({
      houseNumber: '1140',
      unit: 'piso 4',
    });
    expect(parseStreetAddressQuery('Volta 1140 piso 4 dpto B')).toMatchObject({
      houseNumber: '1140',
      unit: 'piso 4 dpto B',
    });
    expect(parseStreetAddressQuery('San Martín 450 3° B')).toMatchObject({
      street: 'San Martín',
      houseNumber: '450',
      unit: '3° B',
    });
  });

  it('no se come los números que son parte del nombre de la calle', () => {
    expect(parseStreetAddressQuery('Av. 9 de Julio 1200')).toMatchObject({
      street: 'Av. 9 de Julio',
      houseNumber: '1200',
      unit: null,
    });
    expect(parseStreetAddressQuery('Calle 12 3456')).toMatchObject({
      street: 'Calle 12',
      houseNumber: '3456',
    });
    expect(parseStreetAddressQuery('Av. Corrientes 1234')).toMatchObject({
      street: 'Av. Corrientes',
      houseNumber: '1234',
    });
  });

  it('acepta bis, letra pegada a la altura y localidad después de la coma', () => {
    expect(parseStreetAddressQuery('Volta 1140 bis')).toMatchObject({
      houseNumber: '1140 bis',
      unit: null,
    });
    expect(parseStreetAddressQuery('Volta 1140bis 4B')).toMatchObject({
      houseNumber: '1140bis',
      unit: '4B',
    });
    expect(parseStreetAddressQuery('Volta 1140A')).toMatchObject({
      houseNumber: '1140A',
      unit: null,
    });
    expect(parseStreetAddressQuery('Volta nro 1140, Caballito')).toEqual({
      street: 'Volta',
      houseNumber: '1140',
      unit: null,
      locality: 'Caballito',
    });
    expect(houseNumberDigits('1140 bis')).toBe('1140');
  });

  it('no inventa altura si el texto no trae número de calle', () => {
    expect(parseStreetAddressQuery('Volta')).toBeNull();
    expect(parseStreetAddressQuery('Palermo Soho')).toBeNull();
    expect(parseStreetAddressQuery('9 de Julio')).toBeNull();
    expect(parseStreetAddressQuery('1140')).toBeNull();
  });
});

describe('rankGeocodeHits', () => {
  const voltaHits: GeocodeHit[] = [
    hit({
      id: 'street-palermo',
      lat: palermo.lat,
      lng: palermo.lng,
      displayName: 'Volta, Las Cañitas, Palermo, Buenos Aires, Argentina',
      osmClass: 'highway',
      parts: {
        road: 'Volta',
        neighbourhood: 'Las Cañitas',
        suburb: 'Palermo',
        city: 'Buenos Aires',
      },
    }),
    hit({
      id: 'helado',
      lat: -34.5769,
      lng: -58.4115,
      displayName: 'Volta, 3060, Avenida Del Libertador, Palermo, Argentina',
      osmClass: 'amenity',
      parts: {
        house_number: '3060',
        road: 'Avenida Del Libertador',
        suburb: 'Palermo',
        city: 'Buenos Aires',
      },
    }),
    hit({
      id: 'house-ag',
      lat: altaGracia.lat,
      lng: altaGracia.lng,
      displayName: '1140, Volta, General Bustos, Alta Gracia, Córdoba, Argentina',
      osmClass: 'place',
      parts: {
        house_number: '1140',
        road: 'Volta',
        neighbourhood: 'General Bustos',
        town: 'Alta Gracia',
      },
    }),
  ];

  it('muestra la altura en la calle cercana y no un portal de otra ciudad', () => {
    const ranked = rankGeocodeHits(voltaHits, 'Volta 1140', baNear);
    expect(ranked.map((item) => item.id)).toEqual(['street-palermo']);
    expect(ranked[0]?.address).toContain('Volta 1140');
    expect(ranked[0]?.address).toContain('Las Cañitas');
    expect(ranked[0]?.lat).toBe(palermo.lat);
    expect(ranked.some((item) => item.address.includes('Alta Gracia'))).toBe(false);
    expect(ranked.some((item) => item.address.includes('Libertador'))).toBe(false);
  });

  it('con ciudad escrita no se va a otra localidad', () => {
    const ranked = rankGeocodeHits(voltaHits, 'Volta 1140, Buenos Aires', baNear);
    expect(ranked.map((item) => item.id)).toEqual(['street-palermo']);
    expect(ranked[0]?.address).toContain('Volta 1140');
    expect(ranked[0]?.address).toContain('Buenos Aires');
  });

  it('conserva piso o depto sin cambiar la altura', () => {
    const ranked = rankGeocodeHits(voltaHits, 'Volta 1140 4B', baNear);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.address.startsWith('Volta 1140 4B')).toBe(true);
    expect(ranked[0]?.address.includes('4B 1140')).toBe(false);
    expect(ranked[0]?.lat).toBe(palermo.lat);
  });

  it('prioriza la ciudad escrita y el punto real de esa altura', () => {
    const ranked = rankGeocodeHits(voltaHits, 'Volta 1140, Alta Gracia', baNear);
    expect(ranked[0]?.id).toBe('house-ag');
    expect(ranked[0]?.address).toContain('1140');
    expect(ranked[0]?.lat).toBe(altaGracia.lat);
  });

  it('si hay una altura cerca, usa ese punto y no el centro de la calle', () => {
    const ranked = rankGeocodeHits(
      [
        hit({
          id: 'street',
          lat: -34.6,
          lng: -58.4,
          displayName: 'Corrientes, Buenos Aires',
          osmClass: 'highway',
          parts: { road: 'Corrientes', city: 'Buenos Aires' },
        }),
        hit({
          id: 'quilmes',
          lat: -34.7308,
          lng: -58.2711,
          displayName: '1140, Corrientes, Quilmes',
          osmClass: 'place',
          parts: { house_number: '1140', road: 'Corrientes', town: 'Quilmes' },
        }),
        hit({
          id: 'olivos',
          lat: -34.5114,
          lng: -58.4855,
          displayName: '1140, Corrientes, Olivos',
          osmClass: 'place',
          parts: { house_number: '1140', road: 'Corrientes', town: 'Olivos' },
        }),
        hit({
          id: 'rosario',
          lat: -32.94,
          lng: -60.65,
          displayName: '1140, Corrientes, Rosario',
          osmClass: 'place',
          parts: { house_number: '1140', road: 'Corrientes', city: 'Rosario' },
        }),
      ],
      'Corrientes 1140',
      { lat: -34.51, lng: -58.49 },
    );
    expect(ranked.map((item) => item.id)).toEqual(['olivos', 'quilmes']);
    expect(ranked.some((item) => item.id === 'rosario')).toBe(false);
    expect(ranked.every((item) => item.address.includes('1140'))).toBe(true);
  });

  it('no agrega altura cuando la búsqueda no tiene número', () => {
    const ranked = rankGeocodeHits(voltaHits, 'Volta', baNear);
    expect(ranked[0]?.address.startsWith('Volta,')).toBe(true);
    expect(ranked[0]?.address.includes('1140')).toBe(false);
    expect(ranked.some((item) => item.id === 'helado')).toBe(true);
  });

  it('la calle sin house_number igual se muestra como Volta 1140', () => {
    const ranked = rankGeocodeHits(
      [
        hit({
          id: 'solo-calle',
          lat: palermo.lat,
          lng: palermo.lng,
          displayName: 'Volta, Las Cañitas, Palermo, Buenos Aires, Argentina',
          osmClass: 'highway',
          parts: { neighbourhood: 'Las Cañitas', city: 'Buenos Aires' },
        }),
      ],
      'Volta 1140',
      baNear,
    );
    expect(ranked[0]?.address).toContain('Volta 1140');
    expect(ranked[0]?.address).toContain('Las Cañitas');
    expect(ranked[0]?.lat).toBe(palermo.lat);
    expect(ranked[0]?.lng).toBe(palermo.lng);
  });

  it('si la etiqueta perdió la altura, la primera sugerencia la recupera', () => {
    const parsed = parseStreetAddressQuery('Volta 1140');
    const street = voltaHits[0];
    const out = ensureTypedHeightSuggestion(
      [{ id: street.id, address: 'Volta, Las Cañitas', lat: street.lat, lng: street.lng }],
      [street],
      parsed!,
      baNear,
    );
    expect(out[0]?.address).toContain('Volta 1140');
    expect(out.some((item) => item.address === 'Volta, Las Cañitas')).toBe(false);
    expect(out[0]?.lat).toBe(palermo.lat);
  });

  it('reconoce Libertador aunque en el mapa figure como avenida', () => {
    const ranked = rankGeocodeHits(
      [
        hit({
          id: 'lib',
          lat: -34.5639,
          lng: -58.4364,
          displayName: '5000, Avenida Del Libertador, Palermo',
          osmClass: 'place',
          parts: {
            house_number: '5000',
            road: 'Avenida Del Libertador',
            suburb: 'Palermo',
            city: 'Buenos Aires',
          },
        }),
      ],
      'Libertador 5000',
      baNear,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.address).toContain('5000');
    expect(ranked[0]?.address).toContain('Libertador');
    expect(ranked[0]?.lat).toBe(-34.5639);
  });
});

describe('retainHouseNumber', () => {
  it('repone la altura si el reverso de la misma calle la pierde', () => {
    expect(retainHouseNumber('Volta 1140, Las Cañitas, Buenos Aires', 'Volta, Las Cañitas')).toBe(
      'Volta 1140, Las Cañitas',
    );
    expect(
      retainHouseNumber('Volta 1140 4B, Las Cañitas, Buenos Aires', 'Volta, Las Cañitas'),
    ).toBe('Volta 1140 4B, Las Cañitas');
  });

  it('no pega la altura sobre otra calle', () => {
    expect(retainHouseNumber('Volta 1140, Las Cañitas', 'Cerviño 3562, Palermo')).toBe(
      'Cerviño 3562, Palermo',
    );
  });

  it('reemplaza el portal cercano de OSM por la altura tipeada', () => {
    expect(retainHouseNumber('Volta 1140, Las Cañitas', 'Volta 1853, Las Cañitas')).toBe(
      'Volta 1140, Las Cañitas',
    );
    expect(
      retainHouseNumber('Alejandro Volta 1140', 'Volta 1853, Las Cañitas, Palermo'),
    ).toBe('Alejandro Volta 1140, Las Cañitas, Palermo');
    expect(
      retainHouseNumber(
        'Alejandro Volta 1140',
        'Alejandro Volta, Troncos del Talar, Partido de Tigre',
      ),
    ).toBe('Alejandro Volta 1140, Troncos del Talar, Partido de Tigre');
  });
});

describe('addressFromPick', () => {
  it('guarda la etiqueta de la sugerencia si ya trae la altura', () => {
    expect(addressFromPick('Alejandro Volta 1140', 'Volta 1140, Las Cañitas, Palermo')).toBe(
      'Volta 1140, Las Cañitas, Palermo',
    );
  });

  it('mezcla la altura tipeada cuando OSM solo tiene la calle', () => {
    expect(addressFromPick('Alejandro Volta 1140', 'Alejandro Volta, Troncos del Talar')).toBe(
      'Alejandro Volta 1140, Troncos del Talar',
    );
    expect(addressFromPick('Volta 1140', 'Volta, Las Cañitas, Palermo')).toBe(
      'Volta 1140, Las Cañitas, Palermo',
    );
  });

  it('no deja el portal equivocado ni inventa altura', () => {
    expect(addressFromPick('Volta 1140', 'Volta 1853, Las Cañitas')).toBe(
      'Volta 1140, Las Cañitas',
    );
    expect(addressFromPick('Volta', 'Volta, Las Cañitas')).toBe('Volta, Las Cañitas');
    expect(addressFromPick('Volta 1140', 'Cerviño 3562, Palermo')).toBe('Cerviño 3562, Palermo');
  });

  it('conserva piso o depto junto con la altura', () => {
    expect(addressFromPick('Volta 1140 4B', 'Volta, Las Cañitas')).toBe('Volta 1140 4B, Las Cañitas');
    expect(addressFromPick('Volta 1140 piso 4', 'Volta 1853, Palermo')).toBe(
      'Volta 1140 piso 4, Palermo',
    );
  });
});

describe('addressToPersist', () => {
  it('al guardar sin mover el pin usa la etiqueta confirmada, no el reverso sin altura', () => {
    const saved = addressToPersist({
      typedQuery: 'Alejandro Volta 1140',
      confirmedLabel: 'Alejandro Volta 1140, Troncos del Talar',
      currentLabel: 'Alejandro Volta, Troncos del Talar',
      pinMoved: false,
    });
    expect(saved).toContain('1140');
    expect(saved).toContain('Volta');
    expect(normalizeDisplayAddress(saved)).toContain('1140');
  });

  it('si el reverso corrió igual, reconstruye la altura tipeada', () => {
    const saved = addressToPersist({
      typedQuery: 'Volta 1140 4B',
      confirmedLabel: null,
      currentLabel: 'Volta, Las Cañitas',
      pinMoved: false,
    });
    expect(saved).toBe('Volta 1140 4B, Las Cañitas');
  });

  it('si movieron el pin a otra calle, no reimpone la altura anterior', () => {
    expect(
      addressToPersist({
        typedQuery: 'Volta 1140',
        confirmedLabel: 'Volta 1140, Las Cañitas',
        currentLabel: 'Cerviño 3562, Palermo',
        pinMoved: true,
      }),
    ).toBe('Cerviño 3562, Palermo');
  });
});

describe('normalizeDisplayAddress', () => {
  it('no borra la altura al guardar', () => {
    expect(normalizeDisplayAddress('Volta 1140, Las Cañitas, Buenos Aires')).toBe(
      'Volta 1140, Las Cañitas',
    );
    expect(normalizeDisplayAddress('Volta 1140 4B, Palermo')).toBe('Volta 1140 4B, Palermo');
    expect(normalizeDisplayAddress('Volta, 1140, Villa Crespo')).toBe('Volta, 1140, Villa Crespo');
    expect(normalizeDisplayAddress('Volta 1140, Palermo, C1426AAV, Argentina')).toBe(
      'Volta 1140, Palermo',
    );
  });
});
