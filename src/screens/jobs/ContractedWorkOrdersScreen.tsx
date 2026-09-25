import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpandableText } from '../../components/common/ExpandableText';
import { useAppToast } from '../../components/toast/toast';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { getSupabaseClient } from '../../lib/supabase';
import { formatPostDate } from '../../utils/formatDate';

import { fetchContratacionesByUser, iniciarReclamoGarantia } from '../../services/contratacionesSupabase';
import type { AccountStackScreenProps } from '../../navigation/accountTypes';
import type { Contratacion, ContratacionEstadoPago, ContratacionEstadoTrabajo } from '../../types/contrataciones';
import {
  contractedWarrantyDurationLabel,
  contractedWorkMoneyDisplay,
  contractedWorkSection,
  warrantyClaimAction,
  warrantyClaimButtonLabel,
  workerGivenName,
  type ContractedWorkSection,
} from '../../utils/contractedWorkDisplay';
import { warrantyAnchorIso, warrantyCountdown } from '../../utils/warrantyDays';

type Props = AccountStackScreenProps<'ContractedWorkOrders'>;

const TABS: { id: ContractedWorkSection; label: string }[] = [
  { id: 'garantia', label: 'Trabajos en garantía' },
  { id: 'historial', label: 'Historial' },
];

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
  is_claim_open: boolean;
  claim_status: string;
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
    is_claim_open: c.is_claim_open,
    claim_status: c.claim_status,
  };
}

function warrantyFor(row: OrderRow, now: Date) {
  return warrantyCountdown({
    warrantyDays: row.warranty_days,
    anchorAt: warrantyAnchorIso({
      estadoTrabajo: row.estado_trabajo,
      warrantyAnchorAt: row.warranty_anchor_at,
      finalizadoAt: row.finalizado_at,
      completedByWorkerAt: row.completed_by_worker_at,
    }),
    now,
  });
}

export function ContractedWorkOrdersScreen({ navigation }: Props) {
  const toast = useAppToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [workerNameById, setWorkerNameById] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => new Date());
  const [section, setSection] = useState<ContractedWorkSection>('garantia');
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);

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

  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) => contractedWorkSection({ estadoTrabajo: row.estado_trabajo, warranty: warrantyFor(row, now) }) === section,
      ),
    [rows, section, now],
  );

  const counts = useMemo(() => {
    const garantia = rows.filter(
      (row) => contractedWorkSection({ estadoTrabajo: row.estado_trabajo, warranty: warrantyFor(row, now) }) === 'garantia',
    ).length;
    return { garantia, historial: rows.length - garantia };
  }, [rows, now]);

  function openClaimChat(row: OrderRow, conversationId: string) {
    const workerName = workerNameById[row.worker_id] ?? 'Profesional';
    navigation.navigate('Mensajes', {
      screen: 'ChatConversation',
      params: {
        conversationId,
        otherDisplayName: workerName,
        headerSubtitle: 'Profesional',
        workerId: row.worker_id,
      },
    });
  }

  async function startClaim(row: OrderRow) {
    setClaimBusyId(row.id);
    try {
      const conversationId = await iniciarReclamoGarantia(row.id);
      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id ? { ...item, is_claim_open: true, claim_status: 'open' } : item,
        ),
      );
      openClaimChat(row, conversationId);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'No se pudo iniciar el reclamo.';
      toast.error(message, 'Reclamo');
    } finally {
      setClaimBusyId(null);
    }
  }

  function onClaimPress(row: OrderRow, action: 'start' | 'resume') {
    if (action === 'resume') {
      void startClaim(row);
      return;
    }
    Alert.alert(
      'Iniciar reclamo',
      'Se abre el chat con el profesional para coordinar la garantía. El plazo en días sigue corriendo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar reclamo', onPress: () => void startClaim(row) },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.tabRow}>
        {TABS.map((tab) => {
          const active = section === tab.id;
          const count = counts[tab.id];
          const label = count > 0 ? `${tab.label} (${count})` : tab.label;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setSection(tab.id)}
              style={({ pressed }) => [styles.tabBtn, active && styles.tabBtnActive, pressed && styles.pressed]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
            >
              <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          {section === 'garantia'
            ? 'Trabajos con garantía vigente o todavía en curso.'
            : 'Trabajos con la garantía vencida, sin garantía o cancelados.'}
        </Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : visibleRows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {rows.length === 0
                ? 'Todavía no contrataste trabajos'
                : section === 'garantia'
                  ? 'No hay trabajos en garantía'
                  : 'El historial está vacío'}
            </Text>
            <Text style={styles.emptyText}>
              {rows.length === 0
                ? 'Cuando aceptes una cotización, van a aparecer acá.'
                : section === 'garantia'
                  ? 'Cuando un trabajo finalizado siga dentro del plazo, lo vas a ver en esta pestaña.'
                  : 'Los trabajos con la garantía vencida van a quedar acá.'}
            </Text>
          </View>
        ) : (
          visibleRows.map((q) => {
            const badge = statusBadge(q);
            const workerName = workerNameById[q.worker_id] ?? 'Profesional';
            const warranty = warrantyFor(q, now);
            const warrantyLabel = contractedWarrantyDurationLabel(warranty);
            const claimAction = warrantyClaimAction({
              estadoTrabajo: q.estado_trabajo,
              warranty,
              isClaimOpen: q.is_claim_open,
              claimStatus: q.claim_status,
            });
            const claimLabel = warrantyClaimButtonLabel(claimAction);
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
                {claimLabel && claimAction !== 'none' ? (
                  <Pressable
                    onPress={() => onClaimPress(q, claimAction)}
                    disabled={claimBusyId === q.id}
                    style={({ pressed }) => [
                      styles.claimBtn,
                      pressed && styles.pressed,
                      claimBusyId === q.id && styles.claimBtnDisabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      claimAction === 'start' ? 'Reclamo para iniciar la garantía' : 'Ver reclamo de garantía'
                    }
                  >
                    {claimBusyId === q.id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.claimBtnText}>{claimLabel}</Text>
                    )}
                  </Pressable>
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
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabBtnText: { fontSize: 12, fontWeight: '800', color: colors.text, textAlign: 'center' },
  tabBtnTextActive: { color: '#fff' },
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
  claimBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  claimBtnDisabled: { opacity: 0.7 },
  claimBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  date: { marginTop: spacing.sm, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  pressed: { opacity: 0.88 },
});
