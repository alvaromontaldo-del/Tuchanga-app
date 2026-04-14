import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { isMessagingAvailable } from '../../config/api';
import {
  buildChatHeaderSubtitle,
  loadConversations,
  type ApiConversation,
} from '../../services/messaging';
import { formatConversationTime } from '../../utils/formatDate';
import type { MessagesStackScreenProps } from '../../navigation/mainTypes';

type Props = MessagesStackScreenProps<'ConversationsList'>;

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function ConversationsListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<ApiConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id || !isMessagingAvailable()) {
      setItems([]);
      return;
    }
    const data = await loadConversations(user.id);
    setItems(data);
  }, [user?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const emptyHint = useMemo(
    () =>
      'Cuando contactes a un profesional desde su perfil, el historial aparecerá aquí. Los mensajes se sincronizan en la nube.',
    [],
  );

  if (!isMessagingAvailable()) {
    return (
      <View style={styles.safe}>
        <Text style={styles.title}>Mensajes</Text>
        <Text style={styles.hint}>
          Configurá Supabase (EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY) o el servidor
          Node (EXPO_PUBLIC_API_URL) para usar el chat.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>Mensajes</Text>
        <Text style={styles.titleSub}>Historial privado con clientes y profesionales</Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Todavía no hay conversaciones</Text>
              <Text style={styles.empty}>{emptyHint}</Text>
            </View>
          }
          contentContainerStyle={items.length === 0 ? styles.emptyListContent : styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() =>
                navigation.navigate('ChatConversation', {
                  conversationId: item.id,
                  otherDisplayName: item.otherDisplayName,
                  headerSubtitle: buildChatHeaderSubtitle(item),
                })
              }
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsFromName(item.otherDisplayName)}</Text>
              </View>
              <View style={styles.rowText}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.otherDisplayName}
                  </Text>
                  <Text style={styles.time}>{formatConversationTime(item.updatedAt)}</Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text style={styles.roleChip}>
                    {item.myRole === 'cliente' ? 'Profesional' : 'Cliente'}
                  </Text>
                  {item.lastMessage ? (
                    <Text style={styles.rowSub} numberOfLines={2}>
                      {item.lastMessage}
                    </Text>
                  ) : (
                    <Text style={styles.rowSubMuted}>Sin mensajes todavía</Text>
                  )}
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  titleBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  brandRow: {
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  titleSub: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  hint: {
    paddingHorizontal: spacing.lg,
    color: colors.textSecondary,
    lineHeight: 20,
    fontSize: 14,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingBottom: spacing.xl },
  emptyListContent: { flexGrow: 1 },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl * 2,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  empty: { textAlign: 'center', color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { opacity: 0.88 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { fontSize: 17, fontWeight: '800', color: '#fff' },
  rowText: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  time: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  rowBottom: { marginTop: 6 },
  roleChip: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  rowSub: { fontSize: 15, color: colors.textSecondary, lineHeight: 20 },
  rowSubMuted: { fontSize: 14, color: colors.textSecondary, fontStyle: 'italic', opacity: 0.85 },
  chevron: { fontSize: 22, color: colors.textSecondary, fontWeight: '300', marginLeft: 4 },
});
