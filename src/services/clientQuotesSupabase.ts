import { getSupabaseClient } from '../lib/supabase';
import { normalizeDisplayAddress } from '../utils/formatAddress';
import { haversineKm } from './materialRequestsSupabase';
import type {
  AcceptQuoteResult,
  ClientMaterialRequestSummary,
  ClientQuoteCard,
  ClientQuoteLineItem,
  ClientQuoteRubroGroup,
  FreightType,
  MaterialRequestStatus,
} from '../types/materials';
import { normalizeOrderCodeInput, normalizePinInput } from '../utils/orderCode';

function formatClientStoreAddress(address: string | null | undefined): string {
  const raw = (address ?? '').trim();
  if (!raw) return '';
  return normalizeDisplayAddress(raw);
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function money(n: number): number {
  // Pesos enteros hacia arriba (costo de servicio / totales UI + MP).
  return Math.max(0, Math.ceil(Number(n) || 0));
}

function isClientSelectableQuoteItemLocal(it: ClientQuoteLineItem): boolean {
  if (it.clientDecision === 'rejected') return false;
  if (!it.inStock) {
    const hasAlt = Boolean(it.alternativeDescription?.trim() || it.variantLabel?.trim());
    return hasAlt && it.lineTotal > 0;
  }
  return true;
}

/**
 * Distancia precisa: intenta RPC `haversine_km`; si falla, Haversine local (1 decimal).
 */
export async function computeDistanceKm(params: {
  lat1: number;
  lng1: number;
  lat2: number;
  lng2: number;
}): Promise<number> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.rpc('haversine_km', {
      lat1: params.lat1,
      lng1: params.lng1,
      lat2: params.lat2,
      lng2: params.lng2,
    });
    if (!error && data != null && Number.isFinite(Number(data))) {
      return Number(data);
    }
  } catch {
    // fallback local
  }
  return haversineKm(params.lat1, params.lng1, params.lat2, params.lng2);
}

/**
 * Pedidos del cliente con cotizaciones (por client_id en request o en quotes).
 */
