/**
 * Aviso fijado de que el cliente puede dejar la reseña.
 * Se oculta cuando ya hay puntaje en worker_reviews para ese trabajo,
 * o en cuanto el cliente lo envía en esta pantalla.
 */

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function clientHasLeftReview(input: {
  hasReview: boolean;
  justSubmitted?: boolean;
}): boolean {
  return input.hasReview || input.justSubmitted === true;
}

/** El formulario y la tarjeta «podés dejar tu reseña» siguen visibles. */
export function shouldShowReviewInvite(input: {
  hasReview: boolean;
  justSubmitted?: boolean;
}): boolean {
  return !clientHasLeftReview(input);
}

/**
 * Mensaje de sistema (o el paso de conformidad) que invita a reseñar.
 * El aviso de disputa nombra la reseña de paso y no es este mensaje.
 */
export function isPinnedReviewInvite(input: {
  text?: string | null;
  event?: string | null;
}): boolean {
  const event = input.event ?? '';
  if (event === 'conformidad_rechazada' || event === 'disputa_abierta') return false;
  return /deja(?:r)? (?:tu|su) resena/.test(fold(input.text ?? ''));
}

/**
 * true = mostrar el mensaje.
 * Si no es el aviso de reseña, no se filtra.
 */
export function shouldShowReviewInviteMessage(input: {
  hasReview: boolean;
  justSubmitted?: boolean;
  text?: string | null;
  event?: string | null;
}): boolean {
  if (!isPinnedReviewInvite(input)) return true;
  return shouldShowReviewInvite(input);
}
