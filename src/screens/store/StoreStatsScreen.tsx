import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppScreen } from '../../components/layout/AppScreen';
import { colors, radii, spacing } from '../../constants/theme';
import type { CommerceStackParamList } from '../../navigation/mainTypes';
import { fetchStoreStats, type StoreStats } from '../../services/storeStats';
import { formatArs } from '../../utils/formatMoney';
import {
  storeStatsRange,
  validateCustomRange,
  type CustomRangeIssue,
  type StoreStatsPreset,
} from '../../utils/storeStatsRange';

type Props = NativeStackScreenProps<CommerceStackParamList, 'StoreStats'>;

const FILTERS: Array<{ id: StoreStatsPreset; label: string }> = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'custom', label: 'Rango' },
];

const ISSUE_COPY: Record<CustomRangeIssue, string> = {
  invalid_range: 'La fecha de inicio tiene que ser anterior o igual a la de fin.',
  range_too_long: 'El período no puede superar 366 días.',
  future: 'No podés elegir una fecha futura.',
};

function ymdToLocalNoon(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function localDateToYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatYmdShort(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y || 1970, (m || 1) - 1, (d || 1) + days));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function earlierYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

function formatCloseRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const rounded = Math.round(rate * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(1).replace('.', ',')}%`;
}

function periodCaption(from: string, to: string): string {
  if (from === to) return formatYmdShort(from);
  return `${formatYmdShort(from)} – ${formatYmdShort(to)}`;
}

function SoftSkeleton() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <View style={styles.stack}>
      <Animated.View style={[styles.skelHero, { opacity }]} />
      <View style={styles.metricRow}>
        <Animated.View style={[styles.skelTile, { opacity }]} />
        <Animated.View style={[styles.skelTile, { opacity }]} />
        <Animated.View style={[styles.skelTile, { opacity }]} />
      </View>
    </View>
  );
}

export function StoreStatsScreen(_props: Props) {
  const initial = storeStatsRange('month', new Date());
  const [preset, setPreset] = useState<StoreStatsPreset>('month');
  const [customFrom, setCustomFrom] = useState(initial.from);
  const [customTo, setCustomTo] = useState(initial.to);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [stats, setStats] = useState<StoreStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const now = new Date();
  const todayYmd = storeStatsRange('today', now).from;
  const issue = preset === 'custom' ? validateCustomRange(customFrom, customTo, now) : null;
  const range = issue
    ? null
    : storeStatsRange(
        preset,
        now,
        preset === 'custom' ? { from: customFrom, to: customTo } : undefined,
      );
  const fromKey = range?.from ?? '';
  const toKey = range?.to ?? '';

  useEffect(() => {
    if (!fromKey || !toKey) {
      setLoading(false);
      setStats(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setStats(null);
    void fetchStoreStats(fromKey, toKey)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setStats(null);
          setLoadError(e instanceof Error ? e.message : 'No se pudieron cargar los datos de gestión.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromKey, toKey, retryTick]);

  function selectPreset(next: StoreStatsPreset) {
    setPreset(next);
    if (next !== 'custom') {
      setPicking(null);
      setDraft(null);
    }
  }

  function openPicker(which: 'from' | 'to') {
    setDraft(which === 'from' ? customFrom : customTo);
    setPicking(which);
  }

  function closeIosPicker() {
    if (picking && draft) {
      if (picking === 'from') setCustomFrom(draft);
      else setCustomTo(draft);
    }
    setPicking(null);
    setDraft(null);
  }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'ios') {
      if (selected) setDraft(localDateToYmd(selected));
      return;
    }
    const which = picking;
    setPicking(null);
    setDraft(null);
    if (event.type === 'dismissed' || !selected || !which) return;
    const ymd = localDateToYmd(selected);
    if (which === 'from') setCustomFrom(ymd);
    else setCustomTo(ymd);
  }

  const shownFrom = picking === 'from' && draft ? draft : customFrom;
  const shownTo = picking === 'to' && draft ? draft : customTo;
  const pickerYmd = (picking === 'from' ? draft ?? customFrom : draft ?? customTo) || todayYmd;
  const fromMax = earlierYmd(customTo, todayYmd);
  const toMax = earlierYmd(shiftYmd(customFrom, 366), todayYmd);

  return (
    <AppScreen style={styles.flex} edges={['bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Ventas cerradas y cotizaciones del comercio, en hora de Argentina.
        </Text>

        <View style={styles.filterRow}>
          {FILTERS.map((filter) => {
            const active = preset === filter.id;
            return (
              <Pressable
                key={filter.id}
                onPress={() => selectPreset(filter.id)}
                style={({ pressed }) => [
                  styles.filterChip,
                  active && styles.filterChipActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={filter.label}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {preset === 'custom' ? (
          <View style={styles.rangePanel}>
            <View style={styles.rangeRow}>
              <Pressable
                onPress={() => openPicker('from')}
                style={({ pressed }) => [styles.rangeBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Elegir fecha desde"
              >
                <Text style={styles.rangeBtnLabel}>Desde</Text>
                <Text style={styles.rangeBtnValue}>{formatYmdShort(shownFrom)}</Text>
              </Pressable>
              <Pressable
                onPress={() => openPicker('to')}
                style={({ pressed }) => [styles.rangeBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Elegir fecha hasta"
              >
                <Text style={styles.rangeBtnLabel}>Hasta</Text>
                <Text style={styles.rangeBtnValue}>{formatYmdShort(shownTo)}</Text>
              </Pressable>
            </View>
            {issue ? <Text style={styles.rangeError}>{ISSUE_COPY[issue]}</Text> : null}
          </View>
        ) : null}

        {issue ? null : loading ? (
          <SoftSkeleton />
        ) : loadError ? (
          <View style={styles.stateCard}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
            <Text style={styles.stateTitle}>No pudimos cargar los datos</Text>
            <Text style={styles.stateText}>{loadError}</Text>
            <Pressable
              onPress={() => setRetryTick((n) => n + 1)}
              style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Reintentar"
            >
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : stats && !stats.has_store ? (
          <View style={styles.stateCard}>
            <Ionicons name="storefront-outline" size={28} color={colors.textSecondary} />
            <Text style={styles.stateTitle}>Sin comercio</Text>
            <Text style={styles.stateText}>
              Esta cuenta no tiene un comercio vinculado. Cuando lo registres, vas a ver acá las ventas y las ganancias.
            </Text>
          </View>
        ) : stats ? (
          <View style={styles.stack}>
            <View style={styles.hero}>
              <Text style={styles.heroKicker}>Ganancias</Text>
              <Text
                style={styles.heroValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                accessibilityLabel={`Ganancias ${formatArs(stats.earnings)}`}
              >
                {formatArs(stats.earnings)}
              </Text>
              <Text style={styles.heroHint}>
                {periodCaption(stats.from, stats.to)} · ventas cerradas.
              </Text>
            </View>

            <View style={styles.metricRow}>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Ventas</Text>
                <Text style={styles.metricValue}>{stats.sales_count}</Text>
                <Text style={styles.metricHint}>cerradas</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Ticket promedio</Text>
                <Text
                  style={styles.metricValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {formatArs(stats.avg_ticket)}
                </Text>
                <Text style={styles.metricHint}>por venta</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Cierre</Text>
                <Text style={styles.metricValue}>{formatCloseRate(stats.close_rate)}</Text>
                <Text style={styles.metricHint}>
                  {stats.quotes_closed} de {stats.quotes_sent} cotizaciones
                </Text>
              </View>
            </View>

            {stats.sales_count === 0 ? (
              <View style={styles.stateCard}>
                <Ionicons name="bar-chart-outline" size={26} color={colors.primary} />
                <Text style={styles.stateTitle}>Todavía no hay ventas cerradas en este período</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {picking && Platform.OS !== 'ios' ? (
        <DateTimePicker
          value={ymdToLocalNoon(pickerYmd)}
          mode="date"
          display="default"
          maximumDate={ymdToLocalNoon(picking === 'from' ? fromMax : toMax)}
          minimumDate={
            picking === 'to'
              ? ymdToLocalNoon(customFrom)
              : ymdToLocalNoon(shiftYmd(customTo, -366))
          }
          onChange={onPickerChange}
        />
      ) : null}

      {picking && Platform.OS === 'ios' ? (
        <Modal transparent animationType="fade" visible onRequestClose={closeIosPicker}>
          <Pressable style={styles.modalBackdrop} onPress={closeIosPicker}>
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>{picking === 'from' ? 'Desde' : 'Hasta'}</Text>
              <DateTimePicker
                value={ymdToLocalNoon(pickerYmd)}
                mode="date"
                display="spinner"
                maximumDate={ymdToLocalNoon(picking === 'from' ? fromMax : toMax)}
                minimumDate={
                  picking === 'to'
                    ? ymdToLocalNoon(customFrom)
                    : ymdToLocalNoon(shiftYmd(customTo, -366))
                }
                onChange={onPickerChange}
                style={styles.iosPicker}
              />
              <Pressable
                onPress={closeIosPicker}
                style={({ pressed }) => [styles.modalDone, pressed && styles.pressed]}
              >
                <Text style={styles.modalDoneText}>Listo</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
  },
  filterChip: {
    flex: 1,
    paddingVertical: 9,
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
  filterChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  filterChipTextActive: { color: '#fff' },
  rangePanel: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  rangeRow: { flexDirection: 'row', gap: spacing.sm },
  rangeBtn: {
    flex: 1,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rangeBtnLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  rangeBtnValue: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  rangeError: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.error,
    fontWeight: '600',
  },
  stack: { gap: spacing.md },
  hero: {
    backgroundColor: '#FFF8F8',
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: 6,
  },
  heroKicker: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  heroValue: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
    color: colors.text,
  },
  heroHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  metricRow: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 2,
    minHeight: 96,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  metricValue: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: colors.text,
  },
  metricHint: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  stateCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  stateTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  stateText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  retryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  skelHero: {
    height: 118,
    borderRadius: radii.card,
    backgroundColor: '#E4E4E4',
  },
  skelTile: {
    flex: 1,
    height: 96,
    borderRadius: radii.card,
    backgroundColor: '#E4E4E4',
  },
  pressed: { opacity: 0.9 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  iosPicker: { alignSelf: 'stretch' },
  modalDone: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalDoneText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
