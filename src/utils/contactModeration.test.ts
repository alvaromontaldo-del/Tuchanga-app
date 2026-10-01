import { describe, expect, it } from 'vitest';
import { mapChatSendError } from './chatErrors';
import {
  contactBlockedReason,
  detectBlockedContact,
  messageContactBlockedReason,
  validateContactInfo,
  validateWorkerProfileTexts,
} from './contactModeration';
import { mapContentModerationError } from './contentModerationErrors';

const POLICY =
  'Por políticas de seguridad, no está permitido compartir datos de contacto fuera de la plataforma.';

const MESSAGE_TYPES = ['text', 'image', 'budget', 'quotation'] as const;

const ALLOWED_TEXTS = [
  'Cinta',
  'Cable',
  'se viene el calor',
  'Perfecto, se viene el calor de la',
  'Cinta aisladora y cable de 2.5',
  'Av. San Martín 1234',
  'mandame un mail cuando termines',
  'hablamos por whatsapp en la obra',
  'meta de la semana y calle interna',
  'llamame cuando llegues',
  'Nuevo presupuesto de materiales: $1.234.567. Tocá para ver el detalle (el comercio se revela al pagar la seña).',
  'Seña de $15.000 confirmada el 23/06/2026 17:16',
  'cuesta 12.345.678 pesos',
];

const PHONES = ['11 1234 5678', '364565566', '+54 9 11 5555-6666', '11-5555-6666', '11.5555.6666'];
const EMAILS = ['juan@mail.com', 'Ana.Perez+obra@gmail.com'];

describe('moderación anti-contacto relajada', () => {
  it.each(ALLOWED_TEXTS)('deja pasar «%s»', (text) => {
    expect(contactBlockedReason(text)).toBeNull();
    expect(validateContactInfo(text).blocked).toBe(false);
    expect(detectBlockedContact(text)).toBeNull();
  });

  it.each(PHONES)('bloquea el teléfono «%s»', (text) => {
    expect(contactBlockedReason(text)).toBe('telefono_num');
    const result = validateContactInfo(text);
    expect(result.blocked).toBe(true);
    expect(result.message).toBe(POLICY);
    expect(detectBlockedContact(text)?.keyword).toBe('telefono_num');
  });

  it.each(EMAILS)('bloquea el email «%s»', (text) => {
    expect(contactBlockedReason(text)).toBe('email');
    expect(validateContactInfo(text).message).toBe(POLICY);
  });

  it.each(MESSAGE_TYPES)('en mensajes %s deja pasar palabras de obra y bloquea contacto', (type) => {
    for (const text of ALLOWED_TEXTS) {
      expect(messageContactBlockedReason(type, text, {})).toBeNull();
    }
    for (const text of PHONES) {
      expect(messageContactBlockedReason(type, text, {})).toBe('telefono_num');
    }
    for (const text of EMAILS) {
      expect(messageContactBlockedReason(type, text, {})).toBe('email');
    }
  });

  it('modera el epígrafe de la imagen y la descripción del presupuesto', () => {
    expect(
      messageContactBlockedReason('image', '📷 Foto', { caption: 'cinta aisladora y cable' }),
    ).toBeNull();
    expect(
      messageContactBlockedReason('image', '📷 Foto', { caption: '11 1234 5678' }),
    ).toBe('telefono_num');
    expect(
      messageContactBlockedReason('budget', 'Presupuesto', {
        service_detail: 'cinta y cable, se viene el calor',
      }),
    ).toBeNull();
    expect(
      messageContactBlockedReason('budget', 'Presupuesto', { description: 'juan@mail.com' }),
    ).toBe('email');
    expect(
      messageContactBlockedReason('quotation', 'Cotización', { service_detail: '364565566' }),
    ).toBe('telefono_num');
    expect(
      messageContactBlockedReason('quotation', 'Cotización', { title: 'cinta' }),
    ).toBeNull();
  });

  it('no trata la URL de la foto ni el timestamp del path como teléfono', () => {
    expect(
      messageContactBlockedReason('image', '📷 Foto', {
        image_url:
          'https://proj.supabase.co/storage/v1/object/public/job-photos/30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/1730000000000-ab.jpg',
        image_path: '30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/1730000000000-ab.jpg',
      }),
    ).toBeNull();
  });

  it('no filtra mensajes system (pago, PIN, reclamo)', () => {
    expect(
      messageContactBlockedReason(
        'system',
        'Seña confirmada el 23/06/2026 17:16. PIN 4821. 11 1234 5678',
        { event: 'seña_pagada_cliente' },
      ),
    ).toBeNull();
  });

  it('no marca descripciones de perfil (#85)', () => {
    const result = validateWorkerProfileTexts('Electricista, cel 1133445566', [
      'Cinta aisladora y cable de 2.5',
    ]);
    expect(result.hasViolation).toBe(false);
    expect(result.professional.blocked).toBe(false);
    expect(result.tradeDescriptions.every((r) => !r.blocked)).toBe(true);
  });

  it('traduce el rechazo del chat y no el de otros formularios', () => {
    const err = new Error('message_blocked_contact');
    expect(mapChatSendError(err)).toBe(POLICY);
    expect(mapContentModerationError(err)).not.toContain('políticas de seguridad');
    expect(mapChatSendError(new Error('rate_limit_exceeded'))).toContain('demasiados mensajes');
    expect(mapChatSendError(new Error('system_message_forbidden'))).toContain('sistema');
  });
});
