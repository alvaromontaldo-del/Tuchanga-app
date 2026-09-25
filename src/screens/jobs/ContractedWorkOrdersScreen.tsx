import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpandableText } from '../../components/common/ExpandableText';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { getSupabaseClient } from '../../lib/supabase';
import { formatPostDate } from '../../utils/formatDate';

import { fetchContratacionesByUser } from '../../services/contratacionesSupabase';
import type { Contratacion, ContratacionEstadoPago, ContratacionEstadoTrabajo } from '../../types/contrataciones';
import {
  contractedWarrantyDurationLabel,
  contractedWorkMoneyDisplay,
  workerGivenName,
} from '../../utils/contractedWorkDisplay';
import { warrantyAnchorIso, warrantyCountdown } from '../../utils/warrantyDays';

type OrderRow = {
  conversation_id: string;
  worker_id: string;
  client_id: string;
  id: string;
  professionalLabel: string;
  professionalAmount: string;
  serviceFeeLabel: string;
  serviceFeeAmount: string;
  description: string;
  estado_trabajo: ContratacionEstadoTrabajo;
  estado_pago: ContratacionEstadoPago;
  updated_at: string;
  created_at: string;
  warranty_days: number | null;
  warranty_anchor_at: string | null;
  finalizado_at: string | null;
  completed_by_worker_at: string | null;
};

function statusBadge(row: OrderRow): { label: string; tone: 'pending' | 'paid' | 'done' } {
  const done = row.estado_trabajo === 'finalizado';
  const paid = row.estado_pago === 'totalmente_pagado' || row.estado_pago === 'seña_pagada';
  if (done && row.estado_pago === 'totalmente_pagado') {
    return { label: 'Finalizado · Pagado', tone: 'done' };
  }
  if (done) return { label: 'Finalizado', tone: 'done' };
  if (paid) return { label: 'Costo de servicio pagado', tone: 'paid' };
  if (row.estado_trabajo === 'cancelado') return { label: 'Cancelado', tone: 'pending' };
  return { label: 'En curso', tone: 'pending' };
}

function mapContratacion(c: Contratacion): OrderRow {
  const money = contractedWorkMoneyDisplay(c);
  return {
    id: c.id,
    conversation_id: c.conversation_id,
    worker_id: c.worker_id,
    client_id: c.client_id,
    professionalLabel: money.professionalLabel,
    professionalAmount: money.professionalAmount,
    serviceFeeLabel: money.serviceFeeLabel,
    serviceFeeAmount: money.serviceFeeAmount,
    description: c.service_detail,
    estado_trabajo: c.estado_trabajo,
    estado_pago: c.estado_pago,
    updated_at: c.updated_at,
    created_at: c.created_at,
    warranty_days: c.warranty_days,
    warranty_anchor_at: c.warranty_anchor_at,
    finalizado_at: c.finalizado_at,
    completed_by_worker_at: c.completed_by_worker_at,
  };
}

export function ContractedWorkOrdersScreen() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [workerNameById, setWorkerNameById] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        if (!isSupabaseConfigured()) {
          if (!cancelled) setRows([]);
          return;
        }
        const data = await fetchContratacionesByUser({ role: 'cliente', limit: 60 });
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
    const ids = Array.from(new Set(rows.map((r) => r.worker_id).filter(Boolean)));
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const sb = getSupabaseClient();
        const { data, error } = await sb.from('profiles').select('id,nombre').in('id', ids);
        if (error) return;
        const map: Record<string, string> = {};
        for (const p of (data ?? []) as { id: string; nombre?: string | null }[]) {
          map[String(p.id)] = workerGivenName(p.nombre);
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
            const workerName = workerNameById[q.worker_id] ?? 'Profesional';
            const warranty = warrantyCountdown({
              warrantyDays: q.warranty_days,
              anchorAt: warrantyAnchorIso({
                estadoTrabajo: q.estado_trabajo,
                warrantyAnchorAt: q.warranty_anchor_at,
                finalizadoAt: q.finalizado_at,
                completedByWorkerAt: q.completed_by_worker_at,
              }),
              now,
            });
            const warrantyLabel = contractedWarrantyDurationLabel(warranty);
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
                <Text style={styles.amountCaption}>{q.professionalLabel}</Text>
                <Text style={styles.amount}>{q.professionalAmount}</Text>
                <Text style={styles.feeLine}>
                  {q.serviceFeeLabel}: {q.serviceFeeAmount}
                </Text>
                <ExpandableText
                  text={q.description?.trim() || 'Sin detalle del servicio.'}
                  numberOfLinesCollapsed={3}
                  textStyle={styles.detail}
                />
                {warrantyLabel ? (
                  <Text
                    style={[styles.warranty, warranty.status === 'expired' && styles.warrantyExpired]}
                  >
                    Garantía: {warrantyLabel}
                  </Text>
                ) : null}
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
  amountCaption: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  amount: { marginTop: 2, fontSize: 20, fontWeight: '900', color: colors.text },
  feeLine: { marginTop: spacing.xs, fontSize: 14, fontWeight: '800', color: colors.text },
  detail: { marginTop: spacing.sm, ...typography.body, color: colors.textSecondary },
  warranty: { marginTop: spacing.sm, fontSize: 14, fontWeight: '800', color: colors.text },
  warrantyExpired: { color: colors.textSecondary },
  date: { marginTop: spacing.sm, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});

