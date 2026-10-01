/**
 * Copy único de lo que se paga dentro de la app con Mercado Pago.
 * Los enums de la base (`seña_pagada`, `pendiente_seña`, etc.) no cambian.
 */

export const COSTO_SERVICIO_LABEL = 'Costo de servicio YaChanga';

export const COSTO_SERVICIO_PENDIENTE = 'Costo de servicio YaChanga pendiente';

export const COSTO_SERVICIO_PAGADO = 'Costo de servicio YaChanga pagado';

export const COSTO_SERVICIO_ACREDITADO = 'Costo de servicio YaChanga acreditado';

/** El saldo del trabajo no pasa por Mercado Pago. */
export const SALDO_FUERA_DE_APP =
  'El saldo restante del trabajo se paga directo al profesional, fuera de la app. No genera comprobante de Mercado Pago.';

export const SALDO_ACEPTACION =
  'Acepto que el saldo restante se paga al profesional fuera de YaChanga, sin comprobante de Mercado Pago.';

export const SALDO_PAGADO_AL_PROFESIONAL = 'Saldo pagado al profesional';

export const CONFORMIDAD_PREGUNTA = '¿El trabajo quedó bien realizado?';

export const CONFORMIDAD_SI = 'Estoy conforme';

export const CONFORMIDAD_PROBLEMA = 'Tuve un problema';

export const PROBLEMA_MOTIVOS = [
  'El trabajo quedó incompleto',
  'No es lo que acordamos',
  'El profesional no se presentó',
  'Otro',
] as const;

export type ProblemaMotivo = (typeof PROBLEMA_MOTIVOS)[number];

export type ConformidadResultado = {
  estado: string;
  paso: string;
};

export const CONFORMIDAD_POSITIVA: ConformidadResultado = {
  estado: 'Finalizado',
  paso: 'Podés dejar tu reseña en el chat.',
};

export const CONFORMIDAD_NEGATIVA: ConformidadResultado = {
  estado: 'En disputa',
  paso: 'El chat sigue visible para coordinar con el profesional. No se abre un comprobante de Mercado Pago. El reclamo de garantía se inicia aparte, desde Trabajos contratados, cuando el trabajo está finalizado y la garantía sigue vigente.',
};

/** El cliente tiene que aceptar el saldo fuera de la app antes de pagar el costo. */
export function puedeIniciarPagoCostoServicio(aceptoSaldoFueraDeApp: boolean): boolean {
  return aceptoSaldoFueraDeApp;
}

export function buildMotivoDisputa(motivo: string, descripcion: string): string {
  const title = motivo.trim();
  const body = descripcion.trim();
  if (!title) return body;
  if (!body) return title;
  return `${title}. ${body}`;
}

const FRASES_SENA: Array<[string, string]> = [
  ['✅ Seña pagada correctamente.', `✅ ${COSTO_SERVICIO_PAGADO}.`],
  ['¡Seña pagada!', `${COSTO_SERVICIO_PAGADO}.`],
  ['La seña fue pagada.', 'El costo de servicio YaChanga fue pagado.'],
  ['La seña ya fue registrada', 'El costo de servicio YaChanga ya fue registrado'],
  ['Solo el cliente puede pagar la seña', `Solo el cliente puede pagar el ${COSTO_SERVICIO_LABEL}`],
  ['Estado inválido para pagar seña', `Estado inválido para pagar el ${COSTO_SERVICIO_LABEL}`],
  ['PIN no disponible hasta pagar la seña', `PIN no disponible hasta pagar el ${COSTO_SERVICIO_LABEL}`],
  [
    'Dirección no disponible hasta pagar la seña',
    `Dirección no disponible hasta pagar el ${COSTO_SERVICIO_LABEL}`,
  ],
  ['hasta pagar la seña', `hasta pagar el ${COSTO_SERVICIO_LABEL}`],
  ['pagar la seña', `pagar el ${COSTO_SERVICIO_LABEL}`],
  ['pagar seña', `pagar el ${COSTO_SERVICIO_LABEL}`],
  ['Seña pagada', COSTO_SERVICIO_PAGADO],
  ['seña pagada', 'costo de servicio YaChanga pagado'],
  ['la seña', `el ${COSTO_SERVICIO_LABEL}`],
];

/**
 * Reemplaza «seña» en textos que ve el usuario.
 * No toca «reseña» ni «contraseña».
 */
export function textoVisibleSinSena(input: string): string {
  let text = input;
  for (const [from, to] of FRASES_SENA) {
    if (text.includes(from)) text = text.split(from).join(to);
  }
  return text;
}
