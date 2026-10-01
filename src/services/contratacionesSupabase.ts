import { getSupabaseClient } from '../lib/supabase';
import { removeSupabaseRealtimeTopic } from '../lib/supabaseRealtime';
import {
  type Contratacion,
  type ContratacionEstadoPago,
  type ContratacionEstadoTrabajo,
  type DisponibilidadOpcion,
  type DisponibilidadOpcionEstado,
} from '../types/contrataciones';
import { normalizeDisplayAddress } from '../utils/formatAddress';
import { calculateYachangaServiceFee } from '../utils/yachangaJobServiceFee';
import { assertWarrantyDays } from '../utils/warrantyDays';

/**
 * Todas las columnas actuales de `contrataciones` menos `verification_pin`.
 * El PIN del cliente sale de `obtener_pin_cliente` / `verificar_pin`.
 * Tiene que coincidir con el GRANT de fase 2 en
 * `supabase/20260929_p0_pii_pin_card_62_64.sql`.
 */
const CONTRATACION_SELECT = [
  'id',
  'conversation_id',
  'worker_id',
  'client_id',
  'precio_trabajador',
  'precio_final',
  'comision_app',
  'service_detail',
  'estado_trabajo',
  'estado_pago',
  'fecha_trabajo',
  'hora_inicio',
  'hora_fin',
  'pin_intentos_fallidos',
  'pin_bloqueado_hasta',
  'recotizacion_precio_trabajador',
  'recotizacion_precio_final',
  'recotizacion_comision_app',
  'paid_at',
  'seña_pagada_at',
  'completed_by_worker_at',
  'finalizado_at',
  'cancelado_at',
  'conformidad_solicitada_at',
  'conformidad_respondida_at',
  'conformidad_aceptada',
  'is_claim_open',
  'claim_status',
  'claim_opened_at',
  'claim_marked_done_at',
  'claim_resolved_at',
  'offline_pago_notificado_at',
  'offline_pago_confirmado_at',
  'disputa_motivo',
  'chat_archived_at',
  'warranty_days',
  'warranty_anchor_at',
  'created_at',
  'updated_at',
].join(',');

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function throwContratacionRpcError(
  error: { message?: string; details?: string; hint?: string },
  fallback: string,
): never {
  const raw = [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase();

  if (raw.includes('message_blocked_contact')) {
    throw new Error('No se pudo avisar en el chat.');
  }
  if (raw.includes('proponer_disponibilidad_opciones') && raw.includes('does not exist')) {
    throw new Error(
      'Falta la función de disponibilidad en Supabase. Ejecutá la migración 20260604120000_cotizacion_disponibilidad_notifications.sql.',
    );
  }
  if (raw.includes('disponibilidad_opciones') && raw.includes('does not exist')) {
    throw new Error(
      'Falta la tabla de disponibilidad en Supabase. Ejecutá la migración 20260604120000_cotizacion_disponibilidad_notifications.sql.',
    );
  }
  if (raw.includes('estado inválido para proponer disponibilidad')) {
    throw new Error('El cliente debe aceptar el presupuesto antes de enviar horarios.');
  }
  if (raw.includes('solo el trabajador puede proponer disponibilidad')) {
    throw new Error('Solo el profesional puede enviar opciones de horario.');
  }
  if (raw.includes('fecha y horario válidos') || raw.includes('horario válido')) {
    throw new Error('Revisá cada opción: la hora de fin debe ser posterior a la de inicio.');
  }
  if (raw.includes('entre 1 y 5 opciones')) {
    throw new Error('Debés enviar entre 1 y 5 opciones de horario.');
  }

  const msg = error.message?.trim();
  throw new Error(msg && msg.length > 0 ? msg : fallback);
}

function contratacionRows(data: unknown): Record<string, unknown>[] {
  return data as Record<string, unknown>[];
}

function contratacionRow(data: unknown): Record<string, unknown> {
  return data as Record<string, unknown>;
}

function mapContratacionRow(r: Record<string, unknown>): Contratacion {
  // No leer verification_pin: ni el select ni el payload de realtime lo usan.
  return {
    id: String(r.id),
    conversation_id: String(r.conversation_id),
    worker_id: String(r.worker_id),
    client_id: String(r.client_id),
    precio_trabajador: toNum(r.precio_trabajador),
    precio_final: toNum(r.precio_final),
    comision_app: toNum(r.comision_app),
    service_detail: String(r.service_detail ?? ''),
    estado_trabajo: (r.estado_trabajo as ContratacionEstadoTrabajo) ?? 'precio_cotizado',
    estado_pago: (r.estado_pago as ContratacionEstadoPago) ?? 'pendiente_seña',
    fecha_trabajo: (r.fecha_trabajo as string | null) ?? null,
    hora_inicio: (r.hora_inicio as string | null) ?? null,
    hora_fin: (r.hora_fin as string | null) ?? null,
    recotizacion_precio_trabajador:
      r.recotizacion_precio_trabajador != null ? toNum(r.recotizacion_precio_trabajador) : null,
    recotizacion_precio_final:
      r.recotizacion_precio_final != null ? toNum(r.recotizacion_precio_final) : null,
    recotizacion_comision_app:
      r.recotizacion_comision_app != null ? toNum(r.recotizacion_comision_app) : null,
    paid_at: (r.paid_at as string | null) ?? null,
    seña_pagada_at: (r.seña_pagada_at as string | null) ?? null,
    completed_by_worker_at: (r.completed_by_worker_at as string | null) ?? null,
    finalizado_at: (r.finalizado_at as string | null) ?? null,
    cancelado_at: (r.cancelado_at as string | null) ?? null,
    conformidad_solicitada_at: (r.conformidad_solicitada_at as string | null) ?? null,
    conformidad_respondida_at: (r.conformidad_respondida_at as string | null) ?? null,
    conformidad_aceptada:
      r.conformidad_aceptada === null || r.conformidad_aceptada === undefined
        ? null
        : Boolean(r.conformidad_aceptada),
    is_claim_open: r.is_claim_open === true,
    claim_status: String(r.claim_status ?? 'none'),
    claim_opened_at: (r.claim_opened_at as string | null) ?? null,
    claim_marked_done_at: (r.claim_marked_done_at as string | null) ?? null,
    claim_resolved_at: (r.claim_resolved_at as string | null) ?? null,
    offline_pago_notificado_at: (r.offline_pago_notificado_at as string | null) ?? null,
    offline_pago_confirmado_at: (r.offline_pago_confirmado_at as string | null) ?? null,
    disputa_motivo: String(r.disputa_motivo ?? ''),
    warranty_days: readWarrantyDays(r.warranty_days),
    warranty_anchor_at: (r.warranty_anchor_at as string | null) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function readWarrantyDays(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Math.floor(toNum(v));
  return n > 0 ? n : null;
}

/**
 * Espejo de display. El cobro lo fija el servidor en `calc_precios_contratacion`
 * y queda guardado en la fila. Precio final = neto (CEIL) + costo de servicio.
 */
export function computeComisionApp(netAmount: number): number {
  const net = Number(netAmount);
  if (!Number.isFinite(net) || net < 0) return calculateYachangaServiceFee(net);
  return calculateYachangaServiceFee(Math.ceil(net));
}

export function computeFinalAmount(netAmount: number): number {
  const net = Number(netAmount);
  if (!Number.isFinite(net) || net < 0) {
    throw new Error('El monto del trabajo tiene que ser numérico y no negativo');
  }
  const ceiled = Math.ceil(net);
  return ceiled + calculateYachangaServiceFee(ceiled);
}

export async function calcPreciosContratacion(
  precioTrabajador: number,
): Promise<{ precio_final: number; comision_app: number }> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('calc_precios_contratacion', {
    p_precio_trabajador: precioTrabajador,
  });
  if (error || !data?.length) {
    return {
      precio_final: computeFinalAmount(precioTrabajador),
      comision_app: computeComisionApp(precioTrabajador),
    };
  }
  const row = data[0] as { precio_final: unknown; comision_app: unknown };
  return {
    precio_final: toNum(row.precio_final),
    comision_app: toNum(row.comision_app),
  };
}

export async function fetchContratacionesByConversation(
  conversationId: string,
): Promise<Contratacion[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('contrataciones')
    .select(CONTRATACION_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return contratacionRows(data).map(mapContratacionRow);
}

export async function fetchContratacionById(id: string): Promise<Contratacion | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('contrataciones')
    .select(CONTRATACION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return mapContratacionRow(contratacionRow(data));
}

/** Contratación activa (no finalizada, cancelada ni en disputa) del hilo. */
export async function fetchContratacionActivaByConversation(
  conversationId: string,
): Promise<Contratacion | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('contrataciones')
    .select(CONTRATACION_SELECT)
    .eq('conversation_id', conversationId)
    .not('estado_trabajo', 'in', '("finalizado","cancelado","disputa")')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapContratacionRow(contratacionRow(data));
}

/** Última contratación “en curso de servicio” (post aceptación de precio). */
export async function fetchLatestContratacionServicioByConversation(
  conversationId: string,
): Promise<Contratacion | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('contrataciones')
    .select(CONTRATACION_SELECT)
    .eq('conversation_id', conversationId)
    .not('estado_trabajo', 'in', '("precio_cotizado","cancelado")')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapContratacionRow(contratacionRow(data));
}

export async function fetchContratacionesByUser(params: {
  role: 'cliente' | 'trabajador';
  limit?: number;
}): Promise<Contratacion[]> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return [];

  let query = sb
    .from('contrataciones')
    .select(CONTRATACION_SELECT)
    .order('updated_at', { ascending: false })
    .limit(params.limit ?? 60);

  query =
    params.role === 'cliente'
      ? query.eq('client_id', user.id)
      : query.eq('worker_id', user.id);

  const { data, error } = await query;
  if (error || !data) return [];
  return contratacionRows(data).map(mapContratacionRow);
}

