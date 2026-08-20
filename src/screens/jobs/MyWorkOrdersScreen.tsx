import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StarRating } from '../../components/profile/StarRating';
import { ExpandableText } from '../../components/common/ExpandableText';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { getSupabaseClient } from '../../lib/supabase';
import { formatPostDate } from '../../utils/formatDate';
import { formatContratacionEstado, formatContratacionEstadoPago } from '../../utils/contratacionStatus';
import { fetchContratacionesByUser } from '../../services/contratacionesSupabase';
import type { Contratacion, ContratacionEstadoPago, ContratacionEstadoTrabajo } from '../../types/contrataciones';

type OrderRow = {
  conversation_id: string;
  worker_id: string;
  client_id: string;
  id: string;
  /** Neto del profesional (sin seña/comisión YaChanga). */
  earned: number;
  precio_final: number;
  comision_app: number;
  description: string;
  estado_trabajo: ContratacionEstadoTrabajo;
  estado_pago: ContratacionEstadoPago;
  updated_at: string;
  created_at: string;
};

type FilterId = 'all' | '7d' | '30d' | 'custom';

type BadgeTone = 'pending' | 'paid' | 'done';

const FILTERS: Array<{ id: Exclude<FilterId, 'all'>; label: string }> = [
  { id: '7d', label: 'Últimos 7 días' },
  { id: '30d', label: 'Últimos 30 días' },
  { id: 'custom', label: 'Seleccionar fecha' },
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function daysAgoStart(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return startOfDay(d);
}

function formatDateShort(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function workBadgeTone(estado: ContratacionEstadoTrabajo): BadgeTone {
  if (estado === 'finalizado') return 'done';
  if (estado === 'en_curso' || estado === 'aceptado') return 'paid';
  return 'pending';
}

function paymentBadgeTone(estado: ContratacionEstadoPago): BadgeTone {
  if (estado === 'totalmente_pagado') return 'done';
  if (estado === 'seña_pagada') return 'paid';
  return 'pending';
}

function badgeStyle(tone: BadgeTone) {
  if (tone === 'paid') return styles.badgePaid;
  if (tone === 'done') return styles.badgeDone;
  return null;
}

function mapContratacion(c: Contratacion): OrderRow {
  const earned =
    Number.isFinite(c.precio_trabajador) && c.precio_trabajador > 0
      ? c.precio_trabajador
      : Math.max(0, (Number(c.precio_final) || 0) - (Number(c.comision_app) || 0));
  return {
    id: c.id,
    conversation_id: c.conversation_id,
    worker_id: c.worker_id,
    client_id: c.client_id,
    earned,
    precio_final: c.precio_final,
    comision_app: c.comision_app,
    description: c.service_detail,
    estado_trabajo: c.estado_trabajo,
    estado_pago: c.estado_pago,
    updated_at: c.updated_at,
    created_at: c.created_at,
  };
}

function rowDate(row: OrderRow): Date {
  const raw = row.updated_at || row.created_at;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : new Date(0);
}

function matchesDateRange(row: OrderRow, from: Date, to: Date): boolean {
  const t = rowDate(row).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

/** Solo trabajos efectivamente cobrados cuentan para “Total ganado”. */
function countsTowardEarnings(row: OrderRow): boolean {
  return (
    row.estado_trabajo === 'finalizado' ||
    row.estado_pago === 'totalmente_pagado' ||
    row.estado_pago === 'seña_pagada'
  );
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clientFirstName(full: string): string {
  const s = (full ?? '').trim();
  if (!s) return 'Cliente';
  return s.split(/\s+/)[0] ?? 'Cliente';
}

export function MyWorkOrdersScreen() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [filter, setFilter] = useState<FilterId>('all');
  const [customFrom, setCustomFrom] = useState<Date>(() => daysAgoStart(7));
  const [customTo, setCustomTo] = useState<Date>(() => endOfDay(new Date()));
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [showRangePanel, setShowRangePanel] = useState(false);
  const [clientNameById, setClientNameById] = useState<Record<string, string>>({});
  const [reviewByJobId, setReviewByJobId] = useState<Record<string, { rating: number; comment: string }>>(
    {},
  );

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const fmtMoney = (n: number) => `$${currency.format(Math.round((Number(n) || 0) * 100) / 100)}`;

  const dateRange = useMemo(() => {
    if (filter === 'all') return null;
    if (filter === '7d') {
      return { from: daysAgoStart(7), to: endOfDay(new Date()) };
    }
    if (filter === '30d') {
      return { from: daysAgoStart(30), to: endOfDay(new Date()) };
    }
    let from = startOfDay(customFrom);
    let to = endOfDay(customTo);
    if (from.getTime() > to.getTime()) {
      const tmp = from;
      from = startOfDay(customTo);
      to = endOfDay(customFrom);
    }
    return { from, to };
  }, [filter, customFrom, customTo]);

  const filteredRows = useMemo(() => {
    if (!dateRange) return rows;
    return rows.filter((r) => matchesDateRange(r, dateRange.from, dateRange.to));
  }, [rows, dateRange]);

  const totalGanado = useMemo(() => {
    return filteredRows
      .filter(countsTowardEarnings)
      .reduce((acc, r) => acc + (Number(r.earned) || 0), 0);
  }, [filteredRows]);

  /** Total de todos los tiempos (sin filtro de fecha). */
  const totalAcumulado = useMemo(() => {
    return rows
      .filter(countsTowardEarnings)
      .reduce((acc, r) => acc + (Number(r.earned) || 0), 0);
  }, [rows]);

  /** Por defecto mostramos acumulado; con filtro activo, el del período. */
  const displayedTotal = filter === 'all' ? totalAcumulado : totalGanado;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        if (!isSupabaseConfigured()) {
          if (!cancelled) setRows([]);
          return;
        }
        const data = await fetchContratacionesByUser({ role: 'trabajador', limit: 200 });
        const mapped = data.map(mapContratacion);
        if (!cancelled) setRows(mapped);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const ids = Array.from(new Set(rows.map((r) => r.client_id).filter(Boolean)));
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const sb = getSupabaseClient();
        const { data, error } = await sb.from('profiles').select('id,nombre').in('id', ids);
        if (error) return;
        const map: Record<string, string> = {};
        for (const p of (data ?? []) as { id: string; nombre?: string | null }[]) {
          map[String(p.id)] = String(p.nombre ?? '').trim() || 'Cliente';
        }
        if (!cancelled) setClientNameById(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const jobIds = Array.from(new Set(rows.map((r) => r.id).filter(Boolean)));
    if (!jobIds.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const sb = getSupabaseClient();
        const { data, error } = await sb
          .from('worker_reviews')
          .select('job_id,rating,comment')
          .in('job_id', jobIds);
        if (error) return;
        const map: Record<string, { rating: number; comment: string }> = {};
        for (const r of (data ?? []) as { job_id?: string; rating?: number; comment?: string }[]) {
          const jid = String(r.job_id ?? '');
          if (!jid) continue;
          map[jid] = { rating: toNum(r.rating), comment: String(r.comment ?? '') };
        }
        if (!cancelled) setReviewByJobId(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  function onSelectFilter(id: Exclude<FilterId, 'all'>) {
    // Si tocás el mismo filtro activo, volvés al total acumulado (sin período).
    if (filter === id) {
      setFilter('all');
      setShowRangePanel(false);
      setPicking(null);
      return;
    }
    setFilter(id);
    if (id === 'custom') {
      setShowRangePanel(true);
    } else {
      setShowRangePanel(false);
      setPicking(null);
    }
  }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    const which = picking;
    if (Platform.OS === 'android') {
      // Cerrar primero: si no, Android vuelve a abrir el diálogo.
      setPicking(null);
      if (event.type === 'dismissed' || !selected || !which) return;
      if (which === 'from') setCustomFrom(startOfDay(selected));
      else setCustomTo(endOfDay(selected));
      return;
    }
    // iOS: el spinner dispara onChange al girar; no cerramos acá.
    if (!selected || !which) return;
    if (which === 'from') setCustomFrom(startOfDay(selected));
    else setCustomTo(endOfDay(selected));
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Tus trabajos contratados/realizados (basado en cotizaciones del chat).
        </Text>

        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => onSelectFilter(f.id)}
                style={({ pressed }) => [
                  styles.filterChip,
                  active && styles.filterChipActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.filterChipText, active && styles.filterChipTextActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filter === 'custom' && showRangePanel ? (
          <View style={styles.rangePanel}>
            <View style={styles.rangeRow}>
              <Pressable
                onPress={() => setPicking('from')}
                style={({ pressed }) => [styles.rangeBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Elegir fecha desde"
              >
                <Text style={styles.rangeBtnLabel}>Desde</Text>
                <Text style={styles.rangeBtnValue}>{formatDateShort(customFrom)}</Text>
              </Pressable>
              <Pressable
                onPress={() => setPicking('to')}
                style={({ pressed }) => [styles.rangeBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Elegir fecha hasta"
              >
                <Text style={styles.rangeBtnLabel}>Hasta</Text>
                <Text style={styles.rangeBtnValue}>{formatDateShort(customTo)}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {filter === 'custom' && !showRangePanel ? (
          <Pressable
            onPress={() => setShowRangePanel(true)}
            style={({ pressed }) => [styles.rangeSummary, pressed && styles.pressed]}
          >
            <Text style={styles.rangeHint}>
              {formatDateShort(customFrom)} – {formatDateShort(customTo)} · tocar para cambiar
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.earningsCard}>
          <Text style={styles.earningsLabel}>
            {filter === 'all' ? 'Total ganado con YaChanga' : 'Total en el período'}
          </Text>
          <Text style={styles.earningsValue}>{fmtMoney(displayedTotal)}</Text>
          <Text style={styles.earningsHint}>
            {filter === 'all'
              ? 'Neto acumulado del profesional (sin el costo de servicio de YaChanga).'
              : 'Neto del profesional en el período elegido (sin el costo de servicio de YaChanga).'}
          </Text>
          {filter !== 'all' ? (
            <Text style={styles.earningsAccumulated}>
              Acumulado total: {fmtMoney(totalAcumulado)}
            </Text>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : filteredRows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {rows.length === 0 ? 'Todavía no tenés trabajos' : 'Sin trabajos en este período'}
            </Text>
            <Text style={styles.emptyText}>
              {rows.length === 0
                ? 'Cuando cotices y el cliente acepte/pague, van a aparecer acá.'
                : 'Probá con otro rango de fechas.'}
            </Text>
          </View>
        ) : (
          filteredRows.map((q) => {
            const workTone = workBadgeTone(q.estado_trabajo);
            const payTone = paymentBadgeTone(q.estado_pago);
            const clientName = clientFirstName(clientNameById[q.client_id] ?? '');
            const review = reviewByJobId[q.id];
            return (
              <View key={q.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, badgeStyle(workTone)]}>
                      <Text style={styles.badgeText}>{formatContratacionEstado(q.estado_trabajo)}</Text>
                    </View>
                    <View style={[styles.badge, badgeStyle(payTone)]}>
                      <Text style={styles.badgeText}>{formatContratacionEstadoPago(q.estado_pago)}</Text>
                    </View>
                  </View>
                  <Text style={styles.date}>{formatPostDate(q.created_at)}</Text>
                </View>
                <Text style={styles.clientName} numberOfLines={1}>
                  Cliente: <Text style={styles.clientNameStrong}>{clientName}</Text>
                </Text>
                <Text style={styles.amount}>{fmtMoney(q.earned)}</Text>
                <ExpandableText
                  text={q.description?.trim() || 'Sin detalle del servicio.'}
                  numberOfLinesCollapsed={3}
                  textStyle={styles.detail}
                />
                {review ? (
                  <View style={styles.reviewBlock}>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Reseña</Text>
                      <StarRating
                        score={review.rating}
                        showCount={false}
                        inline
                        size={14}
                        textSize={13}
                      />
                    </View>
                    {review.comment?.trim() ? (
                      <ExpandableText
                        key={`${q.id}-review`}
                        text={review.comment.trim()}
                        textStyle={styles.reviewCommentText}
                        style={styles.reviewCommentWrap}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {picking && Platform.OS === 'android' ? (
        <DateTimePicker
          value={picking === 'from' ? customFrom : customTo}
          mode="date"
          display="default"
          maximumDate={picking === 'from' ? customTo : new Date()}
          minimumDate={picking === 'to' ? customFrom : undefined}
          onChange={onPickerChange}
        />
      ) : null}

      {picking && Platform.OS === 'ios' ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setPicking(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPicking(null)}>
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>{picking === 'from' ? 'Desde' : 'Hasta'}</Text>
              <DateTimePicker
                value={picking === 'from' ? customFrom : customTo}
                mode="date"
                display="spinner"
                maximumDate={picking === 'from' ? customTo : new Date()}
                minimumDate={picking === 'to' ? customFrom : undefined}
                onChange={onPickerChange}
                style={styles.iosPicker}
              />
              <Pressable
                onPress={() => setPicking(null)}
                style={({ pressed }) => [styles.modalDone, pressed && styles.pressed]}
              >
                <Text style={styles.modalDoneText}>Listo</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl * 2 },
  lead: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    gap: 6,
    marginBottom: spacing.md,
  },
  filterChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: { fontSize: 11, fontWeight: '800', color: colors.text, textAlign: 'center' },
  filterChipTextActive: { color: '#fff' },
  rangePanel: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  rangeRow: { flexDirection: 'row', gap: spacing.sm },
  rangeBtn: {
    flex: 1,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rangeBtnLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  rangeBtnValue: { marginTop: 4, fontSize: 15, fontWeight: '900', color: colors.text },
  rangeHint: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  rangeSummary: { marginBottom: spacing.md },
  earningsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  earningsLabel: { fontSize: 13, fontWeight: '800', color: colors.textSecondary },
  earningsValue: { marginTop: 6, fontSize: 28, fontWeight: '900', color: colors.text },
  earningsHint: { marginTop: 6, fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
  earningsAccumulated: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  center: { paddingVertical: spacing.xxl, alignItems: 'center' },
  empty: { paddingVertical: spacing.xl * 2, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  badgeRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,24,39,0.16)',
  },
  badgePaid: { backgroundColor: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)' },
  badgeDone: { backgroundColor: 'rgba(13,148,136,0.10)', borderColor: 'rgba(13,148,136,0.30)' },
  badgeText: { fontSize: 12, fontWeight: '900', color: colors.text },
  date: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    flexShrink: 0,
  },
  clientName: { marginTop: spacing.sm, fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
  clientNameStrong: { color: colors.text, fontWeight: '900' },
  amount: { marginTop: spacing.sm, fontSize: 20, fontWeight: '900', color: colors.text },
  detail: { marginTop: spacing.sm, ...typography.body, color: colors.textSecondary },
  reviewBlock: { marginTop: spacing.sm },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  reviewLabel: { fontSize: 12, fontWeight: '900', color: colors.textSecondary },
  reviewCommentWrap: {
    marginTop: spacing.xs,
  },
  reviewCommentText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 18,
  },
  pressed: { opacity: 0.88 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalTitle: { fontSize: 16, fontWeight: '900', color: colors.text, marginBottom: spacing.sm },
  iosPicker: { alignSelf: 'stretch' },
  modalDone: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalDoneText: { color: '#fff', fontWeight: '900', fontSize: 15 },
});
