import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../../components/common/AppButton';
import { colors, radii, spacing } from '../../constants/theme';
import { useClientMaterialRequests } from '../../hooks/useClientQuotes';
import type { ClientMaterialRequestSummary } from '../../types/materials';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { listKey } from '../../utils/safeAsync';

type LegacyClientQuotesParamList = {
  ClientMaterialQuotesList: undefined;
  ClientCompareQuotes: { requestId: string };
};

type Props = NativeStackScreenProps<LegacyClientQuotesParamList, 'ClientMaterialQuotesList'>;

/**
 * Lista de pedidos/obras del cliente con presupuestos de comercios.
 */
export function ClientMaterialQuotesListScreen({ navigation }: Props) {
  const { requests, loading, error, refresh } = useClientMaterialRequests(true);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <View style={styles.flex}>
      {loading && requests.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Cargando tus obras…</Text>
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
          data={requests}
          keyExtractor={(item, index) => listKey(item?.requestId, index, 'solicitud')}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <Text style={styles.lead}>
              Elegí una obra para comparar los presupuestos que te enviaron los comercios.
            </Text>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="home-outline" size={40} color={colors.textSecondary} />
                <Text style={styles.emptyTitle}>Todavía no hay cotizaciones</Text>
                <Text style={styles.muted}>
                  Cuando un profesional pida materiales a tu nombre y los comercios respondan,
                  vas a verlos acá.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <RequestRow
              item={item}
              onPress={() =>
                navigation.navigate('ClientCompareQuotes', { requestId: item.requestId })
              }
            />
          )}
        />
      ) : null}
    </View>
  );
}

function RequestRow({
  item,
  onPress,
}: {
  item: ClientMaterialRequestSummary;
  onPress: () => void;
}) {
  const statusLabel =
    item.status === 'accepted'
      ? 'Confirmada'
      : item.quoteCount > 0
        ? `${item.quoteCount} presupuesto${item.quoteCount === 1 ? '' : 's'}`
        : 'Esperando comercios';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta}>{statusLabel}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg, flexGrow: 1 },
  lead: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardPressed: { opacity: 0.92 },
  cardBody: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  warn: { textAlign: 'center', color: colors.textSecondary, fontSize: 15 },
});
