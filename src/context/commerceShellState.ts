export type SessionRole = 'client' | 'professional' | 'commerce';

export type CommerceShellFlags = {
  isAuthed: boolean;
  roleHydrated: boolean;
  sessionRole: SessionRole | null;
  commerceIntent: boolean;
  /** Al menos un comercio en trial, active, unpaid o paused. */
  hasApprovedStore: boolean;
  /** Al menos un comercio en pending_approval. */
  hasPendingStore: boolean;
};

/**
 * El módulo comercio solo corresponde a un comercio ya habilitado.
 * Un alta solo pendiente (o el rol guardado `commerce` sobre esa alta) queda afuera:
 * en Android el botón atrás del shell cierra la app.
 */
export function isCommerceShell(flags: CommerceShellFlags): boolean {
  const pendingOnly = flags.hasPendingStore && !flags.hasApprovedStore;
  if (pendingOnly) return false;

  return Boolean(
    flags.isAuthed &&
      flags.roleHydrated &&
      (flags.sessionRole === 'commerce' ||
        (flags.sessionRole == null &&
          flags.commerceIntent &&
          !flags.hasApprovedStore &&
          !flags.hasPendingStore)),
  );
}

/** Hay que bajar el rol persistido `commerce` a cliente. */
export function shouldDemotePendingCommerceRole(
  flags: Pick<CommerceShellFlags, 'sessionRole' | 'hasApprovedStore' | 'hasPendingStore'>,
): boolean {
  return (
    flags.sessionRole === 'commerce' && flags.hasPendingStore && !flags.hasApprovedStore
  );
}
