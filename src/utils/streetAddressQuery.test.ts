import { describe, expect, it } from 'vitest';
import { normalizeDisplayAddress } from './formatAddress';
import {
  activeStreetQuery,
  addressFromPick,
  addressToPersist,
  emptyAddressSearchMessage,
  ensureTypedHeightSuggestion,
  fallbackStreetNames,
  houseNumberDigits,
  isIgnorableAddressEcho,
  isNegligiblePinMove,
  isPlausibleHouseNumber,
  parseStreetAddressQuery,
  rankGeocodeHits,
  rejectedAddressMessage,
  retainHouseNumber,
  stampSuggestions,
  visibleSuggestionAddress,
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

  it('Alejandro Volta 1140 sobrevive al reverso del centro de calle, que no tiene portal', () => {
    const typed = 'Alejandro Volta 1140';
    const suggestion = 'Alejandro Volta, Troncos del Talar';
    const confirmed = addressFromPick(typed, suggestion);
    const reversed = 'Alejandro Volta, Troncos del Talar';
    const saved = addressToPersist({
      typedQuery: typed,
      confirmedLabel: confirmed,
      currentLabel: reversed,
      pinMoved: true,
    });
    expect(confirmed).toContain('1140');
    expect(saved).toContain('1140');
    expect(saved).toContain('Volta');
    expect(normalizeDisplayAddress(saved)).toContain('1140');
    expect(saved.includes('1853')).toBe(false);
  });

  it('Volta 1140 no queda como el portal cercano 1853', () => {
    const saved = addressToPersist({
      typedQuery: 'Volta 1140',
      confirmedLabel: 'Volta 1140, Las Cañitas, Buenos Aires',
      currentLabel: 'Volta 1853, Las Cañitas',
      pinMoved: true,
    });
    expect(saved).toContain('1140');
    expect(saved.includes('1853')).toBe(false);
    expect(normalizeDisplayAddress(saved)).toContain('1140');
  });

  it('Volta 1140 4B conserva altura y piso aunque el reverso no traiga número', () => {
    const saved = addressToPersist({
      typedQuery: 'Volta 1140 4B',
      confirmedLabel: null,
      currentLabel: 'Volta, Las Cañitas',
      pinMoved: true,
    });
    expect(saved).toContain('1140');
    expect(saved).toContain('4B');
  });

  it('Volta sin número no inventa altura ni se queda con un portal de OSM', () => {
    expect(
      addressToPersist({
        typedQuery: 'Volta',
        confirmedLabel: 'Volta, Las Cañitas',
        currentLabel: 'Volta 1853, Las Cañitas',
        pinMoved: false,
      }),
    ).toBe('Volta, Las Cañitas');
    expect(
      addressFromPick('Volta', 'Volta, Las Cañitas, Palermo'),
    ).toBe('Volta, Las Cañitas, Palermo');
  });

  it('una calle con portal real en OSM guarda ese portal', () => {
    const typed = 'Cerviño 3562';
    const suggestion = 'Cerviño 3562, Palermo';
    const saved = addressToPersist({
      typedQuery: typed,
      confirmedLabel: addressFromPick(typed, suggestion),
      currentLabel: suggestion,
      pinMoved: false,
    });
    expect(saved).toContain('3562');
    expect(saved).toContain('Cerviño');
    expect(normalizeDisplayAddress(saved)).toContain('3562');
  });
});

describe('eco del TextInput y move fantasma del mapa', () => {
  it('ignora el eco del texto que acabamos de escribir y un vacío inmediato', () => {
    expect(isIgnorableAddressEcho('Volta 1140, Las Cañitas', 'Volta 1140, Las Cañitas', 'Volta 1140', 1_000, 1_500)).toBe(
      true,
    );
    expect(isIgnorableAddressEcho('', 'Volta 1140, Las Cañitas', 'Volta 1140', 1_000, 1_500)).toBe(true);
    expect(isIgnorableAddressEcho('Volta 1140', 'Volta 1140, Las Cañitas', 'Volta 1140', 1_000, 1_500)).toBe(
      true,
    );
    expect(isIgnorableAddressEcho('Volta 1141', 'Volta 1140, Las Cañitas', 'Volta 1140', 2_000, 1_500)).toBe(
      false,
    );
  });

  it('un centrado del pin no cuenta como arrastre', () => {
    expect(isNegligiblePinMove(palermo, { lat: palermo.lat + 0.00005, lng: palermo.lng })).toBe(true);
    expect(isNegligiblePinMove(palermo, { lat: palermo.lat + 0.01, lng: palermo.lng })).toBe(false);
    expect(isNegligiblePinMove(null, palermo)).toBe(false);
  });
});

