import type { AuthUser } from '../services/auth';

function pickStr(prefer: string | undefined | null, fallback: string | undefined | null): string | undefined {
  const p = prefer?.trim();
  if (p) return p;
  const f = fallback?.trim();
  return f || undefined;
}

function mergeBaseLocation(
  ctx: AuthUser['baseLocation'],
  fresh: AuthUser['baseLocation'],
): AuthUser['baseLocation'] | undefined {
  const fa = fresh?.address?.trim();
  if (fa) return fresh;
  const ca = ctx?.address?.trim();
  if (ca) return ctx;
  if (fresh && (fresh.lat !== 0 || fresh.lng !== 0)) return fresh;
  if (ctx && (ctx.lat !== 0 || ctx.lng !== 0)) return ctx;
  return fresh ?? ctx;
}

/**
 * Combina el usuario en contexto con un fetch reciente.
 * Evita que un fetch mínimo ({ id, email }) pise nombre, DNI, teléfono, etc.
 */
export function mergeAuthUserProfile(
  ctx: AuthUser | null | undefined,
  fresh: AuthUser | null | undefined,
): AuthUser | null {
  if (!ctx && !fresh) return null;
  if (!fresh) return ctx ?? null;
  if (!ctx) return fresh;
  if (ctx.id !== fresh.id) return fresh;

  return {
    ...ctx,
    ...fresh,
    id: fresh.id,
    email: fresh.email?.trim() || ctx.email,
    firstName: pickStr(fresh.firstName, ctx.firstName),
    lastName: pickStr(fresh.lastName, ctx.lastName),
    fullName: pickStr(fresh.fullName, ctx.fullName),
    dni: pickStr(fresh.dni, ctx.dni),
    phone: pickStr(fresh.phone, ctx.phone),
    avatarUri: fresh.avatarUri?.trim() || ctx.avatarUri?.trim() || undefined,
    location: pickStr(fresh.location, ctx.location),
    locationDetails: pickStr(fresh.locationDetails, ctx.locationDetails),
    bio: pickStr(fresh.bio, ctx.bio),
    profileCreatedAt: fresh.profileCreatedAt ?? ctx.profileCreatedAt,
    baseLocation: mergeBaseLocation(ctx.baseLocation, fresh.baseLocation),
    worker: fresh.worker ?? ctx.worker,
    ratingAverage:
      typeof fresh.ratingAverage === 'number' ? fresh.ratingAverage : ctx.ratingAverage,
    reviewCount:
      typeof fresh.reviewCount === 'number' ? fresh.reviewCount : ctx.reviewCount,
  };
}
