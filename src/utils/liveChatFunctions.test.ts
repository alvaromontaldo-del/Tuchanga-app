import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiConversation } from '../services/chatApi';
import { patchConversationRow } from '../services/inboxState';

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf('\nCREATE ', start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

const iniciar = read('supabase/migrations/20260925223000_iniciar_reclamo_garantia.sql');
const hide = read('supabase/migrations/20260924150000_hide_chat_after_claim_conformity.sql');

describe('funciones de chat recreadas desde producción', () => {
  it('find_or_create_conversation mantiene los códigos de disponibilidad del trabajador', () => {
    const body = functionBody(iniciar, 'find_or_create_conversation');
    expect(body).toContain("RAISE EXCEPTION 'worker_not_found'");
    expect(body).toContain("RAISE EXCEPTION 'worker_on_leave'");
    expect(body).toContain("RAISE EXCEPTION 'worker_unavailable'");
    expect(body).toContain('contratacion_id IS NULL');
    expect(body).toContain('NOT public.conversation_tiene_trabajo_vivo');
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain('search_path = public');
    expect(iniciar).toContain(
      'REVOKE EXECUTE ON FUNCTION public.find_or_create_conversation(uuid, text) FROM anon',
    );
  });

  it('crear_cotizacion rechaza un hilo de reclamo', () => {
    const body = functionBody(iniciar, 'crear_cotizacion');
    expect(body).toContain('IF v_conv.contratacion_id IS NOT NULL THEN');
    expect(body).toContain("RAISE EXCEPTION 'No se puede cotizar en un chat de reclamo'");
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain('search_path = public');
    expect(iniciar).toContain(
      'REVOKE EXECUTE ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) FROM anon',
    );
  });

  it('la regla SQL de ocultado exige conformidad y la app no oculta un finalizado sin reclamo', () => {
    const body = functionBody(hide, 'chat_cerrado_por_reclamo_conformidad');
    expect(body).toContain('c.claim_opened_at IS NOT NULL');
    expect(body).toContain('c.claim_marked_done_at IS NOT NULL');
    expect(body).toContain('c.claim_resolved_at IS NOT NULL');
    expect(body).toContain("c.claim_status = 'closed'");
    expect(body).toContain("c.claim_status IN ('open', 'pending_approval')");
    expect(read('src/services/chatSupabase.ts')).not.toContain('fetchSettledJobChatIds');
    expect(read('src/services/inboxSyncSupabase.ts')).not.toContain('fetchSettledJobChatIds');
    expect(read('src/services/claimChatSupabase.ts')).not.toContain('fetchSettledJobChatIds');
  });
});

describe('fila de reclamo en Mensajes', () => {
  it('la etiqueta queda en la fila y en el encabezado aunque llegue un mensaje nuevo', () => {
    const row: ApiConversation = {
      id: 'chat-reclamo',
      otherUserId: 'worker-1',
      otherDisplayName: 'Ana',
      primaryTrade: 'Gasista',
      claimRowLabel: 'Reclamo · Pintura de frente · 12/09/2026',
      lastMessage: 'aviso de sistema',
      updatedAt: '2026-09-01T00:00:00.000Z',
      myRole: 'cliente',
    };
    const next = patchConversationRow(
      row,
      {
        type: 'message',
        conversationId: row.id,
        senderId: 'worker-1',
        body: '¿mañana a las 10?',
        createdAt: '2026-09-02T00:00:00.000Z',
      },
      'me',
      1,
    );
    expect(next.lastMessage).toBe('¿mañana a las 10?');
    expect(next.claimRowLabel).toBe('Reclamo · Pintura de frente · 12/09/2026');
    const subtitle = read('src/services/messaging.ts');
    const headerFn = subtitle.slice(subtitle.indexOf('export function buildChatHeaderSubtitle'));
    expect(headerFn.indexOf('claimRowLabel')).toBeLessThan(headerFn.indexOf("return 'Cliente'"));

    const list = read('src/screens/chat/ConversationsListScreen.tsx');
    expect(list).toContain('item.claimRowLabel');
    expect(list).toContain('styles.claimChip');
    const chip = list.slice(list.indexOf('styles.claimChip'), list.indexOf('{item.lastMessage}'));
    expect(chip).toContain('claimRowLabel');
    expect(list).toMatch(/claimChip:\s*\{[^}]*textTransform:\s*'none'/);
  });
});
