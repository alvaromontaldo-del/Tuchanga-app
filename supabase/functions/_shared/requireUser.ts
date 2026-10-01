import { isRejectedAccessToken, bearerToken } from "./accessToken.ts";
import { createUserClient, json } from "./supabaseAdmin.ts";

export async function requireAuthenticatedUser(
  req: Request,
): Promise<{ userId: string } | Response> {
  const header = req.headers.get("Authorization");
  const anon = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (isRejectedAccessToken(header, anon)) {
    return json(401, { error: "unauthorized" });
  }

  const token = bearerToken(header);
  const authHeader = /^bearer\s+/i.test(header ?? "") ? (header as string) : `Bearer ${token}`;
  try {
    const userClient = createUserClient(authHeader);
    const { data, error } = await userClient.auth.getUser(token);
    if (error || !data.user?.id) return json(401, { error: "unauthorized" });
    return { userId: data.user.id };
  } catch {
    return json(500, { error: "auth_setup_failed" });
  }
}
