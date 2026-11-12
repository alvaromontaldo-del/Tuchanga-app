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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, shadows, spacing, typography } from '../../constants/theme';
import { useAppNotifications } from '../../context/AppNotificationsContext';
import { useCommerceShell } from '../../context/CommerceShellContext';
import { navigationRef } from '../../navigation/navigationRef';
import { formatConversationTime } from '../../utils/formatDate';
import {
  routeForAppNotification,
  type AppNotificationRow,
} from '../../utils/appNotifications';

function openNotificationTarget(item: AppNotificationRow, isCommerceShell: boolean) {
  const dest = routeForAppNotification(item.type, isCommerceShell);
  if (dest.screen === 'WorkerABM') {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate('Main', {
      screen: 'Perfil',
      params: { screen: 'WorkerABM' },
    });
  }
}

export function AppNotificationsScreen() {
  const navigation = useNavigation();
  const { isCommerceShell } = useCommerceShell();
  const { items, unreadCount, loading, refresh, markRead, markAllRead } = useAppNotifications();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useFocusEffect(
    useCallback(() => {
      navigation.setOptions({
        title: 'Notificaciones',
        headerRight:
          unreadCount > 0
            ? () => (
                <Pressable
                  onPress={() => {
                    void markAllRead();
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Marcar todas como leídas"
                  style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                >
                  <Text style={styles.markAll}>Marcar leídas</Text>
                </Pressable>
              )
            : undefined,
      });
    }, [markAllRead, navigation, unreadCount]),
  );

  return (
    <View style={styles.safe}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, items.length === 0 ? styles.listEmpty : null]}
        refreshControl={
          <RefreshControl
            refreshing={loading && items.length > 0}
            onRefresh={() => {
              void refresh();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="notifications-outline" size={36} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>Todavía no hay avisos</Text>
              <Text style={styles.emptyBody}>
                Cuando YaChanga tenga una novedad de tu cuenta, la vas a ver acá.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const unread = !item.readAt;
          return (
            <Pressable
              onPress={() => {
                if (unread) void markRead(item.id);
                openNotificationTarget(item, isCommerceShell);
              }}
              style={[styles.card, unread ? styles.cardUnread : null]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.body}`}
            >
              <View style={styles.cardTop}>
                <View style={styles.titleRow}>
                  {unread ? <View style={styles.dot} /> : null}
                  <Text style={[styles.title, unread ? styles.titleUnread : null]} numberOfLines={2}>
                    {item.title}
                  </Text>
                </View>
                <Text style={styles.time}>{formatConversationTime(item.createdAt)}</Text>
              </View>
              <Text style={styles.body}>{item.body}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  listEmpty: { flexGrow: 1 },
  markAll: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    ...shadows.card,
  },
  cardUnread: {
    borderWidth: 1,
    borderColor: 'rgba(198, 40, 40, 0.12)',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, minWidth: 0 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  title: { ...typography.subtitle, flex: 1, fontWeight: '600' },
  titleUnread: { fontWeight: '800' },
  time: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 2 },
  body: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: { ...typography.title, textAlign: 'center', marginTop: spacing.sm },
  emptyBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
