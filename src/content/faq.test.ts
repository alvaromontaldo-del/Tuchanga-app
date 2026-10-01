import { describe, expect, it } from 'vitest';
import { FAQ_ITEMS } from './faq';

const text = FAQ_ITEMS.map((item) => `${item.question}\n${item.answer}`).join('\n');

describe('preguntas frecuentes', () => {
  it('tiene entre 10 y 14 preguntas, sin ids repetidos', () => {
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(10);
    expect(FAQ_ITEMS.length).toBeLessThanOrEqual(14);
    expect(new Set(FAQ_ITEMS.map((item) => item.id)).size).toBe(FAQ_ITEMS.length);
    for (const item of FAQ_ITEMS) {
      expect(item.question.trim().endsWith('?')).toBe(true);
      expect(item.answer.trim().length).toBeGreaterThan(40);
    }
  });

  it('explica la garantía de 1 a 60 días, el ancla y el reclamo', () => {
    const warranty = FAQ_ITEMS.find((item) => item.id === 'garantia');
    expect(warranty?.answer).toMatch(/1 a 60/);
    expect(warranty?.answer).toMatch(/sin garantía/i);
    expect(warranty?.answer).toMatch(/primera vez que el trabajo queda marcado como finalizado/);
    expect(warranty?.answer).toMatch(/reclamo/i);
  });

  it('dice que el costo de servicio queda cubierto por la app, sin porcentajes ni montos', () => {
    expect(text).toMatch(/costo de servicio YaChanga queda cubierto por la app/);
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\$\s*\d/);
    expect(text).not.toMatch(/\b22\b/);
  });

  it('el PIN de materiales lo ven el cliente que pagó y el profesional que creó el pedido', () => {
    const materials = FAQ_ITEMS.find((item) => item.id === 'materiales');
    expect(materials?.answer).toMatch(/cliente que pagó y el profesional que creó el pedido/);
    expect(materials?.answer).toMatch(/aunque el profesional no haya pagado/);
    expect(materials?.answer).toMatch(/teléfono, la dirección del comercio y el PIN de retiro/);
    expect(materials?.answer).toMatch(/El comercio nunca ve el PIN/);
  });

  it('cubre los problemas que pide la tarjeta', () => {
    const questions = FAQ_ITEMS.map((item) => item.question).join('\n');
    expect(questions).toMatch(/no se presenta/);
    expect(questions).toMatch(/mal hecho/);
    expect(questions).toMatch(/profesional cancela/);
    expect(questions).toMatch(/no tiene el material/);
    expect(questions).toMatch(/si lo pierdo/);
    expect(questions).toMatch(/no se acredita/);
  });
});
