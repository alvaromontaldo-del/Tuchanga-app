import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  esConformidadTrasReparo,
  textoMotivoDisputa,
  TRABAJO_REPARADO,
} from '../constants/serviceCostCopy';
import { shouldRenderSystemMessageInChat, shouldShowSystemMessage } from './chatSystemMessages';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/20261006_card_206_disputa_trabajo_reparado.sql'),
  'utf8',
);

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf('\nCREATE ', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe('disputa y trabajo reparado (#206)', () => {
  it('muestra el motivo del cliente y distingue la conformidad de un arreglo', () => {
    expect(textoMotivoDisputa('  El trabajo quedó incompleto.  Faltó el zócalo  ')).toBe(
      'El trabajo quedó incompleto. Faltó el zócalo',
    );
    expect(textoMotivoDisputa('   ')).toBe('El cliente no cargó un detalle.');
    expect(esConformidadTrasReparo('Otro. Faltó el zócalo')).toBe(true);
    expect(esConformidadTrasReparo('')).toBe(false);
  });

  it('el aviso de disputa lo ve el profesional en el chat y no el cliente', () => {
    const meta = { event: 'disputa_abierta', audience: 'trabajador' };
    expect(shouldShowSystemMessage(meta, 'trabajador')).toBe(true);
    expect(shouldShowSystemMessage(meta, 'cliente')).toBe(false);
    expect(shouldRenderSystemMessageInChat(meta, 'trabajador')).toBe(true);
    expect(
      shouldRenderSystemMessageInChat(
        { event: 'conformidad_rechazada', audience: 'cliente' },
        'cliente',
      ),
    ).toBe(false);
  });

  it('el SQL avisa al profesional, vuelve a pedir conformidad y no toca la garantía ni el cierre', () => {
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.hide_pair_chats_if_done');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.marcar_arreglo_garantia_terminado');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.confirmar_arreglo_garantia');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.auto_confirmar_conformidad_vencida');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.trabajador_finalizar_trabajo');

    const responder = functionBody(sql, 'cliente_responder_conformidad');
    const positiva = responder.slice(responder.indexOf('IF p_conforme THEN'));
    const rechazo = positiva.slice(positiva.indexOf('ELSE'));
    expect(positiva.slice(0, positiva.indexOf('ELSE'))).toContain('hide_pair_chats_if_done');
    expect(rechazo).not.toContain('hide_pair_chats_if_done');
    expect(rechazo).toContain("'audience', 'trabajador'");
    expect(rechazo).toContain("'event', 'disputa_abierta'");
    expect(rechazo).toContain('Motivo:');

    const reparado = functionBody(sql, 'trabajador_marcar_trabajo_reparado');
    expect(reparado).toContain("estado_trabajo = 'pendiente_conformidad'");
    expect(reparado).toContain('conformidad_respondida_at = NULL');
    expect(reparado).toContain('conformidad_solicitada_at = now()');
    expect(reparado).toContain('conformidad_automatica = false');
    expect(reparado).toContain('conformidad_recordatorio_24h_at = NULL');
    expect(reparado).toContain('conformidad_recordatorio_48h_at = NULL');
    expect(reparado).toContain("'event', 'conformidad_solicitada'");
    expect(reparado).toContain("'audience', 'cliente'");
    expect(reparado).toContain("'event', 'trabajo_reparado'");
    expect(reparado).not.toContain('hide_pair_chats_if_done');
    expect(reparado).not.toContain('disputa_motivo =');

    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.trabajador_marcar_trabajo_reparado(uuid) FROM anon',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.trabajador_marcar_trabajo_reparado(uuid) TO authenticated, service_role',
    );
    expect(sql).not.toContain('GRANT EXECUTE ON FUNCTION public.trabajador_marcar_trabajo_reparado(uuid) TO anon');
    expect(sql).not.toContain('GRANT EXECUTE ON FUNCTION public.cliente_responder_conformidad');
  });

  it('el chat y el detalle del servicio muestran el estado, el motivo y el botón', () => {
    const chat = readFileSync(resolve(process.cwd(), 'src/screens/chat/ChatScreen.tsx'), 'utf8');
    const detalle = readFileSync(
      resolve(process.cwd(), 'src/screens/servicios/DetalleServicioScreen.tsx'),
      'utf8',
    );
    for (const src of [chat, detalle]) {
      expect(src).toContain(TRABAJO_REPARADO);
      expect(src).toContain('textoMotivoDisputa');
      expect(src).toContain('trabajadorMarcarTrabajoReparado');
      expect(src).toContain('TRABAJO_REPARADO_PREGUNTA');
    }
    expect(chat).toContain('showWorkerDisputaBar');
    expect(detalle).toContain("myRole === 'trabajador' && row.estado_trabajo === 'disputa'");
    expect(chat).toContain("event === 'disputa_abierta'");
    expect(chat).toContain("event === 'trabajo_reparado'");
    expect(chat).not.toContain('marcar_arreglo_garantia_terminado');
    expect(detalle).toContain("row.estado_trabajo === 'disputa'");
  });
});
