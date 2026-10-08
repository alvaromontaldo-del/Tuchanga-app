const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "yachanga.app@gmail.com";
const REPORT_EMAIL_TO = Deno.env.get("REPORT_EMAIL_TO") ?? GMAIL_USER;
const GMAIL_APPS_SCRIPT_URL = (Deno.env.get("GMAIL_APPS_SCRIPT_URL") ?? "").trim();
const GMAIL_APPS_SCRIPT_SECRET = (Deno.env.get("GMAIL_APPS_SCRIPT_SECRET") ?? "").trim();
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
const RESEND_FROM = (Deno.env.get("RESEND_FROM") ?? "YaChanga <onboarding@resend.dev>").trim();
/** `apps_script` | `resend` — si no se setea, usa apps_script cuando está configurado. */
const REPORT_EMAIL_PROVIDER = (Deno.env.get("REPORT_EMAIL_PROVIDER") ?? "").trim().toLowerCase();

export type ReportEmailPayload = {
  subject: string;
  reasonLabel: string;
  details: string;
  reporterName: string;
  reporterEmail: string;
  reportedName: string;
  reportedUserId: string;
  conversationId: string | null;
  reportId: string;
  /** Solo el mail interno de «Tuve un problema». El reporte de chat no los manda. */
  reporterPhone?: string;
  reportedEmail?: string;
  reportedPhone?: string;
  jobId?: string;
  jobTitle?: string;
  jobTrade?: string;
  jobDate?: string;
  jobAmount?: string;
  jobWorkerAmount?: string;
};

