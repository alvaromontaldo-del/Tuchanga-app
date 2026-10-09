import { describe, expect, it } from 'vitest';
import {
  OFFPLATFORM_NOTICE,
  OFFPLATFORM_REDACTION,
  type OffplatformKind,
  offplatformSubmitText,
  redactOffplatformContact,
  redactOffplatformMessage,
} from './offplatformContact';

function keeps(text: string) {
  const result = redactOffplatformContact(text);
  expect(result.changed, text).toBe(false);
  expect(result.text, text).toBe(text);
  expect(result.notice, text).toBeNull();
  expect(result.kinds, text).toEqual([]);
}

function hides(text: string, kind: OffplatformKind, gone: string) {
  const result = redactOffplatformContact(text);
  expect(result.changed, text).toBe(true);
  expect(result.kinds, text).toContain(kind);
  expect(result.text, text).toContain(OFFPLATFORM_REDACTION);
  expect(result.text.toLowerCase(), text).not.toContain(gone.toLowerCase());
  expect(result.notice, text).toBe(OFFPLATFORM_NOTICE);
}

describe('antipuenteo: no bloquea la palabra, detecta el dato', () => {
  it.each([
    '¿cuál es la dirección?',
    'ya estoy en la ubicación',
    'pasame la dirección cuando puedas',
    '¿me pasás el teléfono?',
    'llamame cuando llegues',
    'mandame un mail cuando termines',
    'hablamos por whatsapp en la obra',
    'Cinta',
    'Cable',
    'se viene el calor',
    'Cinta aisladora y cable de 2.5',
    'meta de la semana y calle interna',
    'instagram del local lo vemos después',
    'el punto es que falta el enduido',
  ])('deja pasar la frase «%s»', keeps);

  it.each([
    '$300.000',
    'son $ 1.234.567',
    'cuesta 300 mil',
    'sale 15.000 pesos',
    'Nuevo presupuesto de materiales: $1.234.567. Tocá para ver el detalle.',
    'Seña de $15.000 confirmada el 23/06/2026 17:16',
    '2x3 m',
    '2 x 3 m',
    '1140 mm',
    'cable de 2.5',
    '10 bolsas de cemento',
    '3 cajas de tornillos',
    'manguera ½ de 2 m',
    'de 9 a 18 hs',
    'nos vemos 17:16',
    'el 23/06/2026 arrancamos',
    '12 de junio de 2026',
  ])('deja pasar montos, medidas, horarios y fechas «%s»', keeps);
});

describe('teléfonos argentinos', () => {
  it.each([
    ['llámame al 11 1234 5678', '11 1234 5678'],
    ['el celu es 11-5555-6666', '11-5555-6666'],
    ['anotá 11.5555.6666', '11.5555.6666'],
    ['+54 9 11 5555-6666', '+54 9 11 5555-6666'],
    ['011 15 4444-5555', '011 15 4444-5555'],
    ['15 5555 6666', '15 5555 6666'],
    ['3644123456', '3644123456'],
    ['once 4 cinco cinco cinco cinco seis seis seis seis', 'once 4 cinco'],
    ['uno uno cuatro cinco seis siete ocho nueve cero uno', 'uno uno cuatro'],
  ])('detecta «%s»', (text, gone) => {
    hides(text, 'telefono', gone);
  });
});