describe('sugerencias Volta 1140 como en Mis datos', () => {
  const sanNicolas = { lat: -33.33, lng: -60.22 };
  const hits: GeocodeHit[] = [
    hit({
      id: 'alta',
      lat: altaGracia.lat,
      lng: altaGracia.lng,
      displayName: '1140, Volta, General Bustos, Alta Gracia, Córdoba, Argentina',
      osmClass: 'place',
      parts: { house_number: '1140', road: 'Volta', neighbourhood: 'General Bustos', town: 'Alta Gracia' },
    }),
    hit({
      id: 'alessandro',
      lat: -33.29355,
      lng: -60.25375,
      displayName:
        'Alessandro Volta, Barrancas del Yaguarón, San Nicolás de los Arroyos, Partido de San Nicolás, Buenos Aires, B2900, Argentina',
      osmClass: 'highway',
      parts: {
        road: 'Alessandro Volta',
        suburb: 'Barrancas del Yaguarón',
        city: 'San Nicolás de los Arroyos',
      },
    }),
    hit({
      id: 'alejandro',
      lat: -33.29208,
      lng: -60.25571,
      displayName:
        'Alejandro Volta, Azopardo, San Nicolás de los Arroyos, Partido de San Nicolás, Buenos Aires, B2900, Argentina',
      osmClass: 'highway',
      parts: { road: 'Alejandro Volta', city: 'San Nicolás de los Arroyos' },
    }),
    hit({
      id: 'castelli',
      lat: -33.30278,
      lng: -60.24263,
      displayName:
        'Alejandro Volta, Loteo Castelli, San Nicolás de los Arroyos, Partido de San Nicolás, Buenos Aires, B2900, Argentina',
      osmClass: 'highway',
      parts: {
        road: 'Alejandro Volta',
        neighbourhood: 'Loteo Castelli',
        city: 'San Nicolás de los Arroyos',
      },
    }),
    hit({
      id: 'sarmiento',
      lat: -33.30376,
      lng: -60.24138,
      displayName:
        'Alejandro Volta, Parque Sarmiento, San Nicolás de los Arroyos, Partido de San Nicolás, Buenos Aires, B2900, Argentina',
      osmClass: 'highway',
      parts: {
        road: 'Alejandro Volta',
        suburb: 'Parque Sarmiento',
        city: 'San Nicolás de los Arroyos',
      },
    }),
  ];

  const screenshotRows = [
    'Alessandro Volta, San Nicolás de los Arroyos',
    'Alejandro Volta, San Nicolás de los Arroyos',
    'Alejandro Volta, Loteo Castelli',
    'Alejandro Volta, Parque Sarmiento',
  ];

  it('cada sugerencia visible de Volta 1140 muestra la altura', () => {
    const ranked = rankGeocodeHits(hits, 'Volta 1140', sanNicolas);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((item) => /\b1140\b/.test(item.address.split(',')[0] ?? ''))).toBe(true);
    expect(ranked.some((item) => item.id === 'alta')).toBe(false);
    for (const item of ranked) {
      expect(item.plainAddress ?? '').not.toMatch(/\b1140\b/);
      expect(visibleSuggestionAddress('Volta 1140', 'Volta', item)).toMatch(/\b1140\b/);
      expect(visibleSuggestionAddress('Volta', 'Volta', item)).not.toMatch(/\b1140\b/);
    }
  });

  it('las filas crudas del screenshot muestran 1140 aunque el recuerdo no tenga número', () => {
    for (const raw of screenshotRows) {
      const label = visibleSuggestionAddress('Volta 1140', 'Volta', {
        address: raw,
        plainAddress: raw,
      });
      expect(label.split(',')[0]).toMatch(/Volta 1140$/);
      expect(visibleSuggestionAddress('Alejandro Volta 1140', null, { address: raw })).toMatch(
        /\b1140\b/,
      );
    }
    const stamped = stampSuggestions(
      'Volta 1140',
      screenshotRows.map((address) => ({ address })),
    );
    expect(stamped.every((item) => item.address.split(',')[0]?.endsWith('1140'))).toBe(true);
    expect(stampSuggestions('Volta', screenshotRows.map((address) => ({ address })))).toEqual(
      screenshotRows.map((address) => ({ address })),
    );
  });

  it('el campo con altura gana y sin número no se inventa', () => {
    expect(activeStreetQuery('Volta 1140', 'Volta')).toBe('Volta 1140');
    expect(activeStreetQuery('Alejandro Volta 1140', 'Volta')).toBe('Alejandro Volta 1140');
    expect(activeStreetQuery('Volta', null)).toBe('Volta');
    expect(activeStreetQuery('', 'Volta 1140')).toBe('Volta 1140');
    expect(visibleSuggestionAddress('Volta', 'Volta', { address: screenshotRows[0] })).toBe(
      screenshotRows[0],
    );
  });
});

