import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isPinnedReviewInvite,
  shouldShowReviewInvite,
  shouldShowReviewInviteMessage,
} from './reviewInviteVisibility';

describe('aviso fijado de reseña (#212)', () => {
  it('sigue visible si el cliente todavía no calificó', () => {
    expect(shouldShowReviewInvite({ hasReview: false })).toBe(true);
    expect(
      shouldShowReviewInviteMessage({
        hasReview: false,
        text: '✅ Confirmaste que el trabajo fue realizado correctamente. ¡Gracias! Podés dejar tu reseña.',
        event: 'conformidad_aceptada',
      }),
    ).toBe(true);
  });

  it('se oculta cuando ya existe la reseña del trabajo', () => {
    expect(shouldShowReviewInvite({ hasReview: true })).toBe(false);
    expect(
      shouldShowReviewInviteMessage({
        hasReview: true,
        text: 'El profesional marcó el trabajo como finalizado. Podés dejar tu reseña.',
        event: 'trabajo_finalizado',
      }),
    ).toBe(false);
    expect(
      shouldShowReviewInviteMessage({
        hasReview: true,
        text: 'Ya podés dejar tu reseña.',
        event: 'saldo_confirmado_cliente',
      }),
    ).toBe(false);
    expect(
      shouldShowReviewInviteMessage({
        hasReview: true,
        text: 'Trabajo pagado. El cliente ya puede dejar su reseña.',
        event: 'saldo_confirmado_trabajador',
      }),
    ).toBe(false);
  });

  it('se oculta en cuanto se envía el puntaje, antes de releer la tabla', () => {
    expect(shouldShowReviewInvite({ hasReview: false, justSubmitted: true })).toBe(false);
    expect(
      shouldShowReviewInviteMessage({
        hasReview: false,
        justSubmitted: true,
        text: 'Podés dejar tu reseña en el chat.',
      }),
    ).toBe(false);
  });

  it('no esconde otros mensajes de sistema ni el aviso de disputa', () => {
    expect(isPinnedReviewInvite({ text: 'Horario confirmado', event: 'horario_confirmado' })).toBe(
      false,
    );
    expect(
      shouldShowReviewInviteMessage({
        hasReview: true,
        text: 'Horario confirmado',
        event: 'horario_confirmado',
      }),
    ).toBe(true);
    const disputa =
      'Indicaste que el trabajo no fue conforme. Si preferís, también podés dejar una reseña.';
    expect(
      shouldShowReviewInviteMessage({
        hasReview: true,
        text: disputa,
        event: 'conformidad_rechazada',
      }),
    ).toBe(true);
  });

  it('el chat y el detalle filtran el aviso con la reseña del trabajo', () => {
    const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const detail = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
    expect(chat).toContain('shouldShowReviewInvite(');
    expect(chat).toContain('shouldShowReviewInviteMessage(');
    expect(chat).toContain('fetchReviewForJob');
    expect(detail).toContain('shouldShowReviewInviteMessage(');
    expect(detail).toContain('fetchReviewForJob');
  });
});