export type SendReportEmailResult = {
  channel: "apps_script" | "resend";
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildHtmlBody(payload: ReportEmailPayload): string {
  if (payload.jobId) return buildTrabajoNoConformeHtml(payload);

  const detailBlock = payload.details.trim()
    ? `<p><strong>Detalle:</strong><br/>${escapeHtml(payload.details).replaceAll("\n", "<br/>")}</p>`
    : "<p><strong>Detalle:</strong> (sin detalle adicional)</p>";

  return `
    <h2>Nuevo reporte de usuario</h2>
    <p><strong>Motivo:</strong> ${escapeHtml(payload.reasonLabel)}</p>
    ${detailBlock}
    <hr/>
    <p><strong>Reportado por:</strong> ${escapeHtml(payload.reporterName)} (${escapeHtml(payload.reporterEmail)})</p>
    <p><strong>Usuario reportado:</strong> ${escapeHtml(payload.reportedName)}</p>
    <p><strong>ID reporte:</strong> ${escapeHtml(payload.reportId)}</p>
    <p><strong>ID usuario reportado:</strong> ${escapeHtml(payload.reportedUserId)}</p>
    ${
      payload.conversationId
        ? `<p><strong>Conversación:</strong> ${escapeHtml(payload.conversationId)}</p>`
        : ""
    }
  `.trim();
}

function line(label: string, value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text || "sin dato")}</p>`;
}

/** Mail interno de operación. Acá van apellido, mail y teléfono: no lo ve el cliente. */
function buildTrabajoNoConformeHtml(payload: ReportEmailPayload): string {
  const descripcion = payload.details.trim()
    ? escapeHtml(payload.details).replaceAll("\n", "<br/>")
    : "(sin descripción)";

  return `
    <h2>Trabajo no conforme</h2>
    <p><strong>Motivo:</strong> ${escapeHtml(payload.reasonLabel)}</p>
    <p><strong>Descripción:</strong><br/>${descripcion}</p>
    <hr/>
    <h3>Cliente</h3>
    ${line("Nombre", payload.reporterName)}
    ${line("Mail", payload.reporterEmail)}
    ${line("Teléfono", payload.reporterPhone)}
    <h3>Profesional</h3>
    ${line("Nombre", payload.reportedName)}
    ${line("Mail", payload.reportedEmail)}
    ${line("Teléfono", payload.reportedPhone)}
    <h3>Trabajo</h3>
    ${line("Id", payload.jobId)}
    ${line("Título", payload.jobTitle)}
    ${line("Oficio", payload.jobTrade)}
    ${line("Fecha", payload.jobDate)}
    ${line("Monto (precio final)", payload.jobAmount)}
    ${line("Lo que cobra el profesional", payload.jobWorkerAmount)}
    <hr/>
    ${line("Id del reporte", payload.reportId)}
    ${line("Id del profesional", payload.reportedUserId)}
    ${payload.conversationId ? line("Conversación", payload.conversationId) : ""}
  `.trim();
}

function validateAppsScriptUrl(url: string): void {
  if (!url) throw new Error("missing_gmail_apps_script_url");
  if (url.includes("/dev")) {
    throw new Error("apps_script_url_must_be_exec_not_dev");
  }
  if (!url.includes("/exec")) {
    throw new Error("apps_script_url_must_end_with_exec");
  }
}

function parseAppsScriptResponse(raw: string): { ok?: boolean; error?: string } {
  if (raw.includes("Authorization needed") || raw.includes("Sign in")) {
    return { ok: false, error: "apps_script_needs_authorization_or_anyone_access" };
  }
  if (raw.includes("<!DOCTYPE") || raw.includes("<html")) {
    return { ok: false, error: "apps_script_returned_html_not_json" };
  }
  try {
    return JSON.parse(raw) as { ok?: boolean; error?: string };
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as { ok?: boolean; error?: string };
    }
    throw new Error(`apps_script_bad_response:${raw.slice(0, 200)}`);
  }
}

async function callAppsScript(fields: Record<string, string>): Promise<{ ok?: boolean; error?: string }> {
  validateAppsScriptUrl(GMAIL_APPS_SCRIPT_URL);

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  const body = form.toString();

  // Un solo POST. Apps Script suele responder 302 tras ejecutar doPost;
  // volver a POSTear al redirect duplica el mail (mismo reportId, 2 correos).
  const res = await fetch(GMAIL_APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    // doPost ya corrió antes del redirect.
    return { ok: true };
  }

  if (!res.ok) {
    throw new Error(`apps_script_http_${res.status}`);
  }

  const parsed = parseAppsScriptResponse(await res.text());
  if (parsed.ok) return parsed;

  throw new Error(parsed.error ?? "apps_script_failed");
}

async function sendViaAppsScript(payload: ReportEmailPayload): Promise<void> {
  const result = await callAppsScript({
    secret: GMAIL_APPS_SCRIPT_SECRET,
    to: REPORT_EMAIL_TO,
    subject: payload.subject,
    html: buildHtmlBody(payload),
  });

  if (!result.ok) {
    throw new Error(result.error ?? "apps_script_failed");
  }
}

async function sendViaResend(payload: ReportEmailPayload): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [REPORT_EMAIL_TO],
      subject: payload.subject,
      html: buildHtmlBody(payload),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`resend_failed:${res.status}:${detail.slice(0, 200)}`);
  }
}

function appsScriptConfigured(): boolean {
  return Boolean(GMAIL_APPS_SCRIPT_URL && GMAIL_APPS_SCRIPT_SECRET);
}

export async function sendReportEmail(payload: ReportEmailPayload): Promise<SendReportEmailResult> {
  const preferAppsScript =
    REPORT_EMAIL_PROVIDER === "apps_script" ||
    (REPORT_EMAIL_PROVIDER !== "resend" && appsScriptConfigured());

  const errors: string[] = [];

  if (preferAppsScript && appsScriptConfigured()) {
    try {
      await sendViaAppsScript(payload);
      return { channel: "apps_script" };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "apps_script_failed");
    }
  }

  if (RESEND_API_KEY && REPORT_EMAIL_PROVIDER !== "apps_script") {
    try {
      await sendViaResend(payload);
      return { channel: "resend" };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "resend_failed");
    }
  }

  if (!appsScriptConfigured() && !RESEND_API_KEY) {
    throw new Error(
      "email_not_configured: configurá GMAIL_APPS_SCRIPT_URL + GMAIL_APPS_SCRIPT_SECRET o RESEND_API_KEY",
    );
  }

  throw new Error(errors.join(" | ") || "email_send_failed");
}
