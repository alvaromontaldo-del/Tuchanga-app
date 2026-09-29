import { describe, expect, it } from 'vitest';
import { formatPickupOpeningHours } from './clientMaterialPickups';
import {
  copyTuesdayHoursToFriday,
  defaultStoreWeekSchedule,
  normalizeStoreWeekSchedule,
  patchStoreDaySlot,
  setStoreDayClosed,
  STORE_HOURS_TIME_ROW,
  STORE_WEEKDAY_LABELS,
  storeOpeningHoursEditorRows,
  storeWeekScheduleToJson,
  validateStoreWeekSchedule,
} from './storeOpeningHours';

describe('editor de horarios del comercio', () => {
  it('muestra lun a dom, cada uno con desde/hasta en la misma fila', () => {
    const rows = storeOpeningHoursEditorRows(defaultStoreWeekSchedule());
    expect(rows.map((row) => row.label)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
    expect(STORE_WEEKDAY_LABELS).toHaveLength(7);
    expect(rows.every((row) => row.closed === false)).toBe(true);
    expect(rows.every((row) => row.timeFieldsShareRow)).toBe(true);
    expect(STORE_HOURS_TIME_ROW.flexDirection).toBe('row');
    expect(rows[0].slots[0]).toEqual({ open: '09:00', close: '18:00' });
  });

  it('copia el horario de martes a miércoles, jueves y viernes', () => {
    let days = defaultStoreWeekSchedule();
    days = setStoreDayClosed(days, 7, true);
    days = patchStoreDaySlot(days, 2, 0, { open: '10:00', close: '16:00' });
    days = patchStoreDaySlot(days, 1, 0, { open: '08:00', close: '12:00' });
    days = patchStoreDaySlot(days, 6, 0, { open: '09:00', close: '13:00' });

    const copied = copyTuesdayHoursToFriday(days);
    for (const day of [3, 4, 5]) {
      const row = copied.find((item) => item.day === day);
      expect(row?.closed).toBe(false);
      expect(row?.slots).toEqual([{ open: '10:00', close: '16:00' }]);
    }
    expect(copied.find((item) => item.day === 1)?.slots[0].open).toBe('08:00');
    expect(copied.find((item) => item.day === 6)?.slots[0].close).toBe('13:00');
    expect(copied.find((item) => item.day === 7)?.closed).toBe(true);

    copied.find((item) => item.day === 5)!.slots[0].open = '11:00';
    expect(days.find((item) => item.day === 2)?.slots[0].open).toBe('10:00');
  });

  it('copia también el cerrado del martes y no pisa el finde', () => {
    let days = defaultStoreWeekSchedule();
    days = setStoreDayClosed(days, 2, true);
    const copied = copyTuesdayHoursToFriday(days);
    expect(copied.filter((day) => day.day >= 2 && day.day <= 5).every((day) => day.closed)).toBe(
      true,
    );
    expect(copied.find((day) => day.day === 1)?.closed).toBe(false);
    expect(copied.find((day) => day.day === 6)?.closed).toBe(false);
  });

  it('guarda cada día en el formato semanal y un cerrado con slots vacíos', () => {
    let days = defaultStoreWeekSchedule();
    days = patchStoreDaySlot(days, 1, 0, { open: '09:00', close: '15:00' });
    days = copyTuesdayHoursToFriday(
      patchStoreDaySlot(setStoreDayClosed(days, 7, true), 2, 0, { open: '09:00', close: '15:00' }),
    );
    days = patchStoreDaySlot(days, 6, 0, { open: '09:00', close: '13:00' });

    const json = storeWeekScheduleToJson(days);
    expect(json).toHaveLength(7);
    expect(json.find((day) => day.day === 7)?.slots).toEqual([]);
    expect(json.find((day) => day.day === 3)?.slots).toEqual([{ open: '09:00', close: '15:00' }]);
    expect(formatPickupOpeningHours(json)).toBe(
      'Lun a Vie: 09:00 a 15:00 · Sáb: 09:00 a 13:00 · Dom: cerrado',
    );
    expect(validateStoreWeekSchedule(days)).toBeNull();
  });

  it('lee el formato viejo de una o dos franjas y lo aplica a cada día', () => {
    const days = normalizeStoreWeekSchedule([
      { open: '08:00', close: '12:00' },
      { open: '15:00', close: '18:00' },
    ]);
    expect(days.map((day) => day.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days.every((day) => !day.closed)).toBe(true);
    expect(days[0].slots).toEqual([
      { open: '08:00', close: '12:00' },
      { open: '15:00', close: '18:00' },
    ]);
    const rows = storeOpeningHoursEditorRows(days);
    expect(rows[4].slots).toHaveLength(2);
    expect(rows[4].timeFieldsShareRow).toBe(true);
  });

  it('rechaza un día abierto con hora inválida y conserva el texto mientras se tipea', () => {
    const days = patchStoreDaySlot(defaultStoreWeekSchedule(), 1, 0, { open: '9' });
    expect(days[0].slots[0].open).toBe('9');
    expect(validateStoreWeekSchedule(days)).toBe('Lun: Usá horarios en formato HH:MM (ej. 09:00).');
  });
});
