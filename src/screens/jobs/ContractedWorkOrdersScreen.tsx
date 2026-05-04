import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { getSupabaseClient } from '../../lib/supabase';
import { formatPostDate } from '../../utils/formatDate';

type QuoteRow = {
  conversation_id: string;
  worker_id: string;
  client_id: string;
  id: string;
  amount: number;
  description: string;
  work_status: 'PENDING' | 'COMPLETED_BY_WORKER';
  payment_status: 'PENDING' | 'PAID';
  paid_at: string | null;
  completed_by_worker_at: string | null;
  updated_at: string;
  created_at: string;
};

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function statusBadge(q: QuoteRow): { label: string; tone: 'pending' | 'paid' | 'done' } {
  const done = q.work_status === 'COMPLETED_BY_WORKER';
  const paid = q.payment_status === 'PAID';
  if (done && paid) return { label: 'Finalizado · Pagado', tone: 'done' };
  if (done && !paid) return { label: 'Finalizado · Pendiente de pago', tone: 'done' };
  if (!done && paid) return { label: 'Pagado', tone: 'paid' };
  return { label: 'Pendiente', tone: 'pending' };
}

function formatWorkerLabel(full: string): string {
  const s = (full ?? '').trim();
  if (!s) return 'Profesional';
  const parts = s.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? 'Profesional';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const initial = last ? `${last[0]?.toUpperCase() ?? ''}.` : '';
  return initial ? `${first} ${initial}` : first;
}

export function ContractedWorkOrdersScreen() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [workerNameById, setWorkerNameById] = useState<Record<string, string>>({});

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const fmtMoney = (n: number) => `$${currency.format(Math.round((Number(n) || 0) * 100) / 100)}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        if (!isSupabaseConfigured()) {
          if (!cancelled) setRows([]);
          return;
        }
        const sb = getSupabaseClient();
        const {
          data: { user },
        } = await sb.auth.getUser();
        if (!user?.id) {
          if (!cancelled) setRows([]);
          return;
        }
        const { data, error } = await sb
          .from('service_jobs')
          .select(
            'id,conversation_id,worker_id,client_id,amount,description,work_status,payment_status,paid_at,completed_by_worker_at,updated_at,created_at',
          )
          // Solo trabajos donde el usuario actuó como cliente/contratante
          .eq('client_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(60);
        if (error) throw error;
        const mapped = (data ?? []).map((r: any) => ({
          id: r.id,
          conversation_id: r.conversation_id,
          worker_id: r.worker_id,
          client_id: r.client_id,
          amount: toNum(r.amount),
          description: String(r.description ?? ''),
          work_status: (r.work_status as QuoteRow['work_status']) ?? 'PENDING',
          payment_status: (r.payment_status as QuoteRow['payment_status']) ?? 'PENDING',
          paid_at: r.paid_at ?? null,
          completed_by_worker_at: r.completed_by_worker_at ?? null,
          updated_at: String(r.updated_at ?? r.created_at),
          created_at: String(r.created_at),
        }));
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
    const ids = Array.from(new Set(rows.map((r) => r.worker_id).filter(Boolean)));
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const sb = getSupabaseClient();
        const { data, error } = await sb.from('profiles').select('id,nombre,apellido').in('id', ids);
        if (error) return;
        const map: Record<string, string> = {};
        for (const p of (data ?? []) as any[]) {
          const full = `${String(p.nombre ?? '').trim()} ${String(p.apellido ?? '').trim()}`.trim();
          map[String(p.id)] = full || 'Profesional';
        }
        if (!cancelled) setWorkerNameById(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>Servicios que contrataste a otros profesionales.</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Todavía no contrataste trabajos</Text>
            <Text style={styles.emptyText}>Cuando aceptes una cotización, van a aparecer acá.</Text>
          </View>
        ) : (
          rows.map((q) => {
            const badge = statusBadge(q);
            const workerName = formatWorkerLabel(workerNameById[q.worker_id] ?? '');
            return (
              <View key={q.id} style={styles.card}>
                <View
                  style={[
                    styles.badge,
                    badge.tone === 'paid' && styles.badgePaid,
                    badge.tone === 'done' && styles.badgeDone,
                  ]}
                >
                  <Text style={styles.badgeText}>{badge.label}</Text>
                </View>
                <Text style={styles.workerName} numberOfLines={1}>
                  Profesional: <Text style={styles.workerNameStrong}>{workerName}</Text>
                </Text>
                <Text style={styles.amount}>{fmtMoney(q.amount)}</Text>
                <Text style={styles.detail} numberOfLines={3}>
                  {q.description?.trim() || 'Sin detalle del servicio.'}
                </Text>
                <Text style={styles.date}>{formatPostDate(q.created_at)}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl * 2 },
  lead: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
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
  badge: {
    alignSelf: 'flex-start',
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
  workerName: { marginTop: spacing.sm, fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
  workerNameStrong: { color: colors.text, fontWeight: '900' },
  amount: { marginTop: spacing.sm, fontSize: 20, fontWeight: '900', color: colors.text },
  detail: { marginTop: spacing.sm, ...typography.body, color: colors.textSecondary },
  date: { marginTop: spacing.sm, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});

