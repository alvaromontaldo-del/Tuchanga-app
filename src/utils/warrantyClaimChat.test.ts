import { describe, expect, it } from 'vitest';
import {
  WARRANTY_CLAIM_EVENT_GENERIC,
  otherChatCanBeClosed,
  resolveWarrantyClaimChat,
  warrantyClaimEventBody,
  claimInboxRowLabel,
  warrantyClaimEventFecha,
  type OwnClaimChat,
} from './warrantyClaimChat';

const contratacionId = '34e896fa-0000-4000-8000-000000000084';

function own(partial: Partial<OwnClaimChat> & Pick<OwnClaimChat, 'id' | 'active'>): OwnClaimChat {
  return {
    shared: false,
    markedForThisJob: false,
    foreignClaimMessages: false,
    ...partial,
  };
}

describe('resolveWarrantyClaimChat', () => {
  it('usa el chat propio si está activo y no toca el del otro trabajo', () => {
    expect(
      resolveWarrantyClaimChat({
        contratacionId,
        own: own({ id: 'chat-propio', active: true }),
        activePair: {
          id: 'chat-3cef',
          jobs: [{ id: 'e2846e27', estadoTrabajo: 'en_curso', isClaimOpen: false, claimStatus: 'none' }],
        },
      }),
    ).toEqual({
      kind: 'use',
      conversationId: 'chat-propio',
      closeConversationId: null,
      nameJobInEvent: false,
    });
  });

  it('si el propio es NULL, crea un chat cuando el par no tiene uno activo', () => {
    expect(
      resolveWarrantyClaimChat({
        contratacionId,
        own: null,
        activePair: null,
      }),
    ).toEqual({
      kind: 'create',
      conversationId: null,
      closeConversationId: null,
      nameJobInEvent: true,
    });
  });

  it('si el propio está borrado y no hay otro activo, crea uno nuevo', () => {
    expect(
      resolveWarrantyClaimChat({
        contratacionId,
        own: own({ id: 'chat-17ff', active: false }),
        activePair: null,
      }),
    ).toEqual({
      kind: 'create',
      conversationId: null,
      closeConversationId: null,
      nameJobInEvent: true,
    });
  });

  it('no cierra el chat de un trabajo en curso: el reclamo abre su propio hilo', () => {
    expect(
      resolveWarrantyClaimChat({
        contratacionId,
        own: own({ id: 'chat-17ff', active: false }),
        activePair: {
          id: 'chat-3cef',
          jobs: [{ id: 'e2846e27', estadoTrabajo: 'en_curso', isClaimOpen: false, claimStatus: 'none' }],
        },
      }),
    ).toEqual({
      kind: 'create',
      conversationId: null,
      closeConversationId: null,
      nameJobInEvent: true,
    });
  });

  it('no cierra el chat si el otro trabajo tiene un reclamo abierto o pendiente', () => {
    for (const claimStatus of ['open', 'pending_approval'] as const) {
      expect(
        otherChatCanBeClosed(
          [{ id: 'otro', estadoTrabajo: 'finalizado', isClaimOpen: true, claimStatus }],
          contratacionId,
        ),
      ).toBe(false);
      expect(
        resolveWarrantyClaimChat({
          contratacionId,
          own: null,
          activePair: {
            id: 'chat-3cef',
            jobs: [{ id: 'otro', estadoTrabajo: 'finalizado', isClaimOpen: true, claimStatus }],
          },
        }).closeConversationId,
      ).toBeNull();
    }
  });

  it('tres reclamos del mismo trabajador no comparten el hilo ni cierran el de otro reclamo', () => {
    const jobs = [
      { id: 'a', estadoTrabajo: 'finalizado', isClaimOpen: true, claimStatus: 'open' },
      { id: 'b', estadoTrabajo: 'finalizado', isClaimOpen: true, claimStatus: 'pending_approval' },
      { id: 'c', estadoTrabajo: 'finalizado', isClaimOpen: false, claimStatus: 'closed' },
    ];
    for (const job of jobs) {
      expect(
        resolveWarrantyClaimChat({
          contratacionId: job.id,
          own: own({ id: 'chat-3cef', active: true, shared: true }),
          activePair: { id: 'chat-3cef', jobs },
        }),
      ).toEqual({
        kind: 'create',
        conversationId: null,
        closeConversationId: null,
        nameJobInEvent: true,
      });
    }
  });

  it('si el hilo ya es de esta contratación, lo reutiliza', () => {
    expect(
      resolveWarrantyClaimChat({
        contratacionId,
        own: own({ id: 'chat-propio', active: true, markedForThisJob: true, shared: true }),
        activePair: null,
      }),
    ).toEqual({
      kind: 'use',
      conversationId: 'chat-propio',
      closeConversationId: null,
      nameJobInEvent: false,
    });
  });

  it('cierra el otro chat solo si su trabajo está finalizado y sin reclamo', () => {
    expect(
      resolveWarrantyClaimChat({
        contratacionId,
        own: own({ id: 'chat-17ff', active: false }),
        activePair: {
          id: 'chat-viejo',
          jobs: [{ id: 'otro', estadoTrabajo: 'finalizado', isClaimOpen: false, claimStatus: 'closed' }],
        },
      }),
    ).toEqual({
      kind: 'create',
      conversationId: null,
      closeConversationId: 'chat-viejo',
      nameJobInEvent: true,
    });
  });

  it('no cierra un chat cancelado, en disputa o mezclado con un trabajo en curso', () => {
    expect(
      otherChatCanBeClosed(
        [{ id: 'otro', estadoTrabajo: 'cancelado', isClaimOpen: false, claimStatus: 'none' }],
        contratacionId,
      ),
    ).toBe(false);
    expect(
      otherChatCanBeClosed(
        [{ id: 'otro', estadoTrabajo: 'disputa', isClaimOpen: false, claimStatus: 'none' }],
        contratacionId,
      ),
    ).toBe(false);
    expect(
      otherChatCanBeClosed(
        [
          { id: 'listo', estadoTrabajo: 'finalizado', isClaimOpen: false, claimStatus: 'none' },
          { id: 'vivo', estadoTrabajo: 'aceptado', isClaimOpen: false, claimStatus: 'none' },
        ],
        contratacionId,
      ),
    ).toBe(false);
  });
});

