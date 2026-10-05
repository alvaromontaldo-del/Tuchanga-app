/// <reference lib="deno.ns" />
/**
 * #123 Limpieza de storage huérfano / archivos de cuenta borrada.
 *
 * - mode=orphans: borra objetos no referenciados (gracia min_age_days, default 7).
 * - mode=user: borra objetos de la carpeta/owner del user_id (al eliminar cuenta).
 * - dry_run=true: solo lista y loguea, no borra.
 *
 * Auth: Bearer service_role, o x-function-secret / x-cleanup-secret.
 * Nunca borra el bucket Yachanga (sistema).
 */
import { createAdminClient, getServiceRoleKey, json } from "../_shared/supabaseAdmin.ts";

type Candidate = {
  bucket_id: string;
  object_path: string;
  bytes: number;
  created_at: string;
};

async function authorize(req: Request): Promise<boolean> {
  const service = getServiceRoleKey();
  const auth = req.headers.get("Authorization") ?? "";
  if (service && auth === `Bearer ${service}`) return true;

  const headerSecret = (
    req.headers.get("x-function-secret") ??
    req.headers.get("x-cleanup-secret") ??
    ""
  ).trim();
  if (!headerSecret) return false;

  // Compara contra vault.edge_function_secret vía RPC (service_role del env).
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("verify_edge_function_secret", {
      p_secret: headerSecret,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, x-client-info, apikey, content-type, x-function-secret, x-cleanup-secret",
      },
    });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json(405, { error: "method_not_allowed" });
  }

  if (!(await authorize(req))) {
    return json(401, { error: "unauthorized" });
  }

  let mode = "orphans";
  let userId: string | null = null;
  let dryRun = false;
  let minAgeDays = 7;

  try {
    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        mode?: string;
        user_id?: string | null;
        dry_run?: boolean;
        min_age_days?: number;
      };
      if (typeof body.mode === "string" && body.mode.trim()) {
        mode = body.mode.trim().toLowerCase();
      }
      if (typeof body.user_id === "string" && body.user_id.trim()) {
        userId = body.user_id.trim();
      }
      if (typeof body.dry_run === "boolean") dryRun = body.dry_run;
      if (
        typeof body.min_age_days === "number" &&
        Number.isFinite(body.min_age_days) &&
        body.min_age_days >= 0
      ) {
        minAgeDays = Math.floor(body.min_age_days);
      }
    }
  } catch {
    // ignore
  }

  if (mode !== "orphans" && mode !== "user") {
    return json(400, { error: "invalid_mode" });
  }
  if (mode === "user" && !userId) {
    return json(400, { error: "user_id_required" });
  }

  const admin = createAdminClient();

  const { data: rows, error: listErr } = await admin.rpc(
    "list_unreferenced_storage_objects",
    {
      p_mode: mode,
      p_user_id: userId,
      p_min_age_days: mode === "user" ? 0 : minAgeDays,
      p_limit: 5000,
    },
  );

  if (listErr) {
    return json(500, { error: "list_failed", message: listErr.message });
  }

  const candidates = (rows ?? []) as Candidate[];
  const bytesCandidates = candidates.reduce(
    (acc, c) => acc + (Number(c.bytes) || 0),
    0,
  );

  const byBucket: Record<string, { count: number; bytes: number; paths: string[] }> =
    {};
  for (const c of candidates) {
    if (c.bucket_id === "Yachanga") continue;
    const slot = byBucket[c.bucket_id] ?? { count: 0, bytes: 0, paths: [] };
    slot.count += 1;
    slot.bytes += Number(c.bytes) || 0;
    slot.paths.push(c.object_path);
    byBucket[c.bucket_id] = slot;
  }

  if (dryRun || candidates.length === 0) {
    await admin.rpc("storage_cleanup_record_result", {
      p_mode: mode,
      p_user_id: userId,
      p_candidates: candidates.length,
      p_removed: 0,
      p_bytes_candidates: bytesCandidates,
      p_bytes_removed: 0,
      p_details: {
        dry_run: dryRun,
        by_bucket: Object.fromEntries(
          Object.entries(byBucket).map(([k, v]) => [
            k,
            { count: v.count, bytes: v.bytes },
          ]),
        ),
      },
    });
    return json(200, {
      ok: true,
      dry_run: dryRun,
      mode,
      candidates: candidates.length,
      bytes: bytesCandidates,
      removed: 0,
      by_bucket: Object.fromEntries(
        Object.entries(byBucket).map(([k, v]) => [
          k,
          { count: v.count, bytes: v.bytes },
        ]),
      ),
    });
  }

  let removed = 0;
  let bytesRemoved = 0;
  const storageErrors: string[] = [];
  const BATCH = 100;

  for (const [bucket, info] of Object.entries(byBucket)) {
    for (let i = 0; i < info.paths.length; i += BATCH) {
      const chunk = info.paths.slice(i, i + BATCH);
      const { data, error } = await admin.storage.from(bucket).remove(chunk);
      if (error) {
        storageErrors.push(`${bucket}: ${error.message}`);
        continue;
      }
      const n = Array.isArray(data) ? data.length : chunk.length;
      removed += n;
      // approx: proportional to chunk
      const chunkBytes = candidates
        .filter((c) => c.bucket_id === bucket && chunk.includes(c.object_path))
        .reduce((a, c) => a + (Number(c.bytes) || 0), 0);
      bytesRemoved += chunkBytes;
    }
  }

  await admin.rpc("storage_cleanup_record_result", {
    p_mode: mode,
    p_user_id: userId,
    p_candidates: candidates.length,
    p_removed: removed,
    p_bytes_candidates: bytesCandidates,
    p_bytes_removed: bytesRemoved,
    p_details: {
      dry_run: false,
      storage_errors: storageErrors.length ? storageErrors : undefined,
      by_bucket: Object.fromEntries(
        Object.entries(byBucket).map(([k, v]) => [
          k,
          { count: v.count, bytes: v.bytes },
        ]),
      ),
    },
  });

  return json(200, {
    ok: true,
    dry_run: false,
    mode,
    candidates: candidates.length,
    bytes: bytesCandidates,
    removed,
    bytes_removed: bytesRemoved,
    storage_errors: storageErrors.length ? storageErrors : undefined,
    by_bucket: Object.fromEntries(
      Object.entries(byBucket).map(([k, v]) => [
        k,
        { count: v.count, bytes: v.bytes },
      ]),
    ),
  });
});