export async function fetchClientMaterialRequests(): Promise<ClientMaterialRequestSummary[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  const { data: byRequest, error: reqError } = await sb
    .from('material_requests')
    .select(
      `
      id,
      title,
      status,
      created_at,
      client_lat,
      client_lng,
      quotes ( id )
    `,
    )
    .eq('client_id', user.id)
    .in('status', ['sent', 'quoted', 'accepted', 'completed'])
    .order('created_at', { ascending: false });

  if (reqError) throw reqError;

  const map = new Map<string, ClientMaterialRequestSummary>();
  for (const row of byRequest ?? []) {
    const quotes = (row.quotes ?? []) as { id: string }[];
    map.set(row.id as string, {
      requestId: row.id as string,
      title: (row.title as string) || 'Pedido',
      status: row.status as MaterialRequestStatus,
      createdAt: row.created_at as string,
      quoteCount: quotes.length,
      clientLat: row.client_lat != null ? Number(row.client_lat) : null,
      clientLng: row.client_lng != null ? Number(row.client_lng) : null,
    });
  }

  // Cotizaciones dirigidas al cliente aunque el request no tenga client_id (legado)
  const { data: byQuote, error: quoteError } = await sb
    .from('quotes')
    .select(
      `
      id,
      request_id,
      material_requests (
        id,
        title,
        status,
        created_at,
        client_lat,
        client_lng
      )
    `,
    )
    .eq('client_id', user.id)
    .in('status', ['sent', 'accepted']);

  if (quoteError) throw quoteError;

  for (const row of byQuote ?? []) {
    const mr = one(
      row.material_requests as
        | {
            id: string;
            title: string;
            status: string;
            created_at: string;
            client_lat: number | null;
            client_lng: number | null;
          }
        | {
            id: string;
            title: string;
            status: string;
            created_at: string;
            client_lat: number | null;
            client_lng: number | null;
          }[]
        | null,
    );
    if (!mr) continue;
    const existing = map.get(mr.id);
    if (existing) {
      existing.quoteCount = Math.max(existing.quoteCount, (existing.quoteCount || 0));
      continue;
    }
    map.set(mr.id, {
      requestId: mr.id,
      title: mr.title || 'Pedido',
      status: mr.status as MaterialRequestStatus,
      createdAt: mr.created_at,
      quoteCount: 1,
      clientLat: mr.client_lat != null ? Number(mr.client_lat) : null,
      clientLng: mr.client_lng != null ? Number(mr.client_lng) : null,
    });
  }

  // Recalcular quote counts desde la query byQuote
  const countByRequest = new Map<string, number>();
  for (const row of byQuote ?? []) {
    const rid = row.request_id as string;
    countByRequest.set(rid, (countByRequest.get(rid) ?? 0) + 1);
  }
  for (const [rid, count] of countByRequest) {
    const entry = map.get(rid);
    if (entry) entry.quoteCount = Math.max(entry.quoteCount, count);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

type QuoteRow = {
  id: string;
  request_id: string;
  store_id: string;
  client_id: string | null;
  freight_type: string;
  freight_cost: number | string;
  notes: string | null;
  status: string;
  created_at: string;
  stores:
    | {
        id: string;
        name: string;
        address: string | null;
        phone?: string | null;
        latitude: number | null;
        longitude: number | null;
        store_rubros:
          | {
              rubros: { id: string; name: string } | { id: string; name: string }[] | null;
            }[]
          | null;
      }
    | {
        id: string;
        name: string;
        address: string | null;
        phone?: string | null;
        latitude: number | null;
        longitude: number | null;
        store_rubros:
          | {
              rubros: { id: string; name: string } | { id: string; name: string }[] | null;
            }[]
          | null;
      }[]
    | null;
  quote_items:
    | {
        id?: string;
        unit_price: number | string;
        in_stock?: boolean | null;
        alternative_description?: string | null;
        item_note?: string | null;
        client_decision?: string | null;
        variant_index?: number | null;
        variant_label?: string | null;
        request_items:
          | {
              id: string;
              description: string;
              quantity: number | string;
              unit: string;
              sort_order: number;
            }
          | {
              id: string;
              description: string;
              quantity: number | string;
              unit: string;
              sort_order: number;
            }[]
          | null;
      }[]
    | null;
};

type RequestMeta = {
  id: string;
  title: string;
  status: string;
  client_lat: number | null;
  client_lng: number | null;
  rubro_id: string;
  rubros: { id: string; name: string } | { id: string; name: string }[] | null;
};

function storeRubros(store: NonNullable<ReturnType<typeof one<NonNullable<QuoteRow['stores']>>>>): {
  id: string;
  name: string;
}[] {
  const links = store.store_rubros ?? [];
  const out: { id: string; name: string }[] = [];
  for (const link of links) {
    const r = one(link.rubros);
    if (r?.id && r.name) out.push({ id: r.id, name: r.name });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return out;
}

function pickGroupRubro(
  rubros: { id: string; name: string }[],
  preferredRubroId: string | null,
): { id: string; name: string } {
  if (preferredRubroId) {
    const match = rubros.find((r) => r.id === preferredRubroId);
    if (match) return match;
  }
  if (rubros[0]) return rubros[0];
  return { id: 'sin-rubro', name: 'Otros comercios' };
}

/**
 * Cotizaciones de un pedido, listas para comparar (con distancia y totales).
 */
export async function fetchClientQuotesForRequest(
  requestId: string,
): Promise<{
  requestTitle: string;
  requestStatus: MaterialRequestStatus;
  groups: ClientQuoteRubroGroup[];
}> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  const [reqRes, quotesRes] = await Promise.all([
    sb
      .from('material_requests')
      .select(
        `
        id,
        title,
        status,
        client_lat,
        client_lng,
        rubro_id,
        rubros ( id, name )
      `,
      )
      .eq('id', requestId)
      .single(),
    sb
      .from('quotes')
      .select(
        `
        id,
        request_id,
        store_id,
        client_id,
        freight_type,
        freight_cost,
        notes,
        status,
        created_at,
        stores (
          id,
          name,
          address,
          phone,
          latitude,
          longitude,
          store_rubros (
            rubros ( id, name )
          )
        ),
        quote_items (
          id,
          unit_price,
          in_stock,
          alternative_description,
          item_note,
          client_decision,
          variant_index,
          variant_label,
          request_items (
            id,
            description,
            quantity,
            unit,
            sort_order
          )
        )
      `,
      )
      .eq('request_id', requestId)
      .in('status', ['sent', 'accepted'])
      .order('created_at', { ascending: true }),
  ]);

  if (reqRes.error) throw reqRes.error;

  let quotesData = quotesRes.data;
  let quotesError = quotesRes.error;
  if (quotesError) {
    // Compat: columna E2 / phone aún no migrada → reintentar sin esos campos.
    if (/in_stock|alternative_description|item_note|client_decision|phone|schema cache|column/i.test(quotesError.message ?? '')) {
      const omitPhone = /phone/i.test(quotesError.message ?? '');
      const legacy = await sb
        .from('quotes')
        .select(
          `
          id,
          request_id,
          store_id,
          client_id,
          freight_type,
          freight_cost,
          notes,
          status,
          created_at,
          stores (
            id,
            name,
            address,
            ${omitPhone ? '' : 'phone,'}
            latitude,
            longitude,
            store_rubros (
              rubros ( id, name )
            )
          ),
          quote_items (
            unit_price,
            request_items (
              id,
              description,
              quantity,
              unit,
              sort_order
            )
          )
        `,
        )
        .eq('request_id', requestId)
        .in('status', ['sent', 'accepted'])
        .order('created_at', { ascending: true });
      quotesData = legacy.data;
      quotesError = legacy.error;
    }
  }
  if (quotesError) throw quotesError;

  const mr = reqRes.data as RequestMeta;
  const clientLat = mr.client_lat != null ? Number(mr.client_lat) : null;
  const clientLng = mr.client_lng != null ? Number(mr.client_lng) : null;
  const preferredRubroId = mr.rubro_id ?? one(mr.rubros)?.id ?? null;

  const quoteIds = ((quotesData ?? []) as QuoteRow[]).map((r) => r.id).filter(Boolean);

  type RevealInfo = {
    orderId: string;
    storeName: string | null;
    storePhone: string | null;
    storeAddress: string | null;
    orderCode: string | null;
    verificationPin: string | null;
  };
  type OrderBrief = {
    orderId: string;
    status: string;
    depositStatus: string;
  };
  /** quote_id → orden pagada / revelada (nombre+dirección vía SECURITY DEFINER). */
  const paidOrderByQuote = new Map<string, RevealInfo>();
  /** quote_id → última orden activa (pending o paid). */
  const orderByQuote = new Map<string, OrderBrief>();

  const markRevealed = (
    qid: string,
    oid: string,
    patch?: Partial<Omit<RevealInfo, 'orderId'>>,
  ) => {
    if (!qid || !oid) return;
    const prev = paidOrderByQuote.get(qid);
    paidOrderByQuote.set(qid, {
      orderId: oid,
      storeName: patch?.storeName ?? prev?.storeName ?? null,
      storePhone: patch?.storePhone ?? prev?.storePhone ?? null,
      storeAddress: patch?.storeAddress ?? prev?.storeAddress ?? null,
      orderCode: patch?.orderCode ?? prev?.orderCode ?? null,
      verificationPin: patch?.verificationPin ?? prev?.verificationPin ?? null,
    });
  };

  const isOrderRevealed = (o: {
    deposit_status?: string | null;
    status?: string | null;
    contact_revealed_at?: string | null;
  }) => {
    const depositStatus = String(o.deposit_status ?? '');
    const orderStatus = String(o.status ?? '');
    return (
      depositStatus === 'paid' ||
      orderStatus === 'deposit_paid' ||
      orderStatus === 'completed' ||
      o.contact_revealed_at != null
    );
  };

  // Preferir RPC batch (SECURITY DEFINER): no depende de RLS de orders.
  try {
    const { data: batchReveals, error: batchErr } = await sb.rpc(
      'list_material_request_quote_reveals',
      { p_request_id: requestId },
    );
    if (!batchErr && Array.isArray(batchReveals)) {
      for (const row of batchReveals as Array<{
        quote_id?: string;
        order_id?: string;
        contact_revealed?: boolean;
        store_name?: string | null;
        store_phone?: string | null;
        store_address?: string | null;
      }>) {
        if (!row.contact_revealed) continue;
        markRevealed(String(row.quote_id ?? ''), String(row.order_id ?? ''), {
          storeName: row.store_name?.trim() || null,
          storePhone: row.store_phone?.trim() || null,
          storeAddress: row.store_address?.trim() || null,
          orderCode: (row as { order_code?: string | null }).order_code?.trim() || null,
          verificationPin: (row as { verification_pin?: string | null }).verification_pin?.trim() || null,
        });
      }
    }
  } catch {
    // Migración aún no aplicada → fallback select orders.
  }

  if (quoteIds.length > 0) {
    const { data: paidOrders } = await sb
      .from('orders')
      .select('id, quote_id, deposit_status, status, contact_revealed_at')
      .in('quote_id', quoteIds);
    for (const o of paidOrders ?? []) {
      const qid = String((o as { quote_id?: string }).quote_id ?? '');
      const oid = String((o as { id?: string }).id ?? '');
      const oStatus = String((o as { status?: string }).status ?? '');
      const dStatus = String((o as { deposit_status?: string }).deposit_status ?? '');
      if (!qid || !oid) continue;
      if (oStatus === 'cancelled') continue;
      const prevBrief = orderByQuote.get(qid);
      const nextBrief = {
        orderId: oid,
        status: oStatus,
        depositStatus: dStatus,
      };
      if (!prevBrief) {
        orderByQuote.set(qid, nextBrief);
      } else {
        const rank = (st: string, dep: string) => {
          if (st === 'completed') return 4;
          if (st === 'deposit_paid' || dep === 'paid' || dep === 'waived') return 3;
          if (st === 'pending_deposit' || st === 'pending') return 2;
          return 1;
        };
        if (rank(oStatus, dStatus) >= rank(prevBrief.status, prevBrief.depositStatus)) {
          orderByQuote.set(qid, nextBrief);
        }
      }
      if (
        !isOrderRevealed(
          o as {
            deposit_status?: string;
            status?: string;
            contact_revealed_at?: string | null;
          },
        )
      ) {
        continue;
      }
      if (!paidOrderByQuote.has(qid)) markRevealed(qid, oid);
    }
  }
  const revealedQuoteIds = new Set(paidOrderByQuote.keys());

  const cards: ClientQuoteCard[] = [];
  const distanceJobs: Array<Promise<void>> = [];

  for (const row of (quotesData ?? []) as QuoteRow[]) {
    const store = one(row.stores);
    if (!store) continue;

    const rubros = storeRubros(store);
    const group = pickGroupRubro(rubros, preferredRubroId);
    const revealInfo = paidOrderByQuote.get(row.id);
    const contactRevealed = revealedQuoteIds.has(row.id);
    const orderBrief = orderByQuote.get(row.id) ?? null;

    const items: ClientQuoteLineItem[] = [];
    for (const qi of row.quote_items ?? []) {
      const ri = one(qi.request_items);
      if (!ri) continue;
      const qty = Number(ri.quantity) || 1;
      const unitPrice = money(Number(qi.unit_price) || 0);
      const inStock = qi.in_stock !== false;
      const alternativeDescription =
        typeof qi.alternative_description === 'string' && qi.alternative_description.trim()
          ? qi.alternative_description.trim()
          : null;
      const itemNote =
        typeof qi.item_note === 'string' && qi.item_note.trim() ? qi.item_note.trim() : null;
      const rawDecision = String(qi.client_decision ?? 'pending');
      const clientDecision: ClientQuoteLineItem['clientDecision'] =
        rawDecision === 'accepted' || rawDecision === 'rejected' ? rawDecision : 'pending';
      // Precio del ítem = unit_price. Si hay cantidad legacy > 1, se mantiene el total histórico.
      const lineTotal = money(qty === 1 ? unitPrice : qty * unitPrice);
      items.push({
        quoteItemId: String((qi as { id?: string }).id ?? `${ri.id}-${qi.variant_index ?? 1}`),
        requestItemId: ri.id,
        description: ri.description,
        variantLabel:
          (typeof qi.variant_label === 'string' && qi.variant_label.trim()
            ? qi.variant_label.trim()
            : null) ??
          alternativeDescription,
        variantIndex: Number(qi.variant_index) > 0 ? Number(qi.variant_index) : 1,
        quantity: qty,
        unit: ri.unit || 'u',
        unitPrice,
        lineTotal,
        inStock,
        alternativeDescription,
        itemNote,
        clientDecision,
      });
    }
    items.sort((a, b) => {
      const d = a.description.localeCompare(b.description, 'es');
      if (d !== 0) return d;
      return a.variantIndex - b.variantIndex;
    });

    // Precio final = solo ítems aceptados (+ flete). Fee YaChanga es aparte sobre aceptados.
    // Sin decisión: una variante por request_item (la más barata seleccionable) para no sumar A+B+C.
    const hasItemDecisions = items.some(
      (it) => it.clientDecision === 'accepted' || it.clientDecision === 'rejected',
    );
    let billableItems = items;
    if (hasItemDecisions) {
      billableItems = items.filter((it) => it.clientDecision === 'accepted');
    } else {
      const byReq = new Map<string, typeof items>();
      for (const it of items) {
        if (!isClientSelectableQuoteItemLocal(it)) continue;
        const list = byReq.get(it.requestItemId) ?? [];
        list.push(it);
        byReq.set(it.requestItemId, list);
      }
      billableItems = [];
      for (const list of byReq.values()) {
        const best = [...list].sort((a, b) => a.lineTotal - b.lineTotal)[0];
        if (best) billableItems.push(best);
      }
    }
    const materialsSubtotal = money(billableItems.reduce((acc, it) => acc + it.lineTotal, 0));
    const freightType = row.freight_type as FreightType;
    const freightApplies =
      freightType === 'cost' && (!hasItemDecisions || billableItems.length > 0);
    const freightCost = freightApplies ? money(Number(row.freight_cost) || 0) : 0;
    const total = money(materialsSubtotal + freightCost);

    const revealedName =
      revealInfo?.storeName?.trim() ||
      (contactRevealed ? store.name?.trim() || 'Comercio' : '');
    const revealedAddress =
      revealInfo?.storeAddress?.trim() ||
      (contactRevealed ? store.address?.trim() || '' : '');
    const revealedPhone =
      revealInfo?.storePhone?.trim() ||
      (contactRevealed && typeof store.phone === 'string' && store.phone.trim()
        ? store.phone.trim()
        : null);

    const card: ClientQuoteCard = {
      quoteId: row.id,
      requestId: row.request_id,
      status: row.status as ClientQuoteCard['status'],
      storeId: store.id,
      storeName: contactRevealed
        ? revealedName || 'Comercio'
        : 'Comercio (oculto hasta pagar el costo de servicio)',
      storeAddress: contactRevealed ? formatClientStoreAddress(revealedAddress) : '',
      storePhone: contactRevealed ? revealedPhone : null,
      contactRevealed,
      orderId: orderBrief?.orderId ?? null,
      orderStatus: orderBrief?.status ?? null,
      orderCode: revealInfo?.orderCode ?? null,
      verificationPin: revealInfo?.verificationPin ?? null,
      groupRubroId: group.id,
      groupRubroName: group.name,
      rubroNames: rubros.map((r) => r.name),
      distanceKm: null,
      freightType,
      freightCost,
      materialsSubtotal,
      total,
      notes: (row.notes ?? '').trim(),
      items,
      createdAt: row.created_at,
    };

    // Distancia para badge "El más cerca" (coords; no revela identidad).
    // El texto "A X km" solo se muestra tras revelar contacto.
    if (
      clientLat != null &&
      clientLng != null &&
      store.latitude != null &&
      store.longitude != null
    ) {
      const lat2 = Number(store.latitude);
      const lng2 = Number(store.longitude);
      if (Number.isFinite(lat2) && Number.isFinite(lng2)) {
        distanceJobs.push(
          (async () => {
            card.distanceKm = await computeDistanceKm({
              lat1: clientLat,
              lng1: clientLng,
              lat2,
              lng2,
            });
          })(),
        );
      }
    }

    cards.push(card);
  }

  await Promise.all(distanceJobs);

  // Completar nombre/dirección con get_material_order_reveal si faltan.
  const enrichJobs: Array<Promise<void>> = [];
  for (const card of cards) {
    if (!card.contactRevealed) continue;
    const paid = paidOrderByQuote.get(card.quoteId);
    if (!paid) continue;
    const needsEnrich = true;
    enrichJobs.push(
      (async () => {
        try {
          const reveal = await fetchMaterialOrderReveal(paid.orderId);
          if (!reveal.contactRevealed) return;
          if (reveal.storeAddress?.trim()) {
            card.storeAddress = formatClientStoreAddress(reveal.storeAddress.trim());
          }
          if (reveal.storePhone?.trim()) {
            card.storePhone = reveal.storePhone.trim();
          }
          if (reveal.storeName?.trim() && !reveal.storeName.includes('oculto')) {
            card.storeName = reveal.storeName.trim();
          }
          if (reveal.orderCode) card.orderCode = reveal.orderCode;
          if (reveal.verificationPin) {
            card.verificationPin = reveal.verificationPin.padStart(4, '0');
          }
        } catch {
          // RPC puede faltar en entornos sin migración; el join alcanza cuando hay address.
        }
      })(),
    );
  }
  await Promise.all(enrichJobs);

  const byRubro = new Map<string, ClientQuoteRubroGroup>();
  for (const card of cards) {
    const key = card.groupRubroId;
    let group = byRubro.get(key);
    if (!group) {
      group = {
        rubroId: card.groupRubroId,
        rubroName: card.groupRubroName,
        quotes: [],
      };
      byRubro.set(key, group);
    }
    group.quotes.push(card);
  }

  const groups = Array.from(byRubro.values());
  for (const g of groups) {
    g.quotes.sort((a, b) => a.total - b.total);
    // Etiquetas anónimas estables para comparar sin revelar identidad.
    let offerN = 0;
    for (const q of g.quotes) {
      if (q.contactRevealed) continue;
      offerN += 1;
      q.storeName = `Oferta ${offerN}`;
    }
  }
  groups.sort((a, b) => a.rubroName.localeCompare(b.rubroName, 'es'));

  return {
    requestTitle: mr.title || 'Mi obra',
    requestStatus: mr.status as MaterialRequestStatus,
    groups,
  };
}

/**
 * Rechaza una cotización enviada (cliente).
 */
export async function rejectMaterialQuote(quoteId: string): Promise<void> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('Tenés que iniciar sesión.');

  const { error } = await sb.rpc('reject_material_quote', { p_quote_id: quoteId });
  if (error) {
    const msg = String(error.message ?? error.details ?? '');
    if (/order_already_paid/i.test(msg)) {
      throw new Error('No se puede rechazar: el costo de servicio ya fue pagado.');
    }
    if (/quote_not_sent/i.test(msg)) {
      throw new Error('Esta cotización ya no se puede rechazar.');
    }
    if (!/reject_material_quote|function|schema/i.test(msg)) {
      throw error;
    }
    // Fallback sin RPC: solo el cliente dueño puede rechazar.
    const { data: quote } = await sb
      .from('quotes')
      .select('id, client_id, request_id, material_requests ( client_id )')
      .eq('id', quoteId)
      .maybeSingle();
    const reqClient = one(
      (quote as { material_requests?: { client_id?: string } | { client_id?: string }[] | null } | null)
        ?.material_requests,
    )?.client_id;
    const quoteClient = (quote as { client_id?: string | null } | null)?.client_id;
    if (reqClient !== user.id && quoteClient !== user.id) {
      throw new Error('Solo el cliente puede rechazar la cotización.');
    }
    const { error: updErr } = await sb
      .from('quotes')
      .update({ status: 'rejected' })
      .eq('id', quoteId)
      .eq('status', 'sent');
    if (updErr) throw updErr;
    await sb
      .from('quote_items')
      .update({ client_decision: 'rejected' })
      .eq('quote_id', quoteId)
      .eq('client_decision', 'pending');
  }
}

/**
 * Confirma selección de ítems y crea orden con costo de servicio pendiente.
 * La quote permanece `sent` hasta pagar el fee (accepted solo post-pago).
 */
export async function acceptQuoteAndCreateOrder(
  quoteId: string,
  acceptedItemIds: string[],
  includeFreight = true,
): Promise<AcceptQuoteResult> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  if (!acceptedItemIds.length) {
    throw new Error('Seleccioná al menos un ítem para aceptar.');
  }

  const { data, error } = await sb.rpc('accept_material_quote', {
    p_quote_id: quoteId,
    p_accepted_item_ids: acceptedItemIds,
    p_include_freight: includeFreight,
  });

  if (!error && data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.order_id) {
      const fee = Number(row.deposit_amount) || 0;
      return {
        orderId: String(row.order_id),
        serviceFee: fee,
        depositAmount: fee,
        acceptedTotal: Number(row.accepted_total) || 0,
        orderStatus: String(row.order_status ?? 'pending_deposit'),
      };
    }
  }

  if (error) {
    const msg = String(error.message ?? error.details ?? '');
    if (/no_items_selected/i.test(msg)) throw new Error('Seleccioná al menos un ítem.');
    if (/quote_not_sent/i.test(msg)) {
      throw new Error('Esta cotización ya no está disponible (aceptada, rechazada o vencida).');
    }
    if (/order_already_exists/i.test(msg)) {
      throw new Error('Ya existe una orden para este comercio.');
    }
    if (/request_completed/i.test(msg)) throw new Error('Este pedido ya está cerrado.');
    if (/not_client/i.test(msg)) throw new Error('Solo el cliente puede aceptar la cotización.');
    if (!/accept_material_quote|function|schema/i.test(msg)) {
      throw error;
    }
  }

  // Fallback legacy (sin RPC): selección + orden pending; NO marcar accepted.
  if (acceptedItemIds.length) {
    await sb
      .from('quote_items')
      .update({ client_decision: 'rejected' })
      .eq('quote_id', quoteId);
    await sb
      .from('quote_items')
      .update({ client_decision: 'accepted' })
      .eq('quote_id', quoteId)
      .in('request_item_id', acceptedItemIds);
  }

  const { data: order, error: orderError } = await sb
    .from('orders')
    .insert({
      quote_id: quoteId,
      order_code: '',
      status: 'pending_deposit',
      deposit_status: 'pending',
    })
    .select('id, order_code, deposit_amount, accepted_total, status')
    .single();

  if (orderError) {
    if (orderError.code === '23505') {
      const { data: existing } = await sb
        .from('orders')
        .select('id, order_code, deposit_amount, accepted_total, status')
        .eq('quote_id', quoteId)
        .maybeSingle();
      if (existing) {
        const fee = Number(existing.deposit_amount) || 0;
        return {
          orderId: existing.id as string,
          serviceFee: fee,
          depositAmount: fee,
          acceptedTotal: Number(existing.accepted_total) || 0,
          orderStatus: String(existing.status ?? 'pending_deposit'),
        };
      }
    }
    throw orderError;
  }

  const fee = Number(order.deposit_amount) || 0;
  return {
    orderId: order.id as string,
    serviceFee: fee,
    depositAmount: fee,
    acceptedTotal: Number(order.accepted_total) || 0,
    orderStatus: String(order.status ?? 'pending_deposit'),
  };
}

