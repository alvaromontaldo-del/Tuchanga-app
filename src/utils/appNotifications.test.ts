import { describe, expect, it } from 'vitest';
import {
  APP_NOTIFICATION_CATALOG,
  APP_NOTIFICATION_FORBIDDEN_KEYS,
  APP_NOTIFICATION_INBOX_TYPES,
  audiencesForAppNotifications,
  isOfficialStorePushKind,
  parseAppNotificationRow,
  routeForAppNotification,
} from './appNotifications';

describe('avisos de YaChanga (#218)', () => {
  it('en el inicio junta cliente y profesional; en comercio solo comercio', () => {
    expect(audiencesForAppNotifications({ isCommerceShell: false })).toEqual([
      'cliente',
      'profesional',
    ]);
    expect(audiencesForAppNotifications({ isCommerceShell: true })).toEqual(['comercio']);
  });

  it('reconoce los avisos oficiales del comercio y no el tablero de pedidos', () => {
    expect(isOfficialStorePushKind('store_approved')).toBe(true);
    expect(isOfficialStorePushKind('store_trial_notice_10')).toBe(true);
    expect(isOfficialStorePushKind('store_board')).toBe(false);
    expect(isOfficialStorePushKind('nueva_solicitud')).toBe(false);
  });

  it('abre el perfil profesional para matrícula o aprobación, y no un desglose de plata', () => {
    expect(routeForAppNotification('professional_aprobado', false)).toEqual({
      shell: 'main',
      screen: 'WorkerABM',
    });
    expect(routeForAppNotification('matricula_aprobada', false)).toEqual({
      shell: 'main',
      screen: 'WorkerABM',
    });
    expect(routeForAppNotification('store_trial_notice_20', true)).toEqual({
      shell: 'commerce',
      screen: 'AppNotifications',
    });
  });

  it('parsea una fila sin exponer apellido, pin ni saldo', () => {
    const row = parseAppNotificationRow({
      id: '11111111-1111-4111-8111-111111111111',
      audience: 'profesional',
      type: 'professional_aprobado',
      title: 'Perfil profesional aprobado',
      body: 'Tu perfil profesional ya está visible en YaChanga. Ya podés recibir consultas.',
      data: { kind: 'professional_aprobado' },
      store_id: null,
      read_at: null,
      created_at: '2026-11-12T21:00:00.000Z',
    });
    expect(row?.title).toBe('Perfil profesional aprobado');
    for (const key of APP_NOTIFICATION_FORBIDDEN_KEYS) {
      expect(row).not.toHaveProperty(key);
      expect(JSON.stringify(row)).not.toMatch(new RegExp(key, 'i'));
    }
  });

  it('el catálogo declara qué entra al inbox y deja afuera chat, tablero y PIN', () => {
    const inbox = APP_NOTIFICATION_CATALOG.filter((item) => item.inInbox).map((item) => item.type);
    expect(inbox.sort()).toEqual([...APP_NOTIFICATION_INBOX_TYPES].sort());
    const excluded = APP_NOTIFICATION_CATALOG.filter((item) => !item.inInbox).map((item) => item.type);
    expect(excluded).toEqual(expect.arrayContaining(['chat_message', 'store_board', 'payment_or_pin']));
  });
});
