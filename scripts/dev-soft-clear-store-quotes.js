/**
 * Soft-clear de cotizaciones de prueba de UN comercio (dev).
 *
 * Uso:
 *   node scripts/dev-soft-clear-store-quotes.js <store_id>
 *
 * Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en el entorno.
 * NO borra órdenes pagadas / cerradas.
 */
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const storeId = process.argv[2];
  if (!storeId) {
    console.error('Uso: node scripts/dev-soft-clear-store-quotes.js <store_id>');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: quotes, error } = await sb
    .from('quotes')
    .select('id, status, orders ( id, status, deposit_status, contact_revealed_at )')
    .eq('store_id', storeId)
    .in('status', ['sent', 'draft']);

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const safeIds = [];
  for (const q of quotes ?? []) {
    const orders = Array.isArray(q.orders) ? q.orders : q.orders ? [q.orders] : [];
    const paid = orders.some(
      (o) =>
        o.deposit_status === 'paid' ||
        o.deposit_status === 'waived' ||
        o.status === 'deposit_paid' ||
        o.status === 'completed' ||
        o.contact_revealed_at,
    );
    if (!paid) safeIds.push(q.id);
  }

  if (safeIds.length === 0) {
    console.log('Nada para limpiar (o solo hay cotizaciones pagadas).');
    return;
  }

  const { error: upErr } = await sb
    .from('quotes')
    .update({ status: 'rejected' })
    .in('id', safeIds);

  if (upErr) {
    console.error(upErr.message);
    process.exit(1);
  }
  console.log(`Soft-rejected ${safeIds.length} quote(s) del store ${storeId}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
