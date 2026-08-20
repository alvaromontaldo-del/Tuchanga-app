export type ExpoPushPayload = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/** Envío vía Expo Push Service con canal/prioridad Android explícitos. */
export async function sendExpoPush(params: ExpoPushPayload): Promise<string> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      to: params.to,
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
    }),
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`expo_push_failed:${res.status}:${txt}`);
  }
  return txt;
}
