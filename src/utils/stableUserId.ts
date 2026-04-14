/**
 * ID estable por email (mock) para que el mismo login reutilice conversaciones en el backend.
 */
export function stableUserIdFromEmail(email: string): string {
  const s = email.trim().toLowerCase();
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 65599);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  const c = ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0');
  return `${a.slice(0, 8)}-${a.slice(0, 4)}-4${b.slice(1, 4)}-9${c.slice(1, 4)}-${(b + c).slice(0, 12)}`;
}

export function newRandomUserId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return stableUserIdFromEmail(`${Date.now()}-${Math.random()}`);
}
