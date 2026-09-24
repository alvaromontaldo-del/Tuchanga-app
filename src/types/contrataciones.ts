/** Comisión YaChanga = 22% del monto cotizado por el trabajador (ej. $100 → $22). */
export const COMISION_APP_RATE = 0.22;

export type ContratacionEstadoTrabajo =
  | 'pendiente'
  | 'precio_cotizado'
  | 'precio_aceptado'
  | 'aceptado'
  | 'en_curso'
  | 'pendiente_pago_diferencia'
  | 'pendiente_conformidad'
  | 'finalizado'
  | 'cancelado'
  | 'disputa';

export type ContratacionEstadoPago = 'pendiente_seña' | 'seña_pagada' | 'totalmente_pagado';

export type Contratacion = {
  id: string;
  conversation_id: string;
  worker_id: string;
  client_id: string;
  precio_trabajador: number;
  precio_final: number;
  comision_app: number;
  service_detail: string;
  estado_trabajo: ContratacionEstadoTrabajo;
  estado_pago: ContratacionEstadoPago;
  fecha_trabajo: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  recotizacion_precio_trabajador: number | null;
  recotizacion_precio_final: number | null;
  recotizacion_comision_app: number | null;
  paid_at: string | null;
  seña_pagada_at: string | null;
  completed_by_worker_at: string | null;
  finalizado_at: string | null;
  cancelado_at: string | null;
  conformidad_solicitada_at: string | null;
  conformidad_respondida_at: string | null;
  conformidad_aceptada: boolean | null;
  /** Reclamo de garantía abierto. */
  is_claim_open: boolean;
  /** none | open | pending_approval | closed */
  claim_status: string;
  claim_opened_at: string | null;
  /** El profesional marcó el arreglo como terminado. */
  claim_marked_done_at: string | null;
  /** El cliente confirmó el arreglo, o se autoaprobó a las 72 h. */
  claim_resolved_at: string | null;
  offline_pago_notificado_at: string | null;
  offline_pago_confirmado_at: string | null;
  disputa_motivo: string;
  created_at: string;
  updated_at: string;
};

export type ChatSystemEvent =
  | 'disponibilidad_propuesta'
  | 'horario_confirmado'
  | 'seña_pagada_cliente'
  | 'seña_pagada_trabajador'
  | 'pin_validado'
  | 'precio_aceptado_cliente'
  | 'precio_aceptado_trabajador'
  | 'conformidad_solicitada'
  | 'conformidad_aceptada'
  | 'conformidad_rechazada'
  | 'trabajo_finalizado'
  | 'saldo_pagado_cliente'
  | 'saldo_pagado_trabajador'
  | 'saldo_confirmado_cliente'
  | 'saldo_confirmado_trabajador';

export type QuotationMessageMetadata = {
  contratacion_id: string;
  precio_final?: number;
  precio_trabajador?: number;
  legacy_quote_id?: string;
  migrated?: boolean;
};

export type DisponibilidadOpcionEstado = 'propuesta' | 'aceptada' | 'descartada';

export type DisponibilidadOpcion = {
  id: string;
  contratacion_id: string;
  lote: number;
  fecha_trabajo: string;
  hora_inicio: string;
  hora_fin: string;
  estado: DisponibilidadOpcionEstado;
  created_at: string;
};

/** Saldo que el cliente paga al trabajador al finalizar (precio final − costo de servicio). Entero. */
export function computeSaldoPendiente(precioFinal: number, seña: number): number {
  return Math.max(0, Math.ceil(Number(precioFinal) || 0) - Math.ceil(Number(seña) || 0));
}
