/** Dominio: listas de materiales / comercios (módulo stores). */

export type MaterialRequestStatus =
  | 'draft'
  | 'sent'
  | 'quoted'
  | 'accepted'
  | 'completed';

export type RequestTargetStoreStatus = 'pending' | 'quoted' | 'declined';

export type MaterialItemDraft = {
  /** Id local de UI (no es el UUID de BD). */
  localId: string;
  /** Descripción completa del pedido (incluye cantidad/medida en el texto). */
  description: string;
};

export type MaterialRequestDraftParams = {
  title: string;
  items: MaterialItemDraft[];
  clientId?: string;
  clientLat: number;
  clientLng: number;
};

export type StoreRubro = {
  id: string;
  name: string;
};

export type NearbyStore = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  coverageRadiusKm: number;
  status: string;
  rubros: StoreRubro[];
  /** Distancia aproximada desde la obra/cliente (km, 1 decimal). */
  distanceKm: number;
};

/** @deprecated La cantidad/UM van en la descripción del ítem. */
export const MATERIAL_UNITS = ['u', 'kg', 'm', 'm²', 'L', 'bolsa', 'caja', 'rollo'] as const;

export type MaterialUnit = (typeof MATERIAL_UNITS)[number];

export type FreightType = 'pickup' | 'free' | 'cost';

export type MaterialRequestItem = {
  id: string;
  description: string;
  /** Legacy BD; nuevas solicitudes usan 1. */
  quantity: number;
  /** Legacy BD; nuevas solicitudes usan 'u'. */
  unit: string;
  sortOrder: number;
};

export type StoreIncomingRequest = {
  targetId: string;
  targetStatus: RequestTargetStoreStatus;
  requestId: string;
  title: string;
  status: MaterialRequestStatus;
  clientId: string | null;
  createdAt: string;
  itemCount: number;
  storeId: string;
  storeName: string;
};

/** Estados del tablero Kanban del comercio (tabs = columnas). */
export type StoreBoardColumn =
  | 'nuevas'
  | 'cotizadas'
  | 'confirmadas'
  | 'cerradas'
  | 'rechazadas';

export type StoreBoardQuoteItemDecision = {
  requestItemId: string;
  description: string;
  unitPrice: number;
  decision: 'accepted' | 'rejected' | 'pending';
};

export type StoreBoardCard = {
  targetId: string;
  requestId: string;
  storeId: string;
  title: string;
  itemCount: number;
  createdAt: string;
  /** Fecha de la cotización enviada (quotes.created_at). */
  quotedAt: string | null;
  /** Solo primer nombre del cliente (profiles.nombre). */
  clientFirstName: string | null;
  column: StoreBoardColumn;
  targetStatus: RequestTargetStoreStatus;
  requestStatus: MaterialRequestStatus;
  quoteId: string | null;
  quoteStatus: 'sent' | 'accepted' | 'rejected' | null;
  orderId: string | null;
  orderCode: string | null;
  orderStatus: string | null;
  depositStatus: string | null;
  /** Total a cobrar al comercio (solo ítems aceptados + flete si aplica). */
  totalAmount: number | null;
  /** Alias de totalAmount (precio final del pedido confirmado). */
  finalAmount: number | null;
  /** Lo que el cliente abona al comercio (= total completo; el fee YaChanga es aparte). */
  amountDueToStore: number | null;
  /** Costo de servicio YaChanga (solo sobre materiales aceptados). */
  serviceFee: number | null;
  acceptedItems: StoreBoardQuoteItemDecision[];
  rejectedItems: StoreBoardQuoteItemDecision[];
};

/** Cotización ya enviada por el comercio (vista solo lectura). */
export type ExistingStoreQuoteItem = {
  quoteItemId: string;
  requestItemId: string;
  unitPrice: number;
  inStock: boolean;
  alternativeDescription: string | null;
  itemNote: string | null;
  variantIndex: number;
  variantLabel: string | null;
  /** Decisión del cliente tras aceptar/rechazar (parcial). */
  clientDecision: 'pending' | 'accepted' | 'rejected';
};

