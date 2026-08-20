/// <reference lib="deno.ns" />
/**
 * Purga de imágenes de chat + (vía RPC) ocultar chat a ambos usuarios.
 *
 * Condiciones (SQL):
 * - Cliente dejó reseña
 * - Trabajador confirmó recepción del pago (totalmente_pagado)
 * - Retención: chat_cleanup_retention_days() — hoy 0 (inmediato)
 *
 * 1) archive_eligible_chats_and_list_images → hide ambos + lista imágenes
 * 2) Borra objetos en job-photos
 * 3) DELETE messages type=image
 *
 * Schedule diario de respaldo, o invoke desde la app al completar reseña/pago.
 */
import { createAdminClient, json } from "../_shared/supabaseAdmin.ts";

type ExpiredRow = {
  message_id: string;
  conversation_id: string;
  image_url: string | null;
  storage_path: string | null;
  closed_at: string;
};

function authorize(req: Request): boolean {
  const secret = (Deno.env.get("CLEANUP_CRON_SECRET") ?? "").trim();
  const auth = req.headers.get("Authorization") ?? "";
  const service =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    "";
  if (secret) {
    const header = (req.headers.get("x-cleanup-secret") ?? "").trim();
    if (header && header === secret) return true;
  }
  // Service role o usuario autenticado (invoke desde la app tras reseña/pago)
  if (service && auth === `Bearer ${service}`) return true;
  if (auth.toLowerCase().startsWith("bearer ") && auth.length > 20) return true;
  return false;
}

function uniquePaths(rows: ExpiredRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const p = (r.storage_path ?? "").trim();
    if (p) set.add(p);
  }
  return [...set];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, x-client-info, apikey, content-type, x-cleanup-secret",
      },
    });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json(405, { error: "method_not_allowed" });
  }

  if (!authorize(req)) {
    return json(401, { error: "unauthorized" });
  }

  let retentionDays: number | null = null;
  let contratacionId: string | null = null;
  try {
    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        retention_days?: number;
        contratacion_id?: string;
      };
      if (
        typeof body.retention_days === "number" &&
        Number.isFinite(body.retention_days) &&
        body.retention_days >= 0
      ) {
        retentionDays = Math.floor(body.retention_days);
      }
      if (typeof body.contratacion_id === "string" && body.contratacion_id.trim()) {
        contratacionId = body.contratacion_id.trim();
      }
    }
  } catch {
    // ignore
  }

  const admin = createAdminClient();

  if (contratacionId) {
    await admin.rpc("try_archive_chat_after_job_complete", {
      p_contratacion_id: contratacionId,
    });
  }

  const rpcArgs =
    retentionDays == null
      ? {}
      : { p_retention_days: retentionDays };

  const { data: rows, error: listErr } = await admin.rpc(
    "archive_eligible_chats_and_list_images",
    rpcArgs,
  );

  if (listErr) {
    return json(500, {
      error: "list_failed",
      message: listErr.message,
    });
  }

  const expired = (rows ?? []) as ExpiredRow[];
  if (expired.length === 0) {
    return json(200, {
      ok: true,
      retention_days: retentionDays,
      candidates: 0,
      storage_removed: 0,
      messages_deleted: 0,
      chats_archived: Boolean(contratacionId),
    });
  }

  const paths = uniquePaths(expired);
  let storageRemoved = 0;
  const storageErrors: string[] = [];

  const BATCH = 100;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    const { data, error } = await admin.storage.from("job-photos").remove(chunk);
    if (error) {
      storageErrors.push(error.message);
    } else {
      storageRemoved += Array.isArray(data) ? data.length : chunk.length;
    }
  }

  const messageIds = [...new Set(expired.map((r) => r.message_id).filter(Boolean))];
  const { data: deletedCount, error: delErr } = await admin.rpc(
    "delete_chat_image_messages",
    { p_message_ids: messageIds },
  );

  if (delErr) {
    return json(500, {
      error: "delete_messages_failed",
      message: delErr.message,
      storage_removed: storageRemoved,
      storage_errors: storageErrors,
      candidates: expired.length,
    });
  }

  return json(200, {
    ok: true,
    retention_days: retentionDays,
    candidates: expired.length,
    conversations: [...new Set(expired.map((r) => r.conversation_id))].length,
    storage_paths: paths.length,
    storage_removed: storageRemoved,
    storage_errors: storageErrors.length ? storageErrors : undefined,
    messages_deleted: Number(deletedCount) || 0,
  });
});
