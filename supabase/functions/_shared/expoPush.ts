export type ExpoPushPayload = {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

function uniqueTokens(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const t = String(raw ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Envío vía Expo Push Service con canal/prioridad Android explícitos. Deduplica `to`. */
export async function sendExpoPush(params: ExpoPushPayload): Promise<string> {
  const tokens = uniqueTokens(params.to);
  if (tokens.length === 0) {
    throw new Error("expo_push_no_tokens");
  }

  const messages = tokens.map((to) => ({
    to,
    title: params.title,
    body: params.body,
    data: params.data ?? {},
    sound: "default",
    priority: "high",
    channelId: "default",
    android: {
      channelId: "default",
      priority: "high",
      sound: true,
    },
  }));

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`expo_push_failed:${res.status}:${txt}`);
  }
  return txt;
}