describe('calle corta cerca contra homónimo lejos', () => {
  it('Alejandro Volta 1140 cerca de Palermo usa Volta y no Tigre', () => {
    const tigre = { lat: -34.4552826, lng: -58.6011515 };
    const ranked = rankGeocodeHits(
      [
        hit({
          id: 'tigre',
          lat: tigre.lat,
          lng: tigre.lng,
          displayName: 'Alejandro Volta, Troncos del Talar, Partido de Tigre, Buenos Aires',
          osmClass: 'highway',
          parts: { road: 'Alejandro Volta', town: 'Troncos del Talar' },
        }),
        hit({
          id: 'palermo-volta',
          lat: palermo.lat,
          lng: palermo.lng,
          displayName: 'Volta, Las Cañitas, Palermo, Buenos Aires',
          osmClass: 'highway',
          parts: {
            road: 'Volta',
            neighbourhood: 'Las Cañitas',
            suburb: 'Palermo',
            city: 'Buenos Aires',
          },
        }),
      ],
      'Alejandro Volta 1140',
      palermo,
    );
    expect(ranked[0]?.id).toBe('palermo-volta');
    expect(ranked[0]?.address).toContain('1140');
    expect(ranked[0]?.address.includes('1853')).toBe(false);
    expect(ranked[0]?.lat).toBe(palermo.lat);
  });

  it('el fallback de nombre no parte calles que ya traen un número', () => {
    expect(fallbackStreetNames('Alejandro Volta')).toEqual(['Volta']);
    expect(fallbackStreetNames('Volta')).toEqual([]);
    expect(fallbackStreetNames('Av. 9 de Julio')).toEqual([]);
  });
});

