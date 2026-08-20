import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function getServiceRoleKey(): string {
  return (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    ""
  );
}

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = getServiceRoleKey();
  if (!url || !key) {
    throw new Error("missing_supabase_admin_env");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function createUserClient(authHeader: string | null): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon || !authHeader) {
    throw new Error("missing_supabase_user_env");
  }
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}
