import type { AuthUser } from '../services/auth';

export function displayNameFromUser(u: AuthUser | null | undefined): string {
  if (!u) return 'Tu perfil';
  const full = u.fullName?.trim();
  if (full) return full;
  const parts = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (parts) return parts;
  return u.email?.trim() || 'Tu perfil';
}

export function initialsFromAuthUser(u: AuthUser | null | undefined): string {
  if (!u) return '?';
  const a = u.firstName?.trim().charAt(0);
  const b = u.lastName?.trim().charAt(0);
  if (a && b) return `${a}${b}`.toUpperCase();
  const full = u.fullName?.trim();
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
    }
    if (parts[0]) return parts[0].charAt(0).toUpperCase();
  }
  const em = u.email?.trim();
  if (em) return em.charAt(0).toUpperCase();
  return '?';
}