export type MaterialOrderReveal = {
  orderId: string;
  orderCode: string | null;
  status: string;
  depositStatus: string;
  /** Costo de Servicio YaChanga. */
  serviceFee: number;
  /** @deprecated Alias de serviceFee (columna BD deposit_amount). */
  depositAmount: number;
  acceptedTotal: number;
  verificationPin: string | null;
  storeName: string;
  storePhone: string | null;
  storeAddress: string | null;
  contactRevealed: boolean;
};

export async function confirmarSenaMaterialOrden(orderId: string): Promise<MaterialOrderReveal> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const { data, error } = await sb.rpc('confirmar_sena_material_orden', {
    p_order_id: orderId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No se pudo confirmar el costo de servicio.');
  const fee = Number(row.deposit_amount) || 0;
  return {
    orderId: String(row.order_id),
    orderCode: row.order_code != null ? String(row.order_code) : null,
    status: 'deposit_paid',
    depositStatus: 'paid',
    serviceFee: fee,
    depositAmount: fee,
    acceptedTotal: 0,
    verificationPin: row.verification_pin != null ? String(row.verification_pin) : null,
    storeName: String(row.store_name ?? 'Comercio'),
    storePhone: row.store_phone != null ? String(row.store_phone) : null,
    storeAddress:
      row.store_address != null ? formatClientStoreAddress(String(row.store_address)) : null,
    contactRevealed: true,
  };
}

function mapMaterialOrderRevealError(error: { message?: string }): Error {
  const msg = String(error.message ?? '');
  if (/not_authenticated/i.test(msg)) {
    return new Error('Tenés que iniciar sesión para ver la orden.');
  }
  if (/not_order_client/i.test(msg)) {
    return new Error('No tenés permiso para ver esta orden.');
  }
  if (/order_not_found/i.test(msg)) {
    return new Error('Orden no encontrada.');
  }
  return new Error(msg || 'No se pudo cargar la orden.');
}

export async function fetchMaterialOrderReveal(orderId: string): Promise<MaterialOrderReveal> {
  const sb = getSupabaseClient();
  await sb.auth.refreshSession().catch(() => sb.auth.getSession());
  const { data, error } = await sb.rpc('get_material_order_reveal', {
    p_order_id: orderId,
  });
  if (error) throw mapMaterialOrderRevealError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Orden no encontrada.');
  const fee = Number(row.deposit_amount) || 0;
  const depositStatus = String(row.deposit_status ?? 'pending');
  const status = String(row.status ?? '');
  // Defensa cliente: fee pagado / orden confirmada = revelado aunque RPC vieja exija contact_revealed_at.
  const contactRevealed =
    Boolean(row.contact_revealed) ||
    depositStatus === 'paid' ||
    status === 'deposit_paid' ||
    status === 'completed';
  let storeName = String(row.store_name ?? 'Comercio');
  let storePhone = row.store_phone != null ? String(row.store_phone) : null;
  let storeAddress = row.store_address != null ? String(row.store_address) : null;
  let orderCode = row.order_code != null ? String(row.order_code) : null;
  let verificationPin = row.verification_pin != null ? String(row.verification_pin) : null;

  if (
    contactRevealed &&
    (!storeAddress?.trim() || storeName.includes('oculto') || !orderCode || !verificationPin)
  ) {
    try {
      const { data: orderRow } = await sb
        .from('orders')
        .select(
          'order_code, verification_pin, quote_id, quotes ( stores ( name, phone, address ) )',
        )
        .eq('id', orderId)
        .maybeSingle();
      const or = orderRow as {
        order_code?: string | null;
        verification_pin?: string | null;
        quotes?: unknown;
      } | null;
      if (or?.order_code && !orderCode) orderCode = String(or.order_code);
      if (or?.verification_pin && !verificationPin) verificationPin = String(or.verification_pin);
      const quotes = or?.quotes;
      const quote = Array.isArray(quotes) ? quotes[0] : quotes;
      const stores = (quote as { stores?: unknown } | null)?.stores;
      const store = (Array.isArray(stores) ? stores[0] : stores) as {
        name?: string | null;
        phone?: string | null;
        address?: string | null;
      } | null;
      if (store) {
        if (store.name?.trim()) storeName = store.name.trim();
        if (store.phone?.trim()) storePhone = store.phone.trim();
        if (store.address?.trim()) storeAddress = store.address.trim();
      }
    } catch {
      // ignore fallback errors
    }
  }

  return {
    orderId: String(row.order_id),
    orderCode: contactRevealed ? orderCode : null,
    status,
    depositStatus,
    serviceFee: fee,
    depositAmount: fee,
    acceptedTotal: Number(row.accepted_total) || 0,
    verificationPin: contactRevealed ? verificationPin : null,
    storeName: contactRevealed
      ? storeName.includes('oculto')
        ? 'Comercio'
        : storeName
      : storeName,
    storePhone: contactRevealed ? storePhone : null,
    storeAddress: contactRevealed ? formatClientStoreAddress(storeAddress) : null,
    contactRevealed,
  };
}

/**
 * Todas las órdenes del mismo checkout (payment_group): comercios, montos, códigos y PINs.
 */
export async function fetchMaterialGroupReveals(
  orderId: string,
): Promise<MaterialOrderReveal[]> {
  const primary = await fetchMaterialOrderReveal(orderId);
  const sb = getSupabaseClient();
  await sb.auth.refreshSession().catch(() => sb.auth.getSession());

  let siblingIds: string[] = [orderId];
  try {
    const { data: orderRow } = await sb
      .from('orders')
      .select('payment_group_id')
      .eq('id', orderId)
      .maybeSingle();
    const groupId = (orderRow as { payment_group_id?: string | null } | null)?.payment_group_id;
    if (groupId) {
      const { data: siblings } = await sb
        .from('orders')
        .select('id')
        .eq('payment_group_id', groupId);
      const ids = (siblings ?? [])
        .map((s) => String((s as { id: string }).id))
        .filter(Boolean);
      if (ids.length > 0) siblingIds = [...new Set(ids)];
    }
  } catch {
    return [primary];
  }

  if (siblingIds.length <= 1) return [primary];

  const reveals = await Promise.all(
    siblingIds.map(async (id) => {
      if (id === orderId) return primary;
      try {
        return await fetchMaterialOrderReveal(id);
      } catch {
        return null;
      }
    }),
  );

  const list = reveals.filter((r): r is MaterialOrderReveal => r != null);
  return list.length > 0 ? list : [primary];
}

export async function completarOrdenMaterialConPin(
  orderCode: string,
  pin: string,
): Promise<{ orderId: string; orderCode: string; status: string }> {
  const code = normalizeOrderCodeInput(orderCode);
  const pinNorm = normalizePinInput(pin);
  if (!code || !pinNorm) {
    throw new Error('Ingresá el código de orden y el PIN.');
  }

  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const { data, error } = await sb.rpc('completar_orden_material_con_pin', {
    p_order_code: code,
    p_pin: pinNorm,
  });
  if (error) {
    const msg = String(error.message ?? error.details ?? error.hint ?? '');
    if (/invalid_pin/i.test(msg)) throw new Error('PIN incorrecto.');
    if (/order_not_found/i.test(msg)) throw new Error('No encontramos esa orden.');
    if (/deposit_not_paid/i.test(msg)) throw new Error('El costo de servicio YaChanga todavía no está pago.');
    if (/not_store_owner/i.test(msg)) throw new Error('Solo el comercio dueño puede cerrar la orden.');
    if (/code_or_pin_required/i.test(msg)) throw new Error('Ingresá el código de orden y el PIN.');
    if (/not_authenticated/i.test(msg)) throw new Error('Tenés que iniciar sesión.');
    throw new Error(msg.trim() || 'No se pudo cerrar la orden.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No se pudo completar la orden.');
  return {
    orderId: String(row.order_id),
    orderCode: String(row.order_code),
    status: String(row.status),
  };
}

export function formatMoneyAr(amount: number): string {
  const n = money(amount);
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function freightLabel(type: FreightType, _cost?: number): string {
  if (type === 'pickup') return 'Retiro en local';
  if (type === 'free') return 'Flete gratis';
  return 'Flete';
}

export type MaterialCheckoutSelection = {
  quoteId: string;
  /** request_item_ids (legacy). */
  itemIds: string[];
  /** quote_item_ids preferidos (variantes). */
  quoteItemIds?: string[];
  includeFreight: boolean;
};

export type MaterialCheckoutResult = {
  checkoutId: string;
  primaryOrderId: string;
  serviceFee: number;
  materialsTotal: number;
  orderIds: string[];
};

/**
 * Multi-comercio: crea órdenes pending + un solo fee sobre la suma (+ fletes marcados).
 */
export async function createMaterialCheckout(
  selections: MaterialCheckoutSelection[],
): Promise<MaterialCheckoutResult> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  if (!selections.length) {
    throw new Error('Seleccioná ítems de al menos un comercio.');
  }

  const payload = selections.map((s) => ({
    quote_id: s.quoteId,
    item_ids: s.itemIds,
    quote_item_ids: s.quoteItemIds ?? [],
    include_freight: s.includeFreight,
  }));

  const { data, error } = await sb.rpc('create_material_checkout', {
    p_selections: payload,
  });

  if (error) {
    const msg = String(error.message ?? error.details ?? '');
    if (/no_items_selected|no_selections|materials_required/i.test(msg)) {
      throw new Error(
        /materials_required/i.test(msg)
          ? 'No podés confirmar solo el flete. Seleccioná al menos un material.'
          : 'Seleccioná al menos un ítem.',
      );
    }
    if (/order_already_exists/i.test(msg)) {
      throw new Error('Ya hay una orden pendiente para alguno de estos comercios.');
    }
    if (/quote_not_sent/i.test(msg)) {
      throw new Error('Alguna cotización ya no está disponible.');
    }
    if (/mixed_requests/i.test(msg)) {
      throw new Error('Las cotizaciones deben ser del mismo pedido.');
    }
    if (/not_client/i.test(msg)) {
      throw new Error('Solo el cliente puede confirmar el pedido.');
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.primary_order_id) {
    throw new Error('No se pudo crear el resumen de pago.');
  }

  const orderIdsRaw = row.order_ids;
  const orderIds = Array.isArray(orderIdsRaw)
    ? orderIdsRaw.map((id: unknown) => String(id))
    : [];

  return {
    checkoutId: String(row.checkout_id),
    primaryOrderId: String(row.primary_order_id),
    serviceFee: money(Number(row.service_fee) || 0),
    materialsTotal: money(Number(row.materials_total) || 0),
    orderIds,
  };
}