export type AgendaClienteInfo = {
  firstName: string;
  direccionTexto: string | null;
  detallesUbicacion: string | null;
};

type JobClientLocationRow = {
  direccion_texto?: string | null;
  detalles_ubicacion?: string | null;
};

function firstLocationRow(data: unknown): JobClientLocationRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  return row as JobClientLocationRow;
}

/**
 * Nombre del cliente desde `profiles` (no es PII revocada).
 * Domicilio solo vía `get_job_client_location`: el RPC lo devuelve si
 * auth.uid() es el trabajador y la seña o el total ya está pago.
 */
export async function fetchAgendaClienteInfoByIds(
  jobs: Array<Pick<Contratacion, 'id' | 'client_id'>>,
): Promise<Record<string, AgendaClienteInfo>> {
  const uniqueClientIds = Array.from(new Set(jobs.map((job) => job.client_id).filter(Boolean)));
  if (!uniqueClientIds.length) return {};

  const sb = getSupabaseClient();
  const map: Record<string, AgendaClienteInfo> = {};
  for (const id of uniqueClientIds) {
    map[id] = { firstName: 'Cliente', direccionTexto: null, detallesUbicacion: null };
  }

  const { data, error } = await sb.from('profiles').select('id,nombre').in('id', uniqueClientIds);
  if (!error && data) {
    for (const row of data as Record<string, unknown>[]) {
      const id = String(row.id);
      const info = map[id];
      if (!info) continue;
      info.firstName = String(row.nombre ?? '').trim() || 'Cliente';
    }
  }

  const seen = new Set<string>();
  let warned = false;
  await Promise.all(
    jobs.map(async (job) => {
      if (!job.id || !job.client_id || seen.has(job.id)) return;
      seen.add(job.id);
      const { data: loc, error: locError } = await sb.rpc('get_job_client_location', {
        p_contratacion_id: job.id,
      });
      if (locError) {
        if (!warned) {
          warned = true;
          console.warn('[get_job_client_location]', locError.message);
        }
        return;
      }
      const row = firstLocationRow(loc);
      if (!row) return;
      const info = map[job.client_id];
      if (!info) return;
      const address = normalizeDisplayAddress(String(row.direccion_texto ?? '')) || null;
      if (address) info.direccionTexto = address;
      const details = String(row.detalles_ubicacion ?? '').trim() || null;
      if (details) info.detallesUbicacion = details;
    }),
  );

  return map;
}

