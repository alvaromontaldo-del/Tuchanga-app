/**
 * El insert de quote_items reintenta sin columnas nuevas solo si el esquema
 * todavía no las tiene. Un unique (varias marcas) no puede caer en ese
 * fallback: si no, se guarda la primera marca y el resto se pierde en silencio.
 */
export function isLegacyQuoteItemInsertError(error: {
  message?: string | null;
  code?: string | null;
} | null): boolean {
  if (!error) return false;
  if (error.code === '23505') return false;
  const message = error.message ?? '';
  if (/duplicate key|unique constraint|23505/i.test(message)) return false;
  return /variant_index|variant_label|in_stock|alternative_description|item_note|schema cache|column/i.test(
    message,
  );
}
