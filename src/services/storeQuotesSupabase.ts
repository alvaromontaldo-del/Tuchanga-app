import { getSupabaseClient } from '../lib/supabase';
import type {
  ExistingStoreQuote,
  ExistingStoreQuoteItem,
  FreightType,
  MaterialRequestItem,
  MaterialRequestStatus,
  MyStoreSummary,
  RequestTargetStoreStatus,
  StoreBoardCard,
  StoreBoardColumn,
  StoreIncomingRequest,
  StoreRequestDetail,
} from '../types/materials';
import { formatOrderCodeDisplay } from '../utils/orderCode';
import { parseIncludeFreightFlag, storeAmountDue } from '../utils/quoteFreightTotal';

export async function fetchMyStores(): Promise<MyStoreSummary[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  const { data, error } = await sb
    .from('stores')
    .select('id, name, status, avatar_url')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    // Compat: columna avatar_url aún no migrada.
    if (/avatar_url|schema cache|column/i.test(error.message ?? '')) {
      const fallback = await sb
        .from('stores')
        .select('id, name, status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (fallback.error) throw fallback.error;
      return (fallback.data ?? []).map((r) => ({
        id: r.id as string,
        name: (r.name as string) || 'Comercio',
        status: (r.status as string) || '',
        avatarUrl: null,
      }));
    }
    throw error;
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.name as string) || 'Comercio',
    status: (r.status as string) || '',
    avatarUrl: (r.avatar_url as string | null) ?? null,
  }));
}

export async function updateMyStoreAvatarFromUri(
  storeId: string,
  localUri: string,
): Promise<string> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error('Tenés que iniciar sesión.');

  const normalized = localUri.trim();
  if (!normalized) throw new Error('URI de imagen vacío.');

  const res = await fetch(normalized);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (!bytes.byteLength) {
    throw new Error('La imagen quedó vacía. Elegí otra foto.');
  }

  const path = `${user.id}/store-${storeId}-${Date.now()}.jpg`;
  const { error: upErr } = await sb.storage.from('avatars').upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: '3600',
  });
  if (upErr) {
    throw new Error(
      upErr.message ||
        'No se pudo subir la foto. Revisá permisos de galería y del bucket avatars.',
    );
  }

  const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { error: rpcErr } = await sb.rpc('set_my_store_avatar_url', {
    p_store_id: storeId,
    p_url: publicUrl,
  });
  if (rpcErr) {
    const { error: directErr } = await sb
      .from('stores')
      .update({ avatar_url: publicUrl })
      .eq('id', storeId)
      .eq('user_id', user.id);
    if (directErr) {
      throw new Error(
        `La foto se subió pero no quedó en el comercio (${rpcErr.message}).`,
      );
    }
  }

  return publicUrl;
}