/** Trabajos agendados desde una fecha (hoy o futuro), con seña pagada. */
export async function fetchContratacionesAgendaWorkerProgramadas(
  workerId: string,
  fromDateIso: string,
): Promise<Contratacion[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('contrataciones')
    .select(CONTRATACION_SELECT)
    .eq('worker_id', workerId)
    .gte('fecha_trabajo', fromDateIso)
    .in('estado_trabajo', ['aceptado', 'en_curso'])
    .neq('estado_pago', 'pendiente_seña')
    .order('fecha_trabajo', { ascending: true })
    .order('hora_inicio', { ascending: true });
  if (error || !data) return [];
  return contratacionRows(data).map(mapContratacionRow);
}

/** @deprecated Usar fetchContratacionesAgendaWorkerProgramadas */
export async function fetchContratacionesAgendaWorker(
  workerId: string,
  dateIso: string,
): Promise<Contratacion[]> {
  const rows = await fetchContratacionesAgendaWorkerProgramadas(workerId, dateIso);
  return rows.filter((c) => c.fecha_trabajo === dateIso);
}

export function subscribeContratacionById(
  contratacionId: string,
  onUpsert: (row: Contratacion) => void,
): () => void {
  const sb = getSupabaseClient();
  const channelName = `contratacion:${contratacionId}`;
  removeSupabaseRealtimeTopic(sb, channelName);
  const channel = sb
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'contrataciones',
        filter: `id=eq.${contratacionId}`,
      },
      (payload) => {
        try {
          const row = (payload?.new ?? payload?.old) as Record<string, unknown> | null;
          if (!row?.id) return;
          onUpsert(mapContratacionRow(row));
        } catch (e) {
          console.warn('[realtime contratacion]', e);
        }
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

export function subscribeContratacionesByConversation(
  conversationId: string,
  onUpsert: (row: Contratacion) => void,
): () => void {
  const sb = getSupabaseClient();
  const channelName = `contrataciones:${conversationId}`;
  removeSupabaseRealtimeTopic(sb, channelName);
  const channel = sb
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'contrataciones',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        try {
          const row = (payload?.new ?? payload?.old) as Record<string, unknown> | null;
          if (!row?.id) return;
          onUpsert(mapContratacionRow(row));
        } catch (e) {
          console.warn('[realtime contrataciones]', e);
        }
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

/** Realtime de todas las contrataciones del trabajador (p. ej. agenda al pagar seña). */
export function subscribeContratacionesByWorker(
  workerId: string,
  onUpsert: (row: Contratacion) => void,
): () => void {
  const sb = getSupabaseClient();
  const channelName = `contrataciones-worker:${workerId}`;
  removeSupabaseRealtimeTopic(sb, channelName);
  const channel = sb
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'contrataciones',
        filter: `worker_id=eq.${workerId}`,
      },
      (payload) => {
        try {
          const row = (payload?.new ?? payload?.old) as Record<string, unknown> | null;
          if (!row?.id) return;
          onUpsert(mapContratacionRow(row));
        } catch (e) {
          console.warn('[realtime contrataciones worker]', e);
        }
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

export async function crearCotizacion(params: {
  conversationId: string;
  precioTrabajador: number;
  serviceDetail?: string;
  /** null = sin garantía. Si viene un número, tiene que estar entre 1 y 60. */
  warrantyDays?: number | null;
}): Promise<string> {
  const sb = getSupabaseClient();
  const detail = (params.serviceDetail ?? '').trim();
  if (!detail) throw new Error('El detalle del servicio es obligatorio.');
  const warrantyDays = assertWarrantyDays(params.warrantyDays);
  const { data, error } = await sb.rpc('crear_cotizacion', {
    p_conversation_id: params.conversationId,
    p_precio_trabajador: params.precioTrabajador,
    p_service_detail: detail,
    p_warranty_days: warrantyDays,
  });
  if (error) throw error;
  return String(data);
}

export async function aceptarPrecioCotizado(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('aceptar_precio_cotizado', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
}

export async function rechazarPrecioCotizado(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('rechazar_precio_cotizado', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
}

function mapDisponibilidadOpcion(r: Record<string, unknown>): DisponibilidadOpcion {
  return {
    id: String(r.id),
    contratacion_id: String(r.contratacion_id),
    lote: toNum(r.lote),
    fecha_trabajo: String(r.fecha_trabajo),
    hora_inicio: String(r.hora_inicio),
    hora_fin: String(r.hora_fin),
    estado: (r.estado as DisponibilidadOpcionEstado) ?? 'propuesta',
    created_at: String(r.created_at),
  };
}


function sortDisponibilidadChronological(rows: DisponibilidadOpcion[]): DisponibilidadOpcion[] {
  return [...rows].sort((a, b) => {
    const da = String(a.fecha_trabajo ?? '');
    const db = String(b.fecha_trabajo ?? '');
    if (da !== db) return da.localeCompare(db);
    const ha = String(a.hora_inicio ?? '').slice(0, 5);
    const hb = String(b.hora_inicio ?? '').slice(0, 5);
    if (ha !== hb) return ha.localeCompare(hb);
    return String(a.hora_fin ?? '').slice(0, 5).localeCompare(String(b.hora_fin ?? '').slice(0, 5));
  });
}

export async function fetchDisponibilidadOpciones(
  contratacionId: string,
  soloPropuestas = true,
): Promise<DisponibilidadOpcion[]> {
  const sb = getSupabaseClient();
  let query = sb
    .from('disponibilidad_opciones')
    .select('*')
    .eq('contratacion_id', contratacionId)
    .order('created_at', { ascending: true });
  if (soloPropuestas) query = query.eq('estado', 'propuesta');
  const { data, error } = await query;
  if (error || !data) return [];
  return sortDisponibilidadChronological((data as Record<string, unknown>[]).map(mapDisponibilidadOpcion));
}

export type DisponibilidadSlotInput = {
  fechaTrabajo: string;
  horaInicio: string;
  horaFin: string;
};

export async function proponerDisponibilidadOpciones(
  contratacionId: string,
  opciones: DisponibilidadSlotInput[],
): Promise<void> {
  if (opciones.length < 1 || opciones.length > 5) {
    throw new Error('Debés enviar entre 1 y 5 opciones de horario');
  }
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('proponer_disponibilidad_opciones', {
    p_contratacion_id: contratacionId,
    p_opciones: opciones.map((o) => ({
      fecha: o.fechaTrabajo,
      hora_inicio: o.horaInicio,
      hora_fin: o.horaFin,
    })),
  });
  if (error) throwContratacionRpcError(error, 'No se pudieron enviar las opciones de horario');
}

export async function proponerDisponibilidad(params: {
  contratacionId: string;
  fechaTrabajo: string;
  horaInicio: string;
  horaFin: string;
}): Promise<void> {
  await proponerDisponibilidadOpciones(params.contratacionId, [
    {
      fechaTrabajo: params.fechaTrabajo,
      horaInicio: params.horaInicio,
      horaFin: params.horaFin,
    },
  ]);
}

export async function aceptarDisponibilidadOpcion(opcionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('aceptar_disponibilidad_opcion', {
    p_opcion_id: opcionId,
  });
  if (error) throw error;
}

export async function aceptarDisponibilidad(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('aceptar_disponibilidad', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
}

export async function rechazarDisponibilidad(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('rechazar_disponibilidad', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
}

export async function aplicarSeñaConCredito(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('aplicar_seña_con_credito', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
}

export async function obtenerPinCliente(contratacionId: string): Promise<string> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('obtener_pin_cliente', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
  return String(data);
}

export async function verificarPin(contratacionId: string, pin: string): Promise<boolean> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('verificar_pin', {
    p_contratacion_id: contratacionId,
    p_pin_ingresado: pin,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function obtenerDireccionCliente(contratacionId: string): Promise<{
  direccion_texto: string;
  detalles_ubicacion: string | null;
  lat: number;
  lng: number;
}> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('obtener_direccion_cliente', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    direccion_texto: string;
    detalles_ubicacion?: string | null;
    lat: number;
    lng: number;
  };
  return {
    ...row,
    direccion_texto: normalizeDisplayAddress(row.direccion_texto),
    detalles_ubicacion: row.detalles_ubicacion?.trim() || null,
  };
}

export async function recotizarEnCurso(
  contratacionId: string,
  nuevoPrecioTrabajador: number,
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('recotizar_en_curso', {
    p_contratacion_id: contratacionId,
    p_nuevo_precio_trabajador: nuevoPrecioTrabajador,
  });
  if (error) throw error;
}

export async function aceptarRecotizacion(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('aceptar_recotizacion', { p_contratacion_id: contratacionId });
  if (error) throw error;
}

export async function rechazarRecotizacion(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('rechazar_recotizacion', { p_contratacion_id: contratacionId });
  if (error) throw error;
}

export async function trabajadorFinalizarTrabajo(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('trabajador_finalizar_trabajo', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
}

export async function clienteResponderConformidad(params: {
  contratacionId: string;
  conforme: boolean;
  motivoDisputa?: string;
}): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('cliente_responder_conformidad', {
    p_contratacion_id: params.contratacionId,
    p_conforme: params.conforme,
    p_motivo_disputa: params.motivoDisputa ?? '',
  });
  if (error) throw error;
}

export async function clienteNotificarPagoOffline(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('cliente_notificar_pago_offline', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
}

/**
 * Abre el reclamo de garantía del cliente y devuelve el chat para coordinarlo.
 * No cambia el estado del trabajo ni el ancla de la garantía.
 */
export async function iniciarReclamoGarantia(contratacionId: string): Promise<string> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('iniciar_reclamo_garantia', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;
  const conversationId = String(data ?? '').trim();
  if (!conversationId) throw new Error('No se pudo abrir el chat del reclamo.');
  return conversationId;
}

export async function trabajadorConfirmarRecepcionOffline(contratacionId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('trabajador_confirmar_recepcion_offline', {
    p_contratacion_id: contratacionId,
  });
  if (error) throw error;

  // Si ya hay reseña → ocultar chat + purgar imágenes (retención 0 hoy)
  const { requestChatCleanupAfterJobComplete } = await import('./chatCleanupSupabase');
  void requestChatCleanupAfterJobComplete(contratacionId);
}
