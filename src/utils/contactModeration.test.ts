import { describe, expect, it } from 'vitest';
import { mapChatSendError } from './chatErrors';
import {
  detectBlockedContact,
  validateContactInfo,
  validateWorkerProfileTexts,
} from './contactModeration';
import { mapContentModerationError } from './contentModerationErrors';

const POLICY =
  'Por políticas de seguridad, no está permitido compartir datos de contacto fuera de la plataforma.';

describe('contact moderation disabled', () => {
  it.each([
    'Cinta',
    'Cable',
    'se viene el calor',
    'Perfecto, se viene el calor de la',
    '11 1234 5678',
    '364565566',
    'whatsapp 11 5555 6666',
    'juan@mail.com',
    'Av. San Martín 1234',
    'llamame al celu',
  ])('permite «%s»', (text) => {
    const result = validateContactInfo(text);
    expect(result.blocked).toBe(false);
    expect(result.match).toBeNull();
    expect(result.message).toBeNull();
    expect(detectBlockedContact(text)).toBeNull();
    expect(JSON.stringify(result)).not.toContain(POLICY);
  });

  it('no marca descripciones de perfil', () => {
    const result = validateWorkerProfileTexts('Electricista, cel 1133445566', [
      'Cinta aisladora y cable de 2.5',
    ]);
    expect(result.hasViolation).toBe(false);
    expect(result.professional.blocked).toBe(false);
    expect(result.tradeDescriptions.every((r) => !r.blocked)).toBe(true);
  });

  it('no reescribe errores de base con el aviso de política', () => {
    const err = new Error('message_blocked_contact');
    expect(mapContentModerationError(err)).not.toContain('políticas de seguridad');
    expect(mapChatSendError(err)).not.toContain('políticas de seguridad');
    expect(mapChatSendError(new Error('rate_limit_exceeded'))).toContain('demasiados mensajes');
  });
});