describe('claimInboxRowLabel', () => {
  it('distingue el hilo por servicio y fecha, no por el último mensaje', () => {
    expect(claimInboxRowLabel({ serviceDetail: '  Pintura de frente  ', fecha: '12/09/2026' })).toBe(
      'Reclamo · Pintura de frente · 12/09/2026',
    );
    expect(claimInboxRowLabel({ serviceDetail: 'Gasista\nmatutino', fecha: '' })).toBe('Reclamo · Gasista matutino');
    expect(claimInboxRowLabel({ serviceDetail: '   ', fecha: '01/09/2026' })).toBe('Reclamo · 01/09/2026');
    expect(claimInboxRowLabel({ serviceDetail: '', fecha: '' })).toBe('Reclamo');
  });
});

describe('warrantyClaimEventBody', () => {
  it('en el chat propio el texto no cambia', () => {
    expect(warrantyClaimEventBody({ nameJob: false, serviceDetail: 'Pintura', fecha: '12/09/2026' })).toBe(
      WARRANTY_CLAIM_EVENT_GENERIC,
    );
  });

  it('en el hilo propio del reclamo nombra el servicio y la fecha', () => {
    expect(
      warrantyClaimEventBody({ nameJob: true, serviceDetail: '  Pintura de frente  ', fecha: '12/09/2026' }),
    ).toBe(
      'El cliente inició un reclamo de garantía por «Pintura de frente» del 12/09/2026. Coordinen la revisión por este chat. La garantía sigue su curso.',
    );
  });

  it('arma la fecha del trabajo, o si no hay, la de finalización en Argentina', () => {
    expect(
      warrantyClaimEventFecha({
        fechaTrabajo: '2026-09-12',
        finalizadoAt: '2026-09-01T03:00:00.000Z',
      }),
    ).toBe('12/09/2026');
    expect(
      warrantyClaimEventFecha({
        fechaTrabajo: null,
        finalizadoAt: '2026-09-02T02:30:00.000Z',
      }),
    ).toBe('01/09/2026');
  });
});
