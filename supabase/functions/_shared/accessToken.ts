export function bearerToken(authorization: string | null | undefined): string {
  const raw = (authorization ?? "").trim();
  if (!raw) return "";
  if (/^bearer\s+/i.test(raw)) return raw.replace(/^bearer\s+/i, "").trim();
  return raw;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Rechaza la anon key pelada, `Bearer <anon key>` y cualquier JWT con role
 * anon o sin `sub` (incluido service_role). Un access token de usuario
 * autenticado no se rechaza acá: igual hay que validarlo con auth.getUser.
 */
export function isRejectedAccessToken(
  authorization: string | null | undefined,
  anonKey: string | null | undefined,
): boolean {
  const token = bearerToken(authorization);
  if (!token) return true;
  const anon = (anonKey ?? "").trim();
  if (anon && token === anon) return true;
  const payload = decodeJwtPayload(token);
  if (!payload) return true;
  const role = String(payload.role ?? "");
  if (role === "anon" || role === "service_role") return true;
  if (typeof payload.sub !== "string" || !payload.sub.trim()) return true;
  return false;
}
