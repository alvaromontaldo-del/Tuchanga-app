import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ExpandableText } from '../../components/common/ExpandableText';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useUserMode } from '../../context/UserModeContext';
import { isSupabaseConfigured } from '../../config/supabase';
import {
  fetchAgendaClienteInfoByIds,
  fetchContratacionesAgendaWorkerProgramadas,
  fetchContratacionesByUser,
  subscribeContratacionesByWorker,
  type AgendaClienteInfo,
} from '../../services/contratacionesSupabase';
import type { Contratacion } from '../../types/contrataciones';
import {
  formatAgendaHorario,
  formatContratacionEstado,
  isAgendaDelDia,
  isAgendaFutura,
  isAgendaProgramada,
  isHistorialContratacion,
  localDateIso,
} from '../../utils/contratacionStatus';
import { formatPostDate } from '../../utils/formatDate';
import type { AgendaStackScreenProps } from '../../navigation/mainTypes';

type Props = AgendaStackScreenProps<'Agenda'>;

type AgendaCardSection = 'hoy' | 'proximos' | 'historial';

function AgendaCard({
  item,
  section,
  clienteInfo,
  onPress,
}: {
  item: Contratacion;
  section: AgendaCardSection;
  clienteInfo?: AgendaClienteInfo;
  onPress: () => void;
}) {
  const currency = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const showEstado = section === 'historial';
  const showUbicacion = section !== 'historial' && Boolean(clienteInfo?.direccionTexto);
  const horario = formatAgendaHorario(item, { includeDate: section !== 'hoy' });
  const detail = item.service_detail?.trim() || null;
  const ubicacionLine = [
    clienteInfo?.direccionTexto,
    clienteInfo?.detallesUbicacion ? `Ref.: ${clienteInfo.detallesUbicacion}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderMain}>
          <Text style={styles.cardCliente} numberOfLines={1}>
            {clienteInfo?.firstName ?? 'Cliente'}
          </Text>
          {showEstado ? (
            <View style={styles.estadoPill}>
              <Text style={styles.estadoPillText}>{formatContratacionEstado(item.estado_trabajo)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardMonto}>${currency.format(item.precio_final)}</Text>
      </View>

      <View style={styles.cardMeta}>
        <View style={styles.cardRow}>
          <View style={styles.iconCircle}>
            <Ionicons name="time-outline" size={16} color={colors.primary} />
          </View>
          <Text style={styles.cardHorario}>{horario}</Text>
        </View>

        {showUbicacion ? (
          <View style={styles.cardRowTop}>
            <View style={styles.iconCircle}>
              <Ionicons name="location-outline" size={16} color={colors.primary} />
            </View>
            <View style={styles.cardRowFlex}>
              <ExpandableText
                text={ubicacionLine}
                numberOfLinesCollapsed={3}
                textStyle={styles.cardUbicacion}
              />
            </View>
          </View>
        ) : null}

        {detail ? (
          <View style={styles.cardRowTop}>
            <View style={styles.iconCircle}>
              <Ionicons name="briefcase-outline" size={16} color={colors.primary} />
            </View>
            <View style={styles.cardRowFlex}>
              <ExpandableText
                text={detail}
                numberOfLinesCollapsed={2}
                textStyle={styles.cardDetail}
              />
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function sortAgendaRows(rows: Contratacion[]): Contratacion[] {
  return [...rows].sort((a, b) => {
    const byDate = String(a.fecha_trabajo ?? '').localeCompare(String(b.fecha_trabajo ?? ''));
    if (byDate !== 0) return byDate;
    return String(a.hora_inicio ?? '').localeCompare(String(b.hora_inicio ?? ''));
  });
}

function applyWorkerContratacionPatch(
  programadas: Contratacion[],
  historial: Contratacion[],
  row: Contratacion,
): { programadas: Contratacion[]; historial: Contratacion[] } {
  if (isAgendaProgramada(row)) {
    const i = programadas.findIndex((x) => x.id === row.id);
    const nextProgramadas =
      i >= 0
        ? programadas.map((x, idx) => (idx === i ? row : x))
        : [...programadas, row];
    return {
      programadas: sortAgendaRows(nextProgramadas),
      historial: historial.filter((x) => x.id !== row.id),
    };
  }

  const nextProgramadas = programadas.filter((x) => x.id !== row.id);

  if (isHistorialContratacion(row)) {
    const i = historial.findIndex((x) => x.id === row.id);
    const nextHistorial =
      i >= 0
        ? historial.map((x, idx) => (idx === i ? row : x))
        : [row, ...historial].slice(0, 15);
    return { programadas: nextProgramadas, historial: nextHistorial };
  }

  return { programadas: nextProgramadas, historial };
}

export function AgendaScreen(_props: Props) {
  const navigation = useNavigation<Props['navigation']>();
  const { user } = useAuth();
  const { isWorker } = useUserMode();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [programadas, setProgramadas] = useState<Contratacion[]>([]);
  const [historial, setHistorial] = useState<Contratacion[]>([]);
  const [clienteInfoById, setClienteInfoById] = useState<Record<string, AgendaClienteInfo>>({});
  const agendaRef = useRef({ programadas, historial });
  agendaRef.current = { programadas, historial };

  const todayIso = useMemo(() => localDateIso(), []);

  const hoy = useMemo(
    () => sortAgendaRows(programadas.filter((c) => isAgendaDelDia(c, todayIso))),
    [programadas, todayIso],
  );

  const futuro = useMemo(
    () => sortAgendaRows(programadas.filter((c) => isAgendaFutura(c, todayIso))),
    [programadas, todayIso],
  );

  const load = useCallback(async () => {
    if (!isSupabaseConfigured() || !user?.id || !isWorker) {
      setProgramadas([]);
      setHistorial([]);
      setClienteInfoById({});
      agendaRef.current = { programadas: [], historial: [] };
      return;
    }
    const [agendaRows, allRows] = await Promise.all([
      fetchContratacionesAgendaWorkerProgramadas(user.id, todayIso),
      fetchContratacionesByUser({ role: 'trabajador', limit: 40 }),
    ]);
    const historialRows = allRows.filter(isHistorialContratacion).slice(0, 15);
    const clientIds = Array.from(
      new Set([...agendaRows, ...historialRows].map((row) => row.client_id)),
    );
    const clienteInfo = await fetchAgendaClienteInfoByIds(clientIds);
    setProgramadas(agendaRows);
    setHistorial(historialRows);
    setClienteInfoById(clienteInfo);
    agendaRef.current = {
      programadas: agendaRows,
      historial: historialRows,
    };
  }, [isWorker, todayIso, user?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !isWorker) return;
      void load();
    }, [isWorker, load, user?.id]),
  );

  useEffect(() => {
    if (!isSupabaseConfigured() || !user?.id || !isWorker) return;

    const unsub = subscribeContratacionesByWorker(user.id, (row) => {
      const patch = applyWorkerContratacionPatch(
        agendaRef.current.programadas,
        agendaRef.current.historial,
        row,
      );
      agendaRef.current = patch;
      setProgramadas(patch.programadas);
      setHistorial(patch.historial);
    });

    return unsub;
  }, [isWorker, user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const openDetalle = (contratacionId: string, conversationId: string) => {
    navigation.navigate('DetalleServicio', { contratacionId, conversationId });
  };

  if (!isWorker) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Agenda para profesionales</Text>
          <Text style={styles.emptyText}>Activá tu perfil profesional para ver tus trabajos agendados.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        <Text style={styles.title}>Agenda</Text>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <>
            <Text style={styles.subtitle}>Hoy · {formatPostDate(`${todayIso}T12:00:00`)}</Text>
            {hoy.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Text style={styles.emptyText}>No tenés trabajos agendados para hoy.</Text>
              </View>
            ) : (
              hoy.map((item) => (
                <AgendaCard
                  key={item.id}
                  item={item}
                  section="hoy"
                  clienteInfo={clienteInfoById[item.client_id]}
                  onPress={() => openDetalle(item.id, item.conversation_id)}
                />
              ))
            )}

            <Text style={[styles.subtitle, styles.sectionTitle]}>Próximos</Text>
            {futuro.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Text style={styles.emptyText}>No tenés trabajos agendados a futuro.</Text>
              </View>
            ) : (
              futuro.map((item) => (
                <AgendaCard
                  key={item.id}
                  item={item}
                  section="proximos"
                  clienteInfo={clienteInfoById[item.client_id]}
                  onPress={() => openDetalle(item.id, item.conversation_id)}
                />
              ))
            )}

            <Text style={[styles.subtitle, styles.sectionTitle]}>Historial reciente</Text>
            {historial.length === 0 ? (
              <Text style={styles.emptyText}>Todavía no hay trabajos cerrados.</Text>
            ) : (
              historial.map((item) => (
                <AgendaCard
                  key={item.id}
                  item={item}
                  section="historial"
                  clienteInfo={clienteInfoById[item.client_id]}
                  onPress={() => openDetalle(item.id, item.conversation_id)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { ...typography.title, fontSize: 24, marginBottom: spacing.md },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  sectionTitle: { marginTop: spacing.xl },
  loader: { marginVertical: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyBlock: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  emptyTitle: { ...typography.title, textAlign: 'center', marginBottom: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardHeaderMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  cardCliente: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  cardMonto: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    flexShrink: 0,
  },
  estadoPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEE2E2',
    borderRadius: radii.input,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  estadoPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
  },
  cardMeta: {
    gap: spacing.sm,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardRowFlex: {
    flex: 1,
    minWidth: 0,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardHorario: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.text,
  },
  cardUbicacion: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  cardDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  pressed: { opacity: 0.92 },
});