describe('calidad de sugerencias: barrios repetidos y alturas inventadas', () => {
  const sanNicolas = { lat: -33.33, lng: -60.22 };
  const moreno = { lat: -33.3154675, lng: -60.2530522 };
  const suizo = { lat: -33.3112064, lng: -60.2481839 };
  const parque = { lat: -33.3057995, lng: -60.2425705 };
  const centro = { lat: -33.3096824, lng: -60.246551 };

  function chiclanaSegment(
    id: string,
    point: { lat: number; lng: number },
    suburb: string | undefined,
  ): GeocodeHit {
    return hit({
      id,
      lat: point.lat,
      lng: point.lng,
      displayName: `Felipe Chiclana, ${suburb ? `${suburb}, ` : ''}San Nicolás de los Arroyos, Buenos Aires, Argentina`,
      osmClass: 'highway',
      parts: {
        road: 'Felipe Chiclana',
        suburb,
        city: 'San Nicolás de los Arroyos',
      },
    });
  }

  const chiclanaSegments = [
    chiclanaSegment('moreno', moreno, 'Moreno'),
    chiclanaSegment('suizo', suizo, 'Suizo'),
    chiclanaSegment('parque', parque, 'Parque Sarmiento'),
    chiclanaSegment('centro', centro, undefined),
  ];

  it('colapsa los tramos de Chiclana 148 que solo cambian de barrio', () => {
    const ranked = rankGeocodeHits(chiclanaSegments, 'Chiclana 148', moreno);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.lat).toBe(moreno.lat);
    expect(ranked[0]?.lng).toBe(moreno.lng);
    const visible = visibleSuggestionAddress('Chiclana 148', null, ranked[0]!);
    expect(visible).toContain('148');
    expect(visible).toContain('Felipe Chiclana');
    expect(visible).toContain('San Nicolás de los Arroyos');
    expect(visible).not.toMatch(/Moreno|Suizo|Parque Sarmiento/);
    expect(ranked[0]?.plainAddress ?? '').not.toMatch(/\b148\b/);
  });

  it('mantiene portales iguales cuando las ciudades están lejos', () => {
    const ranked = rankGeocodeHits(
      [
        hit({
          id: 'olivos',
          lat: -34.5114,
          lng: -58.4855,
          displayName: '1140, Corrientes, Olivos',
          osmClass: 'place',
          parts: { house_number: '1140', road: 'Corrientes', town: 'Olivos' },
        }),
        hit({
          id: 'quilmes',
          lat: -34.7308,
          lng: -58.2711,
          displayName: '1140, Corrientes, Quilmes',
          osmClass: 'place',
          parts: { house_number: '1140', road: 'Corrientes', town: 'Quilmes' },
        }),
      ],
      'Corrientes 1140',
      { lat: -34.51, lng: -58.49 },
    );
    expect(ranked.map((item) => item.id).sort()).toEqual(['olivos', 'quilmes']);
  });

  it('no fabrica coordenadas para Garibaldi 123555', () => {
    const segments: GeocodeHit[] = [
      hit({
        id: 'mitre',
        lat: -33.34834,
        lng: -60.23066,
        displayName: 'José Garibaldi, Mitre, San Nicolás de los Arroyos, Argentina',
        osmClass: 'highway',
        parts: { road: 'José Garibaldi', suburb: 'Mitre', city: 'San Nicolás de los Arroyos' },
      }),
      hit({
        id: 'centro-g',
        lat: -33.34133,
        lng: -60.2235,
        displayName: 'José Garibaldi, Centro, San Nicolás de los Arroyos, Argentina',
        osmClass: 'highway',
        parts: { road: 'José Garibaldi', suburb: 'Centro', city: 'San Nicolás de los Arroyos' },
      }),
      hit({
        id: 'colombini',
        lat: -33.3738,
        lng: -60.25713,
        displayName: 'José Garibaldi, Colombini, San Nicolás de los Arroyos, Argentina',
        osmClass: 'highway',
        parts: { road: 'José Garibaldi', suburb: 'Colombini', city: 'San Nicolás de los Arroyos' },
      }),
    ];
    const parsed = parseStreetAddressQuery('Garibaldi 123555');
    expect(parsed?.houseNumber).toBe('123555');
    expect(isPlausibleHouseNumber('123555')).toBe(false);
    expect(rankGeocodeHits(segments, 'Garibaldi 123555', sanNicolas)).toEqual([]);
    expect(ensureTypedHeightSuggestion([], segments, parsed!, sanNicolas)).toEqual([]);
    expect(
      addressFromPick('Garibaldi 123555', 'José Garibaldi, Centro, San Nicolás de los Arroyos'),
    ).toBe('José Garibaldi, Centro, San Nicolás de los Arroyos');
    expect(
      addressToPersist({
        typedQuery: 'Garibaldi 123555',
        confirmedLabel: null,
        currentLabel: 'José Garibaldi, Centro',
        pinMoved: false,
      }),
    ).toBe('José Garibaldi, Centro');
    expect(retainHouseNumber('Garibaldi 123555, Centro', 'José Garibaldi, Centro')).toBe(
      'José Garibaldi, Centro',
    );
    expect(rejectedAddressMessage('Garibaldi 123555')).toMatch(/altura/);
    expect(emptyAddressSearchMessage('Garibaldi 123555')).toMatch(/inventada/);
    expect(rejectedAddressMessage('Volta 1140')).toBeNull();
  });

  it('si el geocoder confirma una altura rara, esa sugerencia sí se ofrece', () => {
    const ranked = rankGeocodeHits(
      [
        hit({
          id: 'confirmado',
          lat: -33.34,
          lng: -60.23,
          displayName: '123555, Garibaldi, San Nicolás de los Arroyos',
          osmClass: 'place',
          parts: {
            house_number: '123555',
            road: 'Garibaldi',
            city: 'San Nicolás de los Arroyos',
          },
        }),
      ],
      'Garibaldi 123555',
      sanNicolas,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.id).toBe('confirmado');
    expect(ranked[0]?.lat).toBe(-33.34);
    expect(ranked[0]?.address).toContain('123555');
  });

  it('Volta 1140 sigue en la calle cercana cuando OSM no tiene el portal', () => {
    expect(isPlausibleHouseNumber('1140')).toBe(true);
    const ranked = rankGeocodeHits(
      [
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
      ],
      'Volta 1140',
      baNear,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.lat).toBe(palermo.lat);
    expect(ranked[0]?.lng).toBe(palermo.lng);
    expect(visibleSuggestionAddress('Volta 1140', null, ranked[0]!)).toContain('Volta 1140');
    expect(visibleSuggestionAddress('Volta 1140', null, ranked[0]!)).toContain('Las Cañitas');
    expect(
      addressToPersist({
        typedQuery: 'Volta 1140',
        confirmedLabel: 'Volta 1140, Las Cañitas',
        currentLabel: 'Volta, Las Cañitas',
        pinMoved: false,
      }),
    ).toContain('1140');
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
