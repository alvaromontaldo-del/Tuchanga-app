import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activeMaterialRequestQuoteCount,
  materialQuoteChatCard,
  visibleMaterialQuotes,
} from './materialQuoteVisibility';

describe('cotizaciones de materiales rechazadas', () => {
  it('si no queda ninguna, oculta la sección y el botón', () => {
    expect(
      materialQuoteChatCard(
        [
          { status: 'rejected', storeId: 'a' },
          { status: 'rejected', storeId: 'b' },
        ],
        { quoteCount: 2, storeCount: 2 },
      ),
    ).toEqual({ show: false, quoteCount: 0, storeCount: 0 });

    expect(materialQuoteChatCard([], { quoteCount: 1, storeCount: 1 }).show).toBe(false);
  });

  it('si quedan, cuenta solo las no rechazadas', () => {
    const card = materialQuoteChatCard(
      [
        { status: 'rejected', storeId: 'a' },
        { status: 'sent', storeId: 'b' },
        { status: 'accepted', storeId: 'c' },
      ],
      { quoteCount: 3, storeCount: 3 },
    );
    expect(card.show).toBe(true);
    expect(card.quoteCount).toBe(2);
    expect(card.storeCount).toBe(2);
    expect(
      visibleMaterialQuotes([
        { status: 'rejected' },
        { status: 'sent' },
        { status: 'accepted' },
      ]).map((q) => q.status),
    ).toEqual(['sent', 'accepted']);
  });

  it('mientras no hay estado real, no esconde el botón', () => {
    expect(materialQuoteChatCard(null, { quoteCount: 2, storeCount: 1 })).toEqual({
      show: true,
      quoteCount: 2,
      storeCount: 1,
    });
  });

  it('un pedido con todas rechazadas sale de la lista; uno sin respuestas no', () => {
    expect(
      activeMaterialRequestQuoteCount([{ status: 'rejected' }, { status: 'rejected' }]),
    ).toBeNull();
    expect(activeMaterialRequestQuoteCount([])).toBe(0);
    expect(
      activeMaterialRequestQuoteCount([{ status: 'sent' }, { status: 'rejected' }]),
    ).toBe(1);
  });

  it('el chat oculta el botón y la comparación no lista rechazadas', () => {
    const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const compare = readFileSync('src/screens/client/ClientCompareQuotesScreen.tsx', 'utf8');
    const list = readFileSync('src/services/clientQuotesSupabase.ts', 'utf8');
    expect(chat).toContain('materialQuoteChatCard');
    expect(chat).toContain('>Ver cotizaciones<');
    expect(chat).toContain('if (!materialCard.show) return null');
    expect(compare).toContain('visibleMaterialQuotes(g.quotes)');
    expect(list).toContain('isRejectedMaterialQuote(row.status)');
    expect(list).toContain('activeMaterialRequestQuoteCount');
  });
});
