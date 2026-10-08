/// <reference lib="deno.ns" />

import { requireFunctionSecret } from "../_shared/functionSecretGuard.ts";
import { sendReportEmail } from "../_shared/sendReportEmail.ts";
import { createAdminClient, json } from "../_shared/supabaseAdmin.ts";

const MOTIVOS = [
  "El trabajo quedó incompleto",
  "No es lo que acordamos",
  "El profesional no se presentó",
  "Otro",
] as const;

type ReportRecord = {
  id?: string;
  reporter_id?: string;
  reported_id?: string;
  conversation_id?: string | null;
  reason?: string;
  details?: string | null;
  contratacion_id?: string | null;
};

type WebhookBody = {
  type?: string;
  table?: string;
  record?: ReportRecord;
};

type ProfileRow = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
};

function fullName(profile: ProfileRow | undefined): string {
  const name = `${profile?.nombre ?? ""} ${profile?.apellido ?? ""}`.trim();
  return name || "Usuario sin nombre";
}

function splitMotivo(raw: string): { corto: string; descripcion: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { corto: "Sin motivo", descripcion: "" };
  for (const motivo of MOTIVOS) {
    if (text === motivo) return { corto: motivo, descripcion: "" };
    const prefix = `${motivo}. `;
    if (text.startsWith(prefix)) {
      return { corto: motivo, descripcion: text.slice(prefix.length).trim() };
    }
  }
  const dot = text.indexOf(". ");
  if (dot > 0) {
    return { corto: text.slice(0, dot).trim(), descripcion: text.slice(dot + 2).trim() };
  }
  return { corto: text, descripcion: "" };
}

function money(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "sin monto";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
}

function fecha(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text || "sin fecha";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

async function userEmail(
  sb: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string> {
  try {
    const { data, error } = await sb.auth.admin.getUserById(userId);
    if (error || !data.user?.email) return "sin-email";
    return data.user.email;
  } catch {
    return "sin-email";
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const denied = await requireFunctionSecret(req);
  if (denied) return denied;

  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const record = body.record;
  if (!record?.id || !record.reporter_id || !record.reported_id) {
    return json(400, { error: "missing_report_fields" });
  }

  if (body.type && body.type !== "INSERT") {
    return json(200, { ok: true, ignored: true });
  }

  if ((record.reason ?? "") !== "Tuve un problema") {
    return json(200, { ok: true, ignored: true });
  }

  let sb: ReturnType<typeof createAdminClient>;
  try {
    sb = createAdminClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : "admin_setup_failed";
    console.error("notify_trabajo_no_conforme_setup", message);
    return json(200, { ok: true, email_sent: false, email_error: message });
  }

  try {
    const contratacionId = (record.contratacion_id ?? "").trim();
    const { data: job } = contratacionId
      ? await sb
        .from("contrataciones")
        .select(
          "id, client_id, worker_id, conversation_id, service_detail, fecha_trabajo, precio_trabajador, precio_final, disputa_motivo",
        )
        .eq("id", contratacionId)
        .maybeSingle()
      : { data: null };

    const clientId = record.reporter_id;
    const workerId = record.reported_id;
    const conversationId = job?.conversation_id ?? record.conversation_id ?? null;

    const [{ data: profiles }, clientEmail, workerEmail, conv] = await Promise.all([
      sb.from("profiles").select("id, nombre, apellido, telefono").in("id", [clientId, workerId]),
      userEmail(sb, clientId),
      userEmail(sb, workerId),
      conversationId
        ? sb.from("conversations").select("primary_trade").eq("id", conversationId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const rows = (profiles ?? []) as ProfileRow[];
    const client = rows.find((row) => row.id === clientId);
    const worker = rows.find((row) => row.id === workerId);
    const motivoFuente = (job?.disputa_motivo ?? record.details ?? "").trim();
    const { corto, descripcion } = splitMotivo(motivoFuente);
    const trade = (conv.data?.primary_trade ?? "").trim();
    const title = (job?.service_detail ?? "").trim() || trade || "Trabajo";

    const sendResult = await sendReportEmail({
      subject: `TRABAJO NO CONFORME - ${corto}`,
      reasonLabel: corto,
      details: descripcion,
      reporterName: fullName(client),
      reporterEmail: clientEmail,
      reporterPhone: (client?.telefono ?? "").trim(),
      reportedName: fullName(worker),
      reportedEmail: workerEmail,
      reportedPhone: (worker?.telefono ?? "").trim(),
      reportedUserId: workerId,
      conversationId,
      reportId: record.id,
      jobId: job?.id ?? (contratacionId || record.id),
      jobTitle: title,
      jobTrade: trade || "sin oficio",
      jobDate: fecha(job?.fecha_trabajo ?? null),
      jobAmount: money(job?.precio_final),
      jobWorkerAmount: money(job?.precio_trabajador),
    });

    return json(200, {
      ok: true,
      report_id: record.id,
      email_sent: true,
      channel: sendResult.channel,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "email_failed";
    console.error("notify_trabajo_no_conforme_email", message);
    // La disputa y la fila ya están commiteadas. Un 200 evita que un reintento
    // del POST se confunda con un fallo de la transacción.
    return json(200, {
      ok: true,
      report_id: record.id,
      email_sent: false,
      email_error: message,
    });
  }
});
