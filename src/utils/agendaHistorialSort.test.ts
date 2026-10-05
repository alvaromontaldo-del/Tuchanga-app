import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sortHistorialReciente } from './agendaHistorialSort';

function row(partial: {
  id: string;
  fecha_trabajo?: string | null;
  hora_inicio?: string | null;
  created_at: string;
}) {
  return {
    id: partial.id,
    fecha_trabajo: partial.fecha_trabajo ?? null,
    hora_inicio: partial.hora_inicio ?? null,
    created_at: partial.created_at,
  };
}

describe('historial reciente de la agenda', () => {
  it('ordena de más nuevo a más viejo por fecha y hora', () => {
    const sorted = sortHistorialReciente([
      row({ id: 'viejo', fecha_trabajo: '2026-09-01', hora_inicio: '09:00', created_at: '2026-09-01T12:00:00Z' }),
      row({ id: 'tarde', fecha_trabajo: '2026-10-05', hora_inicio: '18:00', created_at: '2026-10-01T12:00:00Z' }),
      row({ id: 'manana', fecha_trabajo: '2026-10-05', hora_inicio: '09:00', created_at: '2026-10-02T12:00:00Z' }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['tarde', 'manana', 'viejo']);
  });

  it('si no hay fecha, usa created_at y no pisa el array original', () => {
    const input = [
      row({ id: 'sin-fecha-viejo', created_at: '2026-08-01T10:00:00Z' }),
      row({ id: 'con-fecha', fecha_trabajo: '2026-09-15', hora_inicio: '11:00', created_at: '2026-09-01T10:00:00Z' }),
      row({ id: 'sin-fecha-nuevo', created_at: '2026-10-04T10:00:00Z' }),
    ];
    const sorted = sortHistorialReciente(input);
    expect(sorted.map((item) => item.id)).toEqual(['sin-fecha-nuevo', 'con-fecha', 'sin-fecha-viejo']);
    expect(input.map((item) => item.id)).toEqual(['sin-fecha-viejo', 'con-fecha', 'sin-fecha-nuevo']);
  });

  it('la pantalla de agenda ordena el historial así y deja Hoy y Próximos hacia adelante', () => {
    const screen = readFileSync('src/screens/agenda/AgendaScreen.tsx', 'utf8');
    const historial = screen.slice(screen.indexOf('Historial reciente'));
    expect(screen).toContain('sortHistorialReciente');
    expect(historial).not.toContain('sortAgendaRows');
    expect(screen).toContain('sortAgendaRows(programadas.filter((c) => isAgendaDelDia');
    expect(screen).toContain('sortAgendaRows(programadas.filter((c) => isAgendaFutura');
  });
});
