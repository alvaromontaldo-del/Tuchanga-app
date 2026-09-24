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
import { colors, radii, spacing } from '../../constants/theme';
import { useClientMaterialPickups } from '../../hooks/useClientMaterialPickups';
import { formatMoneyAr } from '../../services/clientQuotesSupabase';
import {
  buildClientPickupCardContent,
  type ClientPickupCardModel,
  type ClientPickupSection,
} from '../../utils/clientMaterialPickups';

const TABS: { id: ClientPickupSection; label: string }[] = [
  { id: 'para_retirar', label: 'Para retirar' },
  { id: 'historial', label: 'Historial' },
];

const EMPTY_COPY: Record<ClientPickupSection, { title: string; body: string }> = {
  para_retirar: {
    title: 'No hay pedidos para retirar',
    body: 'Cuando pagues el costo de servicio, el pedido va a aparecer acá para retirarlo en el comercio.',
  },
  historial: {
    title: 'Todavía no hay retiros',
    body: 'Los pedidos que ya retiraste van a quedar en este historial.',
  },
};

/**
 * Solicitudes de materiales del cliente: listas para retirar e historial.
 * La tarjeta no muestra “Disponible desde” ni el N° de solicitud.
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
          return (
            <Pressable
              key={tab.id}
              onPress={() => setSection(tab.id)}
              style={({ pressed }) => [
                styles.tabBtn,
                active ? styles.tabBtnActive : null,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
            >
              <Text style={[styles.tabBtnText, active ? styles.tabBtnTextActive : null]}>
                {tab.label}
              </Text>
              {count > 0 ? (
                <View style={[styles.tabBadge, active ? styles.tabBadgeActive : null]}>
                  <Text style={styles.tabBadgeText}>{count > 99 ? '99+' : String(count)}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {loading && orders.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Cargando solicitudes…</Text>
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
          keyExtractor={(item) => item.orderId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
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
  const fields = [
    ...content.fields,
    { label: 'A abonar en el comercio', value: formatMoneyAr(card.amountDue) },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.storeName} numberOfLines={2}>
        {content.storeName}
      </Text>
      {content.logistics ? <Text style={styles.logistics}>{content.logistics}</Text> : null}
      {content.pickedUpLabel ? <Text style={styles.pickedUp}>{content.pickedUpLabel}</Text> : null}

      {fields.map((field) => (
        <View
          key={field.label}
          style={field.emphasize ? styles.pinBox : styles.fieldRow}
        >
          <Text style={field.emphasize ? styles.pinLabel : styles.fieldLabel}>{field.label}</Text>
          <Text style={field.emphasize ? styles.pinValue : styles.fieldValue}>{field.value}</Text>
        </View>
      ))}

      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.expandBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Ocultar materiales' : 'Ver materiales'}
      >
        <Text style={styles.expandBtnText}>
          {expanded ? 'Ocultar materiales' : 'Ver materiales'}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.primary}
        />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
  tabBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: colors.border,
    alignItems: 'center',
  },
  tabBadgeActive: { backgroundColor: colors.primary },
  tabBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  list: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    flexGrow: 1,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 8,
  },
  storeName: { fontSize: 17, fontWeight: '800', color: colors.text },
  logistics: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  pickedUp: { fontSize: 13, fontWeight: '700', color: '#1B5E20' },
  fieldRow: { gap: 2 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  fieldValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  pinBox: {
    marginTop: 2,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  pinLabel: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },
  pinValue: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 2,
  },
  expandBtn: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  expandBtnText: { fontSize: 14, fontWeight: '800', color: colors.primary },
  materialsBox: {
    gap: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  materialLine: { fontSize: 14, color: colors.text, lineHeight: 20 },
  materialEmpty: { fontSize: 13, color: colors.textSecondary },
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
