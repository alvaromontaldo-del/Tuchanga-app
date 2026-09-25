/**
 * Layout del chat cuando el cliente escribe la reseña.
 *
 * El bug #52 (y el reporte posterior al PR #9) ocultaba el historial al enfocar
 * el comentario: antes se desmontaba el FlatList; después el pie (tarjeta de
 * reseña + compositor) y el teclado se quedaban con todo el alto y la lista
 * quedaba en 0. La lista tiene que seguir montada y con alto visible.
 */

/** Alto mínimo del historial cuando el cuerpo del chat alcanza para reservarlo. */
export const CHAT_MESSAGE_LIST_MIN_HEIGHT = 112;

export function shouldMountChatMessageList(args: {
  loading: boolean;
  claimLockLoading: boolean;
  chatClosedByClaim: boolean;
  /**
   * Foco del comentario de reseña. No desmonta el historial: se pasa para que
   * el caller no vuelva a condicionar el FlatList a este flag.
   */
  reviewInputFocused: boolean;
}): boolean {
  const reviewFocusHidesMessages = false;
  if (args.reviewInputFocused && reviewFocusHidesMessages) return false;
  return !args.loading && !args.claimLockLoading && !args.chatClosedByClaim;
}

/**
 * Reparte el alto ya reducido por el teclado entre el historial y el pie.
 * Si el pie no entra, se recorta (tiene que scrollear) y la lista conserva
 * un piso visible.
 */
export function splitChatBodyHeight(args: {
  availableHeight: number;
  footerContentHeight: number;
  messageListMinHeight?: number;
}): { messageListHeight: number; footerHeight: number; footerScrolls: boolean } {
  const minList = Math.max(0, args.messageListMinHeight ?? CHAT_MESSAGE_LIST_MIN_HEIGHT);
  const available = Math.max(0, Math.round(args.availableHeight));
  const footerContent = Math.max(0, Math.round(args.footerContentHeight));

  if (available === 0) {
    return { messageListHeight: 0, footerHeight: 0, footerScrolls: false };
  }

  const preferredFloor = Math.min(minList, Math.max(72, Math.round(available * 0.42)));
  const listFloor = Math.min(preferredFloor, available);
  const maxFooter = available - listFloor;
  const footerHeight = Math.min(footerContent, maxFooter);

  return {
    messageListHeight: available - footerHeight,
    footerHeight,
    footerScrolls: footerContent > footerHeight,
  };
}
