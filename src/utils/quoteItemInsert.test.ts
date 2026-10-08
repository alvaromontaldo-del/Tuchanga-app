import { describe, expect, it } from 'vitest';
import { isLegacyQuoteItemInsertError } from './quoteItemInsert';

describe('isLegacyQuoteItemInsertError', () => {
  it('reintenta si falta una columna del esquema viejo', () => {
    expect(
      isLegacyQuoteItemInsertError({
        message: 'column quote_items.variant_index does not exist',
        code: '42703',
      }),
    ).toBe(true);
  });

  it('no esconde un choque de unique: se perderían las otras marcas', () => {
    expect(
      isLegacyQuoteItemInsertError({
        message:
          'duplicate key value violates unique constraint "quote_items_quote_id_request_item_id_key"',
        code: '23505',
      }),
    ).toBe(false);
    expect(
      isLegacyQuoteItemInsertError({
        message: 'duplicate key value violates unique constraint "quote_items_quote_id_request_item_id_key"',
      }),
    ).toBe(false);
  });
});