export type ExistingStoreQuote = {
  quoteId: string;
  freightType: FreightType;
  freightCost: number;
  notes: string;
  status: 'sent' | 'accepted' | 'rejected';
  items: ExistingStoreQuoteItem[];
};

export type StoreRequestDetail = {
  requestId: string;
  title: string;
  status: MaterialRequestStatus;
  clientId: string | null;
  clientLat: number | null;
  clientLng: number | null;
  /** Dirección de entrega (texto), si está disponible. */
  clientAddress: string | null;
  createdAt: string;
  items: MaterialRequestItem[];
  storeId: string;
  storeName: string;
  targetStatus: RequestTargetStoreStatus;
  alreadyQuoted: boolean;
  /** Si el comercio ya cotizó, datos para precargar la vista en solo lectura. */
  existingQuote: ExistingStoreQuote | null;
};

export type MyStoreSummary = {
  id: string;
  name: string;
  status: string;
  avatarUrl: string | null;
};

/** Ítem cotizado (vista cliente). Una fila = una variante (1..3 por request_item). */
export type ClientQuoteLineItem = {
  /** Id de quote_items. */
  quoteItemId: string;
  requestItemId: string;
  description: string;
  /** Etiqueta de variante (marca/modelo); null = opción única. */
  variantLabel: string | null;
  variantIndex: number;
  /** Legacy; nuevas cotizaciones: 1. */
  quantity: number;
  /** Legacy; nuevas cotizaciones: 'u'. */
  unit: string;
  /** Precio del ítem (total de la línea; ya no es $/unidad). */
  unitPrice: number;
  lineTotal: number;
  /** false = comercio marcó sin stock y propuso alternativa. */
  inStock: boolean;
  alternativeDescription: string | null;
  itemNote: string | null;
  /** Decisión del cliente sobre este ítem (aceptación parcial). */
  clientDecision: 'pending' | 'accepted' | 'rejected';
};

export type ClientQuoteCard = {
  quoteId: string;
  requestId: string;
  status: 'sent' | 'accepted' | 'rejected';
  storeId: string;
  storeName: string;
  storeAddress: string;
  storePhone: string | null;
  /** true solo cuando el costo de servicio YaChanga está pagado. */
  contactRevealed: boolean;
  /**
   * Orden creada al confirmar selección de ítems.
   * Si hay fee pendiente (`pending_deposit`), la quote sigue `sent` hasta pagar.
   */
  orderId: string | null;
  orderStatus: string | null;
  /** Código de retiro; solo post-pago. */
  orderCode: string | null;
  /** PIN de retiro; solo post-pago y solo para el cliente. */
  verificationPin: string | null;
  /** Rubro usado para agrupar en la comparación. */
  groupRubroId: string;
  groupRubroName: string;
  rubroNames: string[];
  distanceKm: number | null;
  freightType: FreightType;
  freightCost: number;
  materialsSubtotal: number;
  total: number;
  notes: string;
  items: ClientQuoteLineItem[];
  createdAt: string;
};

export type ClientQuoteRubroGroup = {
  rubroId: string;
  rubroName: string;
  quotes: ClientQuoteCard[];
};

export type ClientMaterialRequestSummary = {
  requestId: string;
  title: string;
  status: MaterialRequestStatus;
  createdAt: string;
  quoteCount: number;
  clientLat: number | null;
  clientLng: number | null;
};

export type AcceptQuoteResult = {
  orderId: string;
  /** Costo de Servicio YaChanga (columna BD deposit_amount). */
  serviceFee: number;
  /** @deprecated Alias de serviceFee. */
  depositAmount: number;
  acceptedTotal: number;
  orderStatus: string;
  /** Solo disponible tras pagar el costo de servicio. */
  orderCode?: string | null;
};