describe('mails, links, alias, CBU y redes', () => {
  it.each([
    ['escribile a juan@gmail.com', 'juan@gmail.com', 'email'],
    ['juan arroba gmail punto com', 'juan arroba gmail', 'email'],
    ['ana (arroba) hotmail punto com.ar', 'ana (arroba) hotmail', 'email'],
    ['mirá https://wa.me/5491155556666', 'wa.me/5491155556666', 'url'],
    ['el pin del mapa es https://maps.app.goo.gl/abc123', 'maps.app.goo.gl', 'url'],
    ['goo.gl/maps/xyz', 'goo.gl/maps', 'url'],
    ['maps.google.com/place', 'maps.google.com', 'url'],
    ['instagram.com/juanperez', 'instagram.com/juanperez', 'url'],
    ['mi alias es juan.perez.mp', 'juan.perez.mp', 'alias'],
    ['CBU 0170099220000061234567', '0170099220000061234567', 'cbu'],
    ['cvu 0000003100012345678901', '0000003100012345678901', 'cbu'],
    ['seguime en @juanperez', '@juanperez', 'usuario'],
    ['el código es 458291', '458291', 'codigo'],
  ])('detecta «%s»', (text, gone, kind) => {
    hides(text, kind as OffplatformKind, gone);
  });
});

describe('direcciones y ubicaciones', () => {
  it.each([
    ['estoy en Volta 1140', 'Volta 1140'],
    ['Av. San Martín 2300', 'San Martín 2300'],
    ['avenida san martin 2300', 'san martin 2300'],
    ['calle 12 n° 345', '345'],
    ['calle 12 nro 345', 'nro 345'],
    ['esquina Volta y San Martín', 'Volta y San Martín'],
    ['entre Mitre y Belgrano', 'Mitre y Belgrano'],
    ['es en barrio cerrado Los Alamos', 'barrio cerrado'],
    ['lote 14 manzana 3', 'lote 14'],
    ['piso 4 depto B', 'depto B'],
    ['las coords son -34.603722, -58.381592', '-34.603722'],
    ['altura 1140', '1140'],
  ])('detecta «%s»', (text, gone) => {
    hides(text, 'direccion', gone);
  });

  it('deja la frase y solo tapa el dato', () => {
    const result = redactOffplatformContact('Llegá a Volta 1140, te espero en la vereda');
    expect(result.text).toBe(`Llegá a ${OFFPLATFORM_REDACTION}, te espero en la vereda`);
    expect(result.kinds).toEqual(['direccion']);
  });

  it('no toma una esquina sin nombres de calle', () => {
    keeps('en la esquina de la obra');
    keeps('cinta y cable de 2.5');
  });
});

describe('mensajes de sistema y metadata', () => {
  it('no toca un mensaje de sistema con monto, fecha y PIN', () => {
    const body = 'Seña de $15.000 confirmada el 23/06/2026 17:16. PIN 4821. 11 1234 5678';
    const result = redactOffplatformMessage('system', body, { event: 'seña_pagada_cliente' });
    expect(result.body).toBe(body);
    expect(result.notice).toBeNull();
  });

  it('redacta el cuerpo y el detalle, y no la URL de la foto', () => {
    const imageUrl =
      'https://proj.supabase.co/storage/v1/object/public/job-photos/30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/1730000000000-ab.jpg';
    const clean = redactOffplatformMessage('image', '📷 Foto', {
      caption: 'cinta aisladora y cable',
      image_url: imageUrl,
    });
    expect(clean.notice).toBeNull();
    expect((clean.metadata as { image_url: string }).image_url).toBe(imageUrl);

    const dirty = redactOffplatformMessage('quotation', 'Cotización', {
      service_detail: 'instalación en Volta 1140',
      warranty_days: 15,
    });
    expect(dirty.kinds).toContain('direccion');
    expect((dirty.metadata as { service_detail: string }).service_detail).toContain(OFFPLATFORM_REDACTION);
    expect((dirty.metadata as { warranty_days: number }).warranty_days).toBe(15);
  });
});

describe('envío', () => {
  it('reemplaza el dato si el texto que queda sigue alcanzando el mínimo', () => {
    expect(offplatformSubmitText('Llegá a Volta 1140, te espero en la vereda', 10)).toBe(
      `Llegá a ${OFFPLATFORM_REDACTION}, te espero en la vereda`,
    );
  });

  it('manda el original si al reemplazar fundamentos queda por debajo de 10', () => {
    expect(offplatformSubmitText('11 1234 5678', 10)).toBe('11 1234 5678');
  });
});