type TargetRow = {
  id: string;
  status: string;
  store_id: string;
  created_at: string;
  stores: { id: string; name: string } | { id: string; name: string }[] | null;
  material_requests: {
    id: string;
    title: string;
    status: string;
    client_id: string | null;
    created_at: string;
    request_items: { id: string }[] | null;
  } | {
    id: string;
    title: string;
    status: string;
    client_id: string | null;
    created_at: string;
    request_items: { id: string }[] | null;
  }[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * Pedidos dirigidos a los comercios del usuario (inbox mostrador).
 */
export async function fetchStoreIncomingRequests(): Promise<StoreIncomingRequest[]> {
  const stores = await fetchMyStores();
  if (stores.length === 0) return [];

  const sb = getSupabaseClient();
  const storeIds = stores.map((s) => s.id);

  const { data, error } = await sb
    .from('request_target_stores')
    .select(
      `
      id,
      status,
      store_id,
      created_at,
      stores ( id, name ),
      material_requests (
        id,
        title,
        status,
        client_id,
        created_at,
        request_items ( id )
      )
    `,
    )
    .in('store_id', storeIds)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as TargetRow[];
  return rows
    .map((row): StoreIncomingRequest | null => {
      const mr = one(row.material_requests);
      const store = one(row.stores);
      if (!mr) return null;
      return {
        targetId: row.id,
        targetStatus: row.status as RequestTargetStoreStatus,
        requestId: mr.id,
        title: mr.title,
        status: mr.status as MaterialRequestStatus,
        clientId: mr.client_id,
        createdAt: mr.created_at,
        itemCount: mr.request_items?.length ?? 0,
        storeId: row.store_id,
        storeName: store?.name ?? 'Comercio',
      };
    })
    .filter((x): x is StoreIncomingRequest => x != null);
}

function firstNameFromProfile(nombre: string | null | undefined): string | null {
  const raw = (nombre ?? '').trim();
  if (!raw) return null;
  return raw.split(/\s+/)[0] ?? null;
}

/**
 * Estado Kanban del comercio.
 *
 * Cotizadas = quote `sent` / fee pendiente (`pending_deposit`) — cliente aún NO pagó.
 * Confirmadas = fee YaChanga pagado (`deposit_paid` / `deposit_status=paid` /
 *   `contact_revealed_at` / quote `accepted` post-pago).
 * Rechazadas = quote rejected o todos los ítems rejected sin pago.
 * Nunca: paid en Cotizadas; nunca: “aceptada sin pagar” en Confirmadas (eso se repara en SQL).
 */
export function resolveBoardColumn(params: {
  targetStatus: RequestTargetStoreStatus;
  quoteStatus: string | null;
  orderStatus: string | null;
  depositStatus: string | null;
  contactRevealedAt?: string | null;
  allItemsRejected?: boolean;
  hasAcceptedItem?: boolean;
}): StoreBoardColumn {
  const {
    targetStatus,
    quoteStatus,
    orderStatus,
    depositStatus,
    contactRevealedAt,
    allItemsRejected,
    hasAcceptedItem,
  } = params;
  const qStatus = (quoteStatus ?? '').toLowerCase();
  const oStatus = (orderStatus ?? '').toLowerCase();
  const dStatus = (depositStatus ?? '').toLowerCase();

  if (oStatus === 'completed') return 'cerradas';

  // Fee YaChanga pagado → Confirmadas (preparar / retiro).
  if (
    oStatus === 'deposit_paid' ||
    dStatus === 'paid' ||
    dStatus === 'waived' ||
    Boolean(contactRevealedAt)
  ) {
    return 'confirmadas';
  }

  // Rechazo total del cliente (quote o todos los ítems) — sin fee pagado.
  if (qStatus === 'rejected' || (allItemsRejected && !hasAcceptedItem)) {
    return 'rechazadas';
  }

  // Fee pendiente → Cotizadas (incluye legado accepted+pending sin backfill).
  if (oStatus === 'pending_deposit' || oStatus === 'pending') {
    return 'cotizadas';
  }

  // Post-pago: quote.accepted solo se setea al acreditar el fee (sin orden visible → Confirmadas).
  if (qStatus === 'accepted') {
    return 'confirmadas';
  }

  // Cotización enviada, cliente aún no pagó.
  if (qStatus === 'sent' || targetStatus === 'quoted') {
    return 'cotizadas';
  }

  return 'nuevas';
}

/** Prefiere orden pagada/cerrada si hay varias filas por el mismo quote_id. */
function preferBoardOrder(
  prev: {
    id: string;
    order_code: string;
    status: string;
    deposit_status: string | null;
    accepted_total: number | null;
    deposit_amount: number | null;
    contact_revealed_at?: string | null;
    include_freight?: boolean | null;
  } | undefined,
  next: {
    id: string;
    order_code: string;
    status: string;
    deposit_status: string | null;
    accepted_total: number | null;
    deposit_amount: number | null;
    contact_revealed_at?: string | null;
    include_freight?: boolean | null;
  },
): typeof next {
  if (!prev) return next;
  const rank = (o: typeof next) => {
    const st = (o.status ?? '').toLowerCase();
    const dep = (o.deposit_status ?? '').toLowerCase();
    if (st === 'completed') return 4;
    if (st === 'deposit_paid' || dep === 'paid' || dep === 'waived' || o.contact_revealed_at) {
      return 3;
    }
    if (st === 'pending_deposit' || st === 'pending') return 2;
    return 1;
  };
  return rank(next) >= rank(prev) ? next : prev;
}

type QuoteItemRow = {
  unit_price: number | string;
  client_decision?: string | null;
  request_item_id?: string;
  request_items?:
    | { id: string; description: string | null }
    | { id: string; description: string | null }[]
    | null;
};

/**
 * Tablero Kanban del comercio: targets + quote + orden asociada.
 */
export async function fetchStoreBoardCards(): Promise<StoreBoardCard[]> {
  const stores = await fetchMyStores();
  if (stores.length === 0) return [];

  const sb = getSupabaseClient();
  const storeIds = stores.map((s) => s.id);

  const { data, error } = await sb
    .from('request_target_stores')
    .select(
      `
      id,
      status,
      store_id,
      created_at,
      material_requests (
        id,
        title,
        status,
        client_id,
        created_at,
        request_items ( id )
      )
    `,
    )
    .in('store_id', storeIds)
    .neq('status', 'declined')
    .order('created_at', { ascending: false });

  if (error) throw error;

  type BoardTargetRow = {
    id: string;
    status: string;
    store_id: string;
    created_at: string;
    material_requests:
      | {
          id: string;
          title: string;
          status: string;
          client_id: string | null;
          created_at: string;
          request_items: { id: string }[] | null;
        }
      | {
          id: string;
          title: string;
          status: string;
          client_id: string | null;
          created_at: string;
          request_items: { id: string }[] | null;
        }[]
      | null;
  };

  const rows = (data ?? []) as BoardTargetRow[];
  const requestIds = rows
    .map((r) => one(r.material_requests)?.id)
    .filter((id): id is string => Boolean(id));

  const clientIds = Array.from(
    new Set(
      rows
        .map((r) => one(r.material_requests)?.client_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const clientNameById = new Map<string, string>();
  if (clientIds.length > 0) {
    const profilesRes = await sb.from('profiles').select('id, nombre').in('id', clientIds);
    if (!profilesRes.error) {
      for (const p of profilesRes.data ?? []) {
        const first = firstNameFromProfile(
          (p as { nombre?: string | null }).nombre,
        );
        if (first) clientNameById.set(String((p as { id: string }).id), first);
      }
    }
  }

  type OrderRel = {
    id: string;
    order_code: string;
    status: string;
    deposit_status: string | null;
    accepted_total: number | null;
    deposit_amount: number | null;
    contact_revealed_at?: string | null;
    include_freight?: boolean | null;
  };
  type QuoteRel = {
    id: string;
    request_id: string;
    store_id: string;
    status: string;
    created_at: string | null;
    freight_type: string | null;
    freight_cost: number | null;
    quote_items: QuoteItemRow[] | null;
    orders: OrderRel | OrderRel[] | null;
  };

  const quoteByKey = new Map<string, QuoteRel>();
  if (requestIds.length > 0) {
    let quoteRows: Record<string, unknown>[] = [];
    const fullQuotes = await sb
      .from('quotes')
      .select(
        `
        id,
        request_id,
        store_id,
        status,
        created_at,
        freight_type,
        freight_cost,
        quote_items (
          unit_price,
          client_decision,
          request_item_id,
          request_items ( id, description )
        )
      `,
      )
      .in('request_id', requestIds)
      .in('store_id', storeIds);

    if (
      fullQuotes.error &&
      /client_decision|freight_type|schema cache|column/i.test(fullQuotes.error.message ?? '')
    ) {
      const legacy = await sb
        .from('quotes')
        .select(
          `
          id,
          request_id,
          store_id,
          status,
          created_at,
          freight_cost,
          quote_items (
            unit_price,
            request_item_id,
            request_items ( id, description )
          )
        `,
        )
        .in('request_id', requestIds)
        .in('store_id', storeIds);
      if (legacy.error) throw legacy.error;
      quoteRows = (legacy.data ?? []) as Record<string, unknown>[];
    } else if (fullQuotes.error) {
      throw fullQuotes.error;
    } else {
      quoteRows = (fullQuotes.data ?? []) as Record<string, unknown>[];
    }

    const quoteIds = quoteRows.map((q) => String(q.id)).filter(Boolean);

    // Carga fiable de orders por quote_ids (evita embeds PostgREST incompletos / cache).
    const ordersByQuote = new Map<string, OrderRel>();
    if (quoteIds.length > 0) {
      const ordersWithFreight = await sb
        .from('orders')
        .select(
          'id, quote_id, order_code, status, deposit_status, accepted_total, deposit_amount, contact_revealed_at, include_freight',
        )
        .in('quote_id', quoteIds);
      let orderRows = (ordersWithFreight.data ?? []) as Array<Record<string, unknown>>;
      if (
        ordersWithFreight.error &&
        /include_freight|schema cache|column/i.test(ordersWithFreight.error.message ?? '')
      ) {
        const legacyOrders = await sb
          .from('orders')
          .select(
            'id, quote_id, order_code, status, deposit_status, accepted_total, deposit_amount, contact_revealed_at',
          )
          .in('quote_id', quoteIds);
        if (legacyOrders.error) throw legacyOrders.error;
        orderRows = (legacyOrders.data ?? []) as Array<Record<string, unknown>>;
      } else if (ordersWithFreight.error) {
        throw ordersWithFreight.error;
      }
      for (const raw of orderRows) {
        const o = raw as {
          id?: string;
          quote_id?: string;
          order_code?: string | null;
          status?: string;
          deposit_status?: string | null;
          accepted_total?: number | null;
          deposit_amount?: number | null;
          contact_revealed_at?: string | null;
          include_freight?: unknown;
        };
        const qid = String(o.quote_id);
        const mapped = {
          id: String(o.id),
          order_code: String(o.order_code ?? ''),
          status: String(o.status),
          deposit_status: o.deposit_status != null ? String(o.deposit_status) : null,
          accepted_total: o.accepted_total != null ? Number(o.accepted_total) : null,
          deposit_amount: o.deposit_amount != null ? Number(o.deposit_amount) : null,
          contact_revealed_at:
            (o as { contact_revealed_at?: string | null }).contact_revealed_at ?? null,
          include_freight: parseIncludeFreightFlag(
            (o as { include_freight?: unknown }).include_freight,
          ),
        };
        ordersByQuote.set(qid, preferBoardOrder(ordersByQuote.get(qid), mapped));
      }
    }

    // Backup: órdenes del comercio vía join (por si algún quote_id quedó fuera del primer set).
    if (storeIds.length > 0) {
      const viaStore = await sb
        .from('orders')
        .select(
          'id, quote_id, order_code, status, deposit_status, accepted_total, deposit_amount, contact_revealed_at, include_freight, quotes!inner ( store_id )',
        )
        .in('quotes.store_id', storeIds);
      if (!viaStore.error) {
        for (const o of viaStore.data ?? []) {
          const qid = String((o as { quote_id?: string }).quote_id ?? '');
          if (!qid) continue;
          const mapped = {
            id: String((o as { id: string }).id),
            order_code: String((o as { order_code?: string }).order_code ?? ''),
            status: String((o as { status: string }).status),
            deposit_status:
              (o as { deposit_status?: string | null }).deposit_status != null
                ? String((o as { deposit_status: string }).deposit_status)
                : null,
            accepted_total:
              (o as { accepted_total?: number | null }).accepted_total != null
                ? Number((o as { accepted_total: number }).accepted_total)
                : null,
            deposit_amount:
              (o as { deposit_amount?: number | null }).deposit_amount != null
                ? Number((o as { deposit_amount: number }).deposit_amount)
                : null,
            contact_revealed_at:
              (o as { contact_revealed_at?: string | null }).contact_revealed_at ?? null,
            include_freight: parseIncludeFreightFlag(
              (o as { include_freight?: unknown }).include_freight,
            ),
          };
          ordersByQuote.set(qid, preferBoardOrder(ordersByQuote.get(qid), mapped));
        }
      }
    }

    for (const q of quoteRows) {
      const id = String(q.id);
      quoteByKey.set(`${q.request_id}:${q.store_id}`, {
        id,
        request_id: String(q.request_id),
        store_id: String(q.store_id),
        status: String(q.status),
        created_at: q.created_at != null ? String(q.created_at) : null,
        freight_type: q.freight_type != null ? String(q.freight_type) : null,
        freight_cost: q.freight_cost != null ? Number(q.freight_cost) : 0,
        quote_items: (q.quote_items as QuoteItemRow[] | null) ?? null,
        orders: ordersByQuote.get(id) ?? null,
      });
    }
  }

  const cards: StoreBoardCard[] = [];
  for (const row of rows) {
    const mr = one(row.material_requests);
    if (!mr) continue;

    const quote = quoteByKey.get(`${mr.id}:${row.store_id}`) ?? null;
    const order = quote ? one(quote.orders) : null;
    const targetStatus = row.status as RequestTargetStoreStatus;
    const quoteStatus = quote?.status ?? null;
    let orderStatus = order?.status ?? null;
    let depositStatus = order?.deposit_status ?? null;
    const contactRevealedAt = order?.contact_revealed_at ?? null;

    // Defensa: contacto revelado implica fee pagado aunque status venga inconsistente.
    if (
      contactRevealedAt &&
      depositStatus !== 'paid' &&
      orderStatus !== 'deposit_paid' &&
      orderStatus !== 'completed'
    ) {
      depositStatus = 'paid';
      if (!orderStatus || orderStatus === 'pending_deposit' || orderStatus === 'pending') {
        orderStatus = 'deposit_paid';
      }
    }

    const decisions = (quote?.quote_items ?? []).map((qi) => {
      const ri = one(qi.request_items);
      const raw = String(qi.client_decision ?? 'pending').toLowerCase();
      const decision: 'accepted' | 'rejected' | 'pending' =
        raw === 'accepted' || raw === 'rejected' ? raw : 'pending';
      return {
        requestItemId: String(qi.request_item_id ?? ri?.id ?? ''),
        description: (ri?.description ?? '').trim() || 'Ítem',
        unitPrice: Number(qi.unit_price) || 0,
        decision,
      };
    });
    const acceptedItems = decisions.filter((d) => d.decision === 'accepted');
    const rejectedItems =
      quoteStatus === 'rejected' && decisions.every((d) => d.decision !== 'rejected')
        ? decisions.map((d) => ({ ...d, decision: 'rejected' as const }))
        : decisions.filter((d) => d.decision === 'rejected');
    const decidedCount = acceptedItems.length + rejectedItems.length;
    const allItemsRejected =
      decisions.length > 0 &&
      decidedCount === decisions.length &&
      acceptedItems.length === 0 &&
      rejectedItems.length > 0;

    const column = resolveBoardColumn({
      targetStatus,
      quoteStatus,
      orderStatus,
      depositStatus,
      contactRevealedAt,
      allItemsRejected,
      hasAcceptedItem: acceptedItems.length > 0,
    });

    const freightType = (quote?.freight_type ?? 'pickup') as FreightType;
    const acceptedItemsSum = acceptedItems.reduce((acc, it) => acc + (it.unitPrice || 0), 0);
    const allItemsSum = decisions.reduce((acc, it) => acc + (it.unitPrice || 0), 0);
    const persistedTotal =
      order?.accepted_total != null && Number.isFinite(Number(order.accepted_total))
        ? Number(order.accepted_total)
        : null;

    // Precio final = solo aceptados. El flete entra solo si esta orden lo incluyó.
    const finalAmount = storeAmountDue({
      acceptedItemsSum,
      hasAcceptedItems: acceptedItems.length > 0,
      allItemsSum,
      quotedFreightCost: Number(quote?.freight_cost) || 0,
      freightType,
      orderIncludeFreight: order?.include_freight ?? null,
      acceptedTotal: persistedTotal,
    });
    const totalAmount = finalAmount;
    const amountDueToStore = totalAmount;
    const serviceFee =
      order?.deposit_amount != null && Number.isFinite(Number(order.deposit_amount))
        ? Number(order.deposit_amount)
        : null;

    // Código existe desde el accept (trigger); Confirmadas requiere fee pagado.
    // Se guarda siempre para el buscador; la UI solo lo destaca en confirmadas/cerradas.
    const orderCodeDigits = order?.order_code
      ? formatOrderCodeDisplay(order.order_code)
      : null;

    cards.push({
      targetId: row.id,
      requestId: mr.id,
      storeId: row.store_id,
      title: mr.title,
      itemCount: mr.request_items?.length ?? decisions.length ?? 0,
      createdAt: mr.created_at,
      quotedAt: quote?.created_at ?? null,
      clientFirstName: mr.client_id ? clientNameById.get(mr.client_id) ?? null : null,
      column,
      targetStatus,
      requestStatus: mr.status as MaterialRequestStatus,
      quoteId: quote?.id ?? null,
      quoteStatus: (quoteStatus as StoreBoardCard['quoteStatus']) ?? null,
      orderId: order?.id ?? null,
      orderCode: orderCodeDigits && orderCodeDigits !== '—' ? orderCodeDigits : null,
      orderStatus,
      depositStatus,
      totalAmount,
      finalAmount,
      amountDueToStore,
      serviceFee,
      acceptedItems,
      rejectedItems,
    });
  }

  return cards;
}

export async function fetchStoreRequestDetail(params: {
  requestId: string;
  storeId: string;
}): Promise<StoreRequestDetail> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  const [reqRes, targetRes, quoteRes] = await Promise.all([
    sb
      .from('material_requests')
      .select(
        `
        id,
        title,
        status,
        client_id,
        client_lat,
        client_lng,
        created_at,
        request_items (
          id,
          description,
          quantity,
          unit,
          sort_order
        )
      `,
      )
      .eq('id', params.requestId)
      .single(),
    sb
      .from('request_target_stores')
      .select('status, stores ( id, name )')
      .eq('request_id', params.requestId)
      .eq('store_id', params.storeId)
      .maybeSingle(),
    sb
      .from('quotes')
      .select(
        `
        id,
        status,
        freight_type,
        freight_cost,
        notes,
        quote_items (
          id,
          request_item_id,
          unit_price,
          in_stock,
          alternative_description,
          item_note,
          client_decision,
          variant_index,
          variant_label
        )
      `,
      )
      .eq('request_id', params.requestId)
      .eq('store_id', params.storeId)
      .maybeSingle(),
  ]);

  if (reqRes.error) throw reqRes.error;
  if (targetRes.error) throw targetRes.error;

  type QuoteDetailRow = {
    id: string;
    status?: string | null;
    freight_type: string;
    freight_cost: number | string;
    notes: string | null;
    quote_items:
      | {
          id?: string;
          request_item_id: string;
          unit_price: number | string;
          in_stock?: boolean | null;
          alternative_description?: string | null;
          item_note?: string | null;
          client_decision?: string | null;
          variant_index?: number | null;
          variant_label?: string | null;
        }[]
      | null;
  };

  let quoteRow = (quoteRes.data as QuoteDetailRow | null) ?? null;
  let quoteError = quoteRes.error;

  // Compat: columnas E2 / client_decision aún no migradas → reintentar sin ellas.
  if (
    quoteError &&
    /in_stock|alternative_description|item_note|client_decision|schema cache|column/i.test(
      quoteError.message ?? '',
    )
  ) {
    const legacy = await sb
      .from('quotes')
      .select(
        `
        id,
        status,
        freight_type,
        freight_cost,
        notes,
        quote_items (
          request_item_id,
          unit_price
        )
      `,
      )
      .eq('request_id', params.requestId)
      .eq('store_id', params.storeId)
      .maybeSingle();
    quoteError = legacy.error;
    quoteRow = (legacy.data as QuoteDetailRow | null) ?? null;
  }
  if (quoteError) throw quoteError;

  const mr = reqRes.data;
  if (!mr) throw new Error('Pedido no encontrado.');
  if (!targetRes.data) throw new Error('Este pedido no está dirigido a tu comercio.');

  let clientAddress: string | null = null;
  try {
    const addrRes = await sb
      .from('material_requests')
      .select('client_address')
      .eq('id', params.requestId)
      .maybeSingle();
    if (!addrRes.error && addrRes.data) {
      const raw = (addrRes.data as { client_address?: string | null }).client_address;
      clientAddress = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    }
  } catch {
    clientAddress = null;
  }

  const storeRel = one(
    targetRes.data.stores as
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null,
  );

  const rawItems = (mr.request_items ?? []) as {
    id: string;
    description: string;
    quantity: number | string;
    unit: string;
    sort_order: number;
  }[];

  const items: MaterialRequestItem[] = rawItems
    .map((it) => ({
      id: it.id,
      description: it.description,
      quantity: Number(it.quantity) || 0,
      unit: it.unit || 'u',
      sortOrder: it.sort_order ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  let existingQuote: ExistingStoreQuote | null = null;
  if (quoteRow?.id) {
    const freightType = (quoteRow.freight_type as FreightType) || 'pickup';
    const qStatusRaw = String(quoteRow.status ?? 'sent');
    const quoteStatus: ExistingStoreQuote['status'] =
      qStatusRaw === 'accepted' || qStatusRaw === 'rejected' ? qStatusRaw : 'sent';
    existingQuote = {
      quoteId: quoteRow.id,
      freightType: (['pickup', 'free', 'cost'] as FreightType[]).includes(freightType)
        ? freightType
        : 'pickup',
      freightCost: Number(quoteRow.freight_cost) || 0,
      notes: (quoteRow.notes ?? '').trim(),
      status: quoteStatus,
      items: (quoteRow.quote_items ?? []).map((qi) => {
        const raw = String(qi.client_decision ?? 'pending').toLowerCase();
        const clientDecision: ExistingStoreQuoteItem['clientDecision'] =
          raw === 'accepted' || raw === 'rejected' ? raw : 'pending';
        return {
          quoteItemId: String(qi.id ?? `${qi.request_item_id}-${qi.variant_index ?? 1}`),
          requestItemId: String(qi.request_item_id),
          unitPrice: Number(qi.unit_price) || 0,
          inStock: qi.in_stock !== false,
          alternativeDescription: qi.alternative_description?.trim() || null,
          itemNote: qi.item_note?.trim() || null,
          variantIndex: Number(qi.variant_index) > 0 ? Number(qi.variant_index) : 1,
          variantLabel: qi.variant_label?.trim() || null,
          clientDecision,
        };
      }),
    };
  }

  return {
    requestId: mr.id as string,
    title: mr.title as string,
    status: mr.status as MaterialRequestStatus,
    clientId: (mr.client_id as string | null) ?? null,
    clientLat: mr.client_lat != null ? Number(mr.client_lat) : null,
    clientLng: mr.client_lng != null ? Number(mr.client_lng) : null,
    clientAddress,
    createdAt: mr.created_at as string,
    items,
    storeId: params.storeId,
    storeName: storeRel?.name ?? 'Comercio',
    targetStatus: targetRes.data.status as RequestTargetStoreStatus,
    alreadyQuoted: Boolean(existingQuote),
    existingQuote,
  };
}

export type SubmitStoreQuoteItemInput = {
  requestItemId: string;
  unitPrice: number;
  inStock: boolean;
  alternativeDescription?: string | null;
  itemNote?: string | null;
  variantIndex?: number;
  variantLabel?: string | null;
};

export type SubmitStoreQuoteInput = {
  requestId: string;
  storeId: string;
  clientId?: string | null;
  freightType: FreightType;
  freightCost: number;
  notes: string;
  items: SubmitStoreQuoteItemInput[];
};

export type SubmitStoreQuoteResult = {
  quoteId: string;
};

/**
 * Inserta quote + quote_items. El trigger marca el pedido como `quoted`
 * y deja la cotización visible para el client_id.
 */
export async function submitStoreQuote(
  input: SubmitStoreQuoteInput,
): Promise<SubmitStoreQuoteResult> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  if (input.items.length === 0) {
    throw new Error('Completá el precio de cada ítem.');
  }
  for (const item of input.items) {
    if (!item.requestItemId || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new Error('Hay precios inválidos. Revisá los ítems.');
    }
    if (!item.inStock && item.alternativeDescription?.trim()) {
      if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
        throw new Error('Si indicás un producto alternativo, el precio es obligatorio.');
      }
    }
    const idx = item.variantIndex ?? 1;
    if (idx < 1 || idx > 3) {
      throw new Error('Solo se permiten hasta 3 opciones por ítem.');
    }
  }

  if (input.freightType === 'cost' && (!Number.isFinite(input.freightCost) || input.freightCost < 0)) {
    throw new Error('Ingresá un costo de flete válido.');
  }

  const freightCost = input.freightType === 'cost' ? input.freightCost : 0;

  const { data: quote, error: quoteError } = await sb
    .from('quotes')
    .insert({
      request_id: input.requestId,
      store_id: input.storeId,
      client_id: input.clientId ?? null,
      freight_type: input.freightType,
      freight_cost: freightCost,
      notes: input.notes.trim(),
      status: 'sent',
    })
    .select('id')
    .single();

  if (quoteError) {
    if (quoteError.code === '23505') {
      throw new Error('Ya enviaste un presupuesto para este pedido.');
    }
    throw quoteError;
  }

  const quoteId = quote.id as string;
  const itemRowsFull = input.items.map((item) => ({
    quote_id: quoteId,
    request_item_id: item.requestItemId,
    unit_price: item.unitPrice,
    in_stock: item.inStock,
    alternative_description: item.inStock
      ? null
      : item.alternativeDescription?.trim() || item.variantLabel?.trim() || null,
    item_note: item.itemNote?.trim() || null,
    variant_index: item.variantIndex ?? 1,
    variant_label: item.variantLabel?.trim() || null,
  }));
  const itemRowsLegacy = input.items.map((item) => ({
    quote_id: quoteId,
    request_item_id: item.requestItemId,
    unit_price: item.unitPrice,
  }));

  let itemsError = (await sb.from('quote_items').insert(itemRowsFull)).error;
  if (
    itemsError &&
    /variant_index|variant_label|in_stock|alternative_description|item_note|schema cache|column|duplicate/i.test(
      itemsError.message ?? '',
    )
  ) {
    // Fallback: sin columnas nuevas / unique viejo → una fila por request_item (primera variante).
    const seen = new Set<string>();
    const compact = itemRowsFull.filter((row) => {
      if (seen.has(row.request_item_id)) return false;
      seen.add(row.request_item_id);
      return true;
    });
    const withoutVariant = compact.map(
      ({ variant_index: _i, variant_label: _l, ...rest }) => rest,
    );
    itemsError = (await sb.from('quote_items').insert(withoutVariant)).error;
    if (
      itemsError &&
      /in_stock|alternative_description|item_note|schema cache|column/i.test(itemsError.message ?? '')
    ) {
      itemsError = (await sb.from('quote_items').insert(itemRowsLegacy)).error;
    }
  }
  if (itemsError) {
    await sb.from('quotes').delete().eq('id', quoteId);
    throw itemsError;
  }

  // Marcar target del comercio como quoted (si existe la fila).
  await sb
    .from('request_target_stores')
    .update({ status: 'quoted' })
    .eq('request_id', input.requestId)
    .eq('store_id', input.storeId);

  // E3: avisar en el chat cliente↔trabajador (si hay conversation_id).
  try {
    await sb.rpc('notify_material_quote_in_chat', { p_quote_id: quoteId });
  } catch {
    /* sin migración / sin chat: no bloquea el envío */
  }

  return { quoteId };
}

/** Normaliza texto de precio para tipado rápido en mostrador. */
export function sanitizePriceText(raw: string): string {
  let t = raw.replace(/[^\d.,]/g, '');
  const comma = t.indexOf(',');
  const dot = t.indexOf('.');
  if (comma >= 0 && dot >= 0) {
    // Quedarse con el último separador como decimal
    if (comma > dot) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (comma >= 0) {
    t = t.replace(',', '.');
  }
  const parts = t.split('.');
  if (parts.length > 2) {
    t = `${parts[0]}.${parts.slice(1).join('')}`;
  }
  if (parts[1]?.length > 2) {
    t = `${parts[0]}.${parts[1].slice(0, 2)}`;
  }
  return t;
}

export function parsePriceText(text: string): number | null {
  const cleaned = sanitizePriceText(text).trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
