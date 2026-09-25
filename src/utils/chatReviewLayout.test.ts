import { describe, expect, it } from 'vitest';
import {
  CHAT_MESSAGE_LIST_MIN_HEIGHT,
  shouldMountChatMessageList,
  splitChatBodyHeight,
} from './chatReviewLayout';

describe('shouldMountChatMessageList', () => {
  const openChat = {
    loading: false,
    claimLockLoading: false,
    chatClosedByClaim: false,
  };

  it('mantiene el historial montado con el input de reseña enfocado', () => {
    expect(
      shouldMountChatMessageList({
        ...openChat,
        reviewInputFocused: true,
      }),
    ).toBe(true);
  });

  it('no cambia el montaje del historial al enfocar o soltar la reseña', () => {
    expect(shouldMountChatMessageList({ ...openChat, reviewInputFocused: false })).toBe(
      shouldMountChatMessageList({ ...openChat, reviewInputFocused: true }),
    );
  });

  it('sigue ocultando la lista solo mientras carga o el chat está cerrado por reclamo', () => {
    expect(
      shouldMountChatMessageList({
        ...openChat,
        loading: true,
        reviewInputFocused: true,
      }),
    ).toBe(false);
    expect(
      shouldMountChatMessageList({
        ...openChat,
        chatClosedByClaim: true,
        reviewInputFocused: false,
      }),
    ).toBe(false);
  });
});

describe('splitChatBodyHeight', () => {
  it('no deja el historial en 0 cuando la reseña y el teclado ocupan el pie', () => {
    const result = splitChatBodyHeight({
      availableHeight: 280,
      footerContentHeight: 360,
    });

    expect(result.messageListHeight).toBeGreaterThanOrEqual(CHAT_MESSAGE_LIST_MIN_HEIGHT);
    expect(result.footerHeight).toBeGreaterThan(0);
    expect(result.footerScrolls).toBe(true);
    expect(result.messageListHeight + result.footerHeight).toBe(280);
  });

  it('cede el alto sobrante a los mensajes cuando el pie entra entero', () => {
    const result = splitChatBodyHeight({
      availableHeight: 520,
      footerContentHeight: 86,
    });

    expect(result.footerHeight).toBe(86);
    expect(result.messageListHeight).toBe(434);
    expect(result.footerScrolls).toBe(false);
  });

  it('reserva historial visible aunque el cuerpo quede justo', () => {
    const result = splitChatBodyHeight({
      availableHeight: 200,
      footerContentHeight: 320,
    });

    expect(result.messageListHeight).toBeGreaterThan(0);
    expect(result.footerScrolls).toBe(true);
    expect(result.messageListHeight + result.footerHeight).toBe(200);
  });
});
