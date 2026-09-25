import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../../components/common/AppButton';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useClientMaterialPickups } from '../../hooks/useClientMaterialPickups';
import { formatMoneyAr } from '../../services/clientQuotesSupabase';
import { listKey } from '../../utils/safeAsync';
import {
  buildClientPickupCardContent,
  type ClientPickupCardModel,
  type ClientPickupSection,
} from '../../utils/clientMaterialPickups';

const TABS: { id: ClientPickupSection; label: string }[] = [
  { id: 'para_retirar', label: 'Para retirar' },
  { id: 'historial', label: 'Historial' },
];

const LEAD: Record<ClientPickupSection, string> = {
  para_retirar: 'Pedidos listos para retirar: dirección, horario, número de pedido y PIN.',
  historial: 'Pedidos ya retirados en el comercio.',
};

const EMPTY_COPY: Record<ClientPickupSection, { title: string; body: string }> = {
  para_retirar: {
    title: 'No hay pedidos para retirar',
    body: 'Acá aparecen solo los pedidos en los que ya aceptaste y pagaste el costo de servicio YaChanga. Cuando retires en el comercio, pasan al historial.',
  },
  historial: {
    title: 'Historial vacío',
    body: 'Cuando el comercio cierre el pedido con tu PIN, lo vas a ver acá.',
  },
};

/**
 * Solicitudes de materiales del cliente: listas para retirar e historial.
 * La tarjeta no muestra “Disponible desde” ni el N° de solicitud.
 * El resumen de materiales va en un desplegable.
 */
export function ClientMaterialPickupsScreen() {
  const { orders, loading, error, refresh } = useClientMaterialPickups(true);
  const [section, setSection] = useState<ClientPickupSection>('para_retirar');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const counts = useMemo(() => {
    return {
      para_retirar: orders.filter((order) => order.section === 'para_retirar').length,
      historial: orders.filter((order) => order.section === 'historial').length,
    };
  }, [orders]);

  const list = useMemo(
    () => orders.filter((order) => order.section === section),
    [orders, section],
  );

  const toggle = useCallback((orderId: string) => {
    setExpanded((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  }, []);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <View style={styles.tabRow}>
        {TABS.map((tab) => {
          const active = section === tab.id;
          const count = counts[tab.id];
          const label = count > 0 ? `${tab.label} (${count > 99 ? '99+' : count})` : tab.label;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setSection(tab.id)}
              style={({ pressed }) => [
                styles.tabBtn,
                active ? styles.tabBtnActive : null,
                pressed && styles.pressed,
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
            >
              <Text style={[styles.tabBtnText, active ? styles.tabBtnTextActive : null]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading && orders.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Cargando pedidos…</Text>
        </View>
      ) : null}

      {!loading && error ? (
        <View style={styles.centered}>
          <Text style={styles.warn}>{error}</Text>
          <AppButton title="Reintentar" onPress={refresh} variant="secondary" />
        </View>
      ) : null}

      {!error ? (
        <FlatList
          data={list}
          keyExtractor={(item, index) => listKey(item?.orderId, index, 'orden')}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            list.length > 0 ? <Text style={styles.lead}>{LEAD[section]}</Text> : null
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="cube-outline" size={40} color={colors.textSecondary} />
                <Text style={styles.emptyTitle}>{EMPTY_COPY[section].title}</Text>
                <Text style={styles.muted}>{EMPTY_COPY[section].body}</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <PickupCard
              card={item}
              expanded={Boolean(expanded[item.orderId])}
              onToggle={() => toggle(item.orderId)}
            />
          )}
        />
      ) : null}
    </SafeAreaView>
  );
}

function PickupCard({
  card,
  expanded,
  onToggle,
}: {
  card: ClientPickupCardModel;
  expanded: boolean;
  onToggle: () => void;
}) {
  const content = buildClientPickupCardContent(card);

  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.storeName} numberOfLines={2}>
        {content.storeName}
      </Text>
      {content.title ? (
        <Text style={styles.cardTitle} numberOfLines={2}>
          {content.title}
        </Text>
      ) : null}

      {content.orderCode ? (
        <View style={styles.idRow}>
          <Text style={styles.idLabel}>Nº pedido</Text>
          <Text style={styles.idValueStrong} selectable>
            {content.orderCode}
          </Text>
        </View>
      ) : null}

      <View style={styles.divider} />

      {content.fields.map((field) => (
        <View key={field.label} style={styles.field}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          <Text style={styles.fieldValue}>{field.value}</Text>
        </View>
      ))}

      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.expandBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Ocultar materiales' : 'Ver materiales'}
      >
        <Text style={styles.expandBtnText}>{expanded ? 'Ocultar materiales' : 'Ver materiales'}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
      </Pressable>

      {expanded ? (
        <View style={styles.materialsBox}>
          {content.materials.length > 0 ? (
            content.materials.map((item) => (
              <Text key={item.id} style={styles.materialLine}>
                · {item.line}
              </Text>
            ))
          ) : (
            <Text style={styles.materialEmpty}>No hay detalle de materiales.</Text>
          )}
        </View>
      ) : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total a abonar en el comercio</Text>
        <Text style={styles.totalValue}>{formatMoneyAr(card.amountDue)}</Text>
      </View>

      {content.pinDisplay ? (
        <View style={content.pinUsed ? styles.pinUsedBox : styles.pinBox}>
          <Text style={content.pinUsed ? styles.pinUsedLabel : styles.pinLabel}>
            {content.pinUsed ? 'PIN usado' : 'PIN de retiro'}
          </Text>
          <Text style={content.pinUsed ? styles.pinUsedValue : styles.pinValue}>{content.pinDisplay}</Text>
          {content.pinHint ? <Text style={styles.pinHint}>{content.pinHint}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  tabBtnActive: {
    borderColor: colors.primary,
    backgroundColor: '#FDECEA',
  },
  tabBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  tabBtnTextActive: { color: colors.primary },
  list: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    flexGrow: 1,
    gap: spacing.sm,
  },
  lead: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  storeName: { fontSize: 18, fontWeight: '800', color: colors.text },
  cardTitle: { ...typography.body, color: colors.textSecondary },
  idRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  idLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  idValueStrong: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  field: { gap: 2 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldValue: { ...typography.body, fontWeight: '600', color: colors.text },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expandBtnText: { fontSize: 14, fontWeight: '800', color: colors.primary },
  materialsBox: {
    gap: 4,
    paddingHorizontal: spacing.xs,
  },
  materialLine: { fontSize: 14, color: colors.text, lineHeight: 20 },
  materialEmpty: { fontSize: 13, color: colors.textSecondary },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  totalLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  totalValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  pinBox: {
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 4,
  },
  pinLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pinValue: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  pinHint: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  pinUsedBox: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pinUsedLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  pinUsedValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  pressed: { opacity: 0.88 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
  muted: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  warn: { textAlign: 'center', color: colors.textSecondary, fontSize: 15 },
});
