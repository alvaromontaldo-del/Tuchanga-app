/** Header que deben mandar triggers, pg_net y el cron. */
export const FUNCTION_SECRET_HEADER = "x-function-secret";

/** Alias histórico de cleanup_chat_images. Mismo valor que EDGE_FUNCTION_SECRET. */
export const CLEANUP_SECRET_HEADER = "x-cleanup-secret";

type HeaderSource = { get(name: string): string | null };

export function providedFunctionSecret(headers: HeaderSource): string {
  return (
    headers.get(FUNCTION_SECRET_HEADER) ??
    headers.get(CLEANUP_SECRET_HEADER) ??
    ""
  ).trim();
}

export function secretsMatch(provided: string, expected: string): boolean {
  const a = provided.trim();
  const b = expected.trim();
  if (!a || !b) return false;
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
