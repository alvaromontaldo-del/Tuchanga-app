import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';

export const MATERIALS_LIST_BLOCKED_MESSAGE =
  'Este oficio no puede pedir cotización de materiales.';

/**
 * El oficio vacío o desconocido queda habilitado: todos arrancan en true y,
 * si el SQL todavía no está aplicado, el botón sigue como hoy.
 */
export async function tradeAllowsMaterialsList(tradeName: string | null | undefined): Promise<boolean> {
  const name = tradeName?.trim() ?? '';
  if (!name || !isSupabaseConfigured()) return true;

  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('trade_allows_materials_list', {
    p_trade_name: name,
  });
  if (error) return true;
  return data !== false;
}

export async function conversationAllowsMaterialsList(input: {
  conversationId?: string | null;
  workerId?: string | null;
  primaryTrade?: string | null;
}): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;

  let trade = input.primaryTrade?.trim() ?? '';
  const sb = getSupabaseClient();

  if (!trade && input.conversationId) {
    const { data, error } = await sb
      .from('conversations')
      .select('primary_trade')
      .eq('id', input.conversationId)
      .maybeSingle();
    if (!error) {
      trade = String((data as { primary_trade?: string | null } | null)?.primary_trade ?? '').trim();
    }
  }

  if (!trade && input.workerId) {
    const { data, error } = await sb
      .from('jobs')
      .select('nombre_oficio')
      .eq('user_id', input.workerId)
      .order('es_principal', { ascending: false })
      .limit(1);
    if (!error) {
      const row = (data ?? [])[0] as { nombre_oficio?: string | null } | undefined;
      trade = String(row?.nombre_oficio ?? '').trim();
    }
  }

  return tradeAllowsMaterialsList(trade);
}
