/**
 * UI justo después de que el profesional valida el PIN (estado en_curso).
 * Finalizar no vive en Detalle del servicio: el chat conserva la instrucción
 * y la acción Realizado, sin un título de pago.
 */

export const POST_PIN_FINISH_INSTRUCTION =
  'Cuando termines el trabajo, marcá como realizado.';

export const POST_PIN_FINISH_INSTRUCTION_WITH_SALDO =
  'Cuando termines el trabajo, marcá como realizado. El cliente ya indicó el pago del saldo.';

export type PostPinWorkerChatCopy = {
  /** Sin heading. El recuadro no anuncia «Pago confirmado» ni otro título. */
  title: null;
  body: string;
  actionLabel: 'Realizado';
};

export function postPinWorkerChatCopy(saldoIndicadoPorCliente: boolean): PostPinWorkerChatCopy {
  return {
    title: null,
    body: saldoIndicadoPorCliente
      ? POST_PIN_FINISH_INSTRUCTION_WITH_SALDO
      : POST_PIN_FINISH_INSTRUCTION,
    actionLabel: 'Realizado',
  };
}
