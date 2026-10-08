/// <reference lib="deno.ns" />

import { createAdminClient, createUserClient, json } from "../_shared/supabaseAdmin.ts";
import { sendReportEmail } from "../_shared/sendReportEmail.ts";

const REPORT_REASON_LABELS: Record<string, string> = {
  estafa: "Intento de estafa",
  conducta: "Comportamiento inapropiado",
  ofensivos: "Mensajes ofensivos",
  contacto_prohibido: "Datos de contacto prohibidos",
  otro: "Otro",
};

type ReportBody = {
  reported_user_id?: string;
  conversation_id?: string | null;
  reason?: string;
  details?: string;
};

function fullName(profile: { nombre?: string | null; apellido?: string | null } | null): string {
  const name = `${profile?.nombre ?? ""} ${profile?.apellido ?? ""}`.trim();
  return name || "Usuario sin nombre";
}

function reasonLabel(code: string): string {
  return REPORT_REASON_LABELS[code] ?? code;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: ReportBody;
  try {
    body = (await req.json()) as ReportBody;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const reportedUserId = (body.reported_user_id ?? "").trim();
  const reasonCode = (body.reason ?? "").trim();
  const details = (body.details ?? "").trim().slice(0, 800);
  const conversationId = (body.conversation_id ?? null)?.trim() || null;

  if (!reportedUserId) return json(400, { error: "reported_user_required" });
  if (!reasonCode) return json(400, { error: "reason_required" });
  if (!REPORT_REASON_LABELS[reasonCode]) return json(400, { error: "invalid_reason" });
  if (!details || details.length < 10) {
    return json(400, {
      error: "details_required",
      detail: "El detalle del reporte es obligatorio (mínimo 10 caracteres).",
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "unauthorized" });

  let reporterId: string;
  try {
    const userClient = createUserClient(authHeader);
    const { data, error } = await userClient.auth.getUser();
    if (error || !data.user?.id) return json(401, { error: "unauthorized" });
    reporterId = data.user.id;
  } catch {
    return json(500, { error: "auth_setup_failed" });
  }

  if (reporterId === reportedUserId) {
    return json(400, { error: "cannot_report_self" });
  }

  const sb = createAdminClient();

  // #72: las disputas guardan contratacion_id. El reporte de chat sigue siendo
  // uno por par, y es el único que entra en el índice parcial
  // user_reports_reporter_reported_unique (WHERE contratacion_id IS NULL).
  const { data: existingReport, error: existingError } = await sb
    .from("user_reports")
    .select("id")
    .eq("reporter_id", reporterId)
    .eq("reported_id", reportedUserId)
    .is("contratacion_id", null)
    .maybeSingle();

  if (existingError) {
    return json(500, { error: "report_lookup_failed", detail: existingError.message });
  }

  if (existingReport?.id) {
    return json(409, {
      error: "already_reported",
      detail: "Ya reportaste a este usuario.",
    });
  }

  const { data: reportRow, error: insertError } = await sb
    .from("user_reports")
    .insert({
      reporter_id: reporterId,
      reported_id: reportedUserId,
      conversation_id: conversationId,
      reason: reasonCode,
      details,
    })
    .select("id")
    .single();

  if (insertError || !reportRow?.id) {
    const msg = insertError?.message ?? "";
    if (msg.includes("user_reports_reporter_reported_unique") || msg.includes("duplicate key")) {
      return json(409, {
        error: "already_reported",
        detail: "Ya reportaste a este usuario.",
      });
    }
    return json(500, { error: "report_insert_failed", detail: insertError?.message ?? null });
  }

  const [{ data: reporterProfile }, { data: reportedProfile }, { data: reporterAuth }] =
    await Promise.all([
      sb.from("profiles").select("nombre, apellido").eq("id", reporterId).maybeSingle(),
      sb.from("profiles").select("nombre, apellido").eq("id", reportedUserId).maybeSingle(),
      sb.auth.admin.getUserById(reporterId),
    ]);

  const reporterName = fullName(reporterProfile);
  const reportedName = fullName(reportedProfile);
  const reporterEmail = reporterAuth.user?.email ?? "sin-email";
  const motivo = reasonLabel(reasonCode);
  const subject = `Reporte - ${motivo} - ${reporterName}`;

  try {
    const sendResult = await sendReportEmail({
      subject,
      reasonLabel: motivo,
      details,
      reporterName,
      reporterEmail,
      reportedName,
      reportedUserId,
      conversationId,
      reportId: reportRow.id,
    });
    return json(200, {
      ok: true,
      report_id: reportRow.id,
      email_sent: true,
      channel: sendResult.channel,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "email_failed";
    console.error("report_email_failed", message);
    return json(200, {
      ok: true,
      report_id: reportRow.id,
      email_sent: false,
      email_error: message,
    });
  }
});
