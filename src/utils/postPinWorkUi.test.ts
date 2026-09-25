import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { postPinWorkerChatCopy } from './postPinWorkUi';

describe('postPinWorkerChatCopy', () => {
  it('no muestra título y conserva la instrucción y Realizado', () => {
    const copy = postPinWorkerChatCopy(false);
    expect(copy.title).toBeNull();
    expect(copy.body).toBe('Cuando termines el trabajo, marcá como realizado.');
    expect(copy.actionLabel).toBe('Realizado');
    expect(copy.body).not.toMatch(/Pago confirmado/i);
  });

  it('si el cliente ya indicó el saldo, suma esa aclaración sin título', () => {
    const copy = postPinWorkerChatCopy(true);
    expect(copy.title).toBeNull();
    expect(copy.body).toContain('Cuando termines el trabajo, marcá como realizado.');
    expect(copy.body).toContain('El cliente ya indicó el pago del saldo.');
  });
});

describe('pantallas post-PIN', () => {
  it('Detalle del servicio no renderiza el botón de finalizar', () => {
    const src = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
    expect(src).not.toContain('Marcar trabajo finalizado');
    expect(src).not.toContain('Trabajo finalizado');
    expect(src).not.toContain('trabajadorFinalizarTrabajo');
  });

  it('el recuadro del chat post-PIN no tiene heading de pago', () => {
    const src = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    expect(src).not.toContain('Pago confirmado');
    expect(src).not.toContain('Trabajo en curso');
    const start = src.indexOf('showWorkerJobBar && job');
    expect(start).toBeGreaterThan(-1);
    const bar = src.slice(start, start + 1600);
    expect(bar).toContain('postPinWorkerChatCopy(');
    expect(bar).not.toContain('payTitle');
    expect(bar).toContain('.actionLabel');
    expect(bar).not.toContain('Pago confirmado');
    expect(bar).not.toContain('Costo de servicio pagado');
  });
});

describe('OTA de Testing', () => {
  it('publica en la branch preview, que es la que sirve el canal de la app de QA', () => {
    const yml = readFileSync('.github/workflows/eas-update.yml', 'utf8');
    expect(yml).toContain('--branch preview');
    expect(yml).not.toMatch(/--branch main\b/);
  });
});
