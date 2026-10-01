/** Valores del enum Postgres `transaccion_tipo_pago`. */
export type TipoPagoMp = "seña_inicial" | "diferencia_seña" | "seña_materiales";

/** Códigos ASCII en external_reference (sin ñ — MP los corrompe en búsquedas). */
export type TipoPagoMpRef = "sena_inicial" | "diferencia_sena" | "sena_materiales";

export type ParsedExternalReference = {
  contratacionId?: string;
  orderId?: string;
  tipoPago: TipoPagoMp;
};

export function tipoPagoToRef(tipo: TipoPagoMp): TipoPagoMpRef {
  if (tipo === "seña_inicial") return "sena_inicial";
  if (tipo === "diferencia_seña") return "diferencia_sena";
  return "sena_materiales";
}

export function tipoPagoFromRef(raw: string): TipoPagoMp | null {
  if (raw === "sena_inicial" || raw === "seña_inicial") return "seña_inicial";
  if (raw === "diferencia_sena" || raw === "diferencia_seña") return "diferencia_seña";
  if (raw === "sena_materiales" || raw === "seña_materiales") return "seña_materiales";
  return null;
}

export function buildExternalReference(
  contratacionId: string,
  tipoPago: TipoPagoMp,
): string {
  return `contratacion_id:${contratacionId}|tipo_pago:${tipoPagoToRef(tipoPago)}`;
}

export function buildMaterialOrderExternalReference(orderId: string): string {
  return `order_id:${orderId}|tipo_pago:sena_materiales`;
}

export function parseExternalReference(ref: string): ParsedExternalReference | null {
  const parts = ref.split("|").map((p) => p.trim());
  let contratacionId: string | undefined;
  let orderId: string | undefined;
  let tipoPago: TipoPagoMp | null = null;
  for (const part of parts) {
    if (part.startsWith("contratacion_id:")) {
      contratacionId = part.slice("contratacion_id:".length);
    }
    if (part.startsWith("order_id:")) {
      orderId = part.slice("order_id:".length);
    }
    if (part.startsWith("tipo_pago:")) {
      const raw = part.slice("tipo_pago:".length);
      tipoPago = tipoPagoFromRef(raw);
    }
    if (part.startsWith("payment_group_id:") || part.startsWith("checkout_id:")) {
      // Se lee en paymentMatchesExpectedFee; acá solo no rompe el parse.
    }
  }
  if (!tipoPago) return null;
  if (!contratacionId && !orderId) return null;
  return { contratacionId, orderId, tipoPago };
}

export function paymentGroupIdFromReference(ref: string): string | null {
  for (const part of ref.split("|").map((p) => p.trim())) {
    if (part.startsWith("payment_group_id:")) {
      const id = part.slice("payment_group_id:".length).trim();
      if (id) return id;
    }
    if (part.startsWith("checkout_id:")) {
      const id = part.slice("checkout_id:".length).trim();
      if (id) return id;
    }
  }
  return null;
}
