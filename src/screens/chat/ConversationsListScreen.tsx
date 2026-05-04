import { useFocusEffect, useScrollToTop } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ClickableAvatar } from '../../components/common/ClickableAvatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useUnreadMessages } from '../../context/UnreadMessagesContext';
import { isMessagingAvailable } from '../../config/api';
import {
  buildChatHeaderSubtitle,
  deleteConversation,
  loadConversations,
  type ApiConversation,
} from '../../services/messaging';
import { formatConversationTime } from '../../utils/formatDate';
import type { MessagesStackScreenProps } from '../../navigation/mainTypes';
import { useAppToast } from '../../components/toast/toast';
import { useRef } from 'react';

type Props = MessagesStackScreenProps<'ConversationsList'>;

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function firstNameOnly(name: string): string {
  const s = (name ?? '').trim();
  if (!s) return 'Usuario';
  const parts = s.split(/\s+/).filter(Boolean);
  return parts[0] ?? 'Usuario';
}

function renderTicks(params: { mine: boolean; peerReadAt?: string | null; lastMessageAt?: string | null }) {
  if (!params.mine) return null;
  const peer = params.peerReadAt ?? null;
  const lastAt = params.lastMessageAt ?? null;
  if (!lastAt) return <Text style={styles.tick}>✓</Text>;
  if (!peer) return <Text style={styles.tick}>✓</Text>; // enviado (no hay evidencia de apertura del otro)
  const seen = new Date(peer).getTime() >= new Date(lastAt).getTime();
  return (
    <Text style={[styles.tick, seen ? styles.tickSeen : styles.tickDelivered]}>
      ✓✓
    </Text>
  );
}

export function ConversationsListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { refreshUnread } = useUnreadMessages();
  const toast = useAppToast();
  const [items, setItems] = useState<ApiConversation[]>([]);
  const listRef = useRef<FlatList<ApiConversation> | null>(null);
  useScrollToTop(listRef);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiConversation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id || !isMessagingAvailable()) {
      setItems([]);
      return;
    }
    const data = await loadConversations(user.id);
    // #7: ocultar conversaciones sin mensajes (solo mostrar hilos reales).
    const filtered = data.filter((c) => Boolean(c.lastMessageAt));
    const sorted = [...filtered].sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? b.updatedAt).getTime() -
        new Date(a.lastMessageAt ?? a.updatedAt).getTime(),
    );
    setItems(sorted);
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

  useFocusEffect(
    useCallback(() => {
      // Al volver del chat: recargar lista + contadores (badge se borra solo).
      void load();
      void refreshUnread();
    }, [load, refreshUnread]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
      await refreshUnread();
    } finally {
      setRefreshing(false);
    }
  }, [load, refreshUnread]);

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
      <View style={[styles.titleBlock, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Mensajes</Text>
        <Text style={styles.titleSub}>Historial privado con clientes y profesionales</Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
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
              style={({ pressed }) => [
                styles.row,
                // #16: destacar conversaciones con no leídos.
                item.unreadCount && item.unreadCount > 0 ? styles.rowUnread : null,
                pressed && styles.rowPressed,
              ]}
              onLongPress={() => setDeleteTarget(item)}
              onPress={() =>
                navigation.navigate('ChatConversation', {
                  conversationId: item.id,
                  otherDisplayName: item.otherDisplayName,
                  headerSubtitle: buildChatHeaderSubtitle(item),
                  workerId: item.myRole === 'cliente' ? item.otherUserId : undefined,
                })
              }
            >
              <View style={styles.avatar}>
                {item.otherAvatarUrl ? (
                  <ClickableAvatar uri={item.otherAvatarUrl} style={styles.avatarImg} fill />
                ) : (
                  <Text style={styles.avatarText}>{initialsFromName(item.otherDisplayName)}</Text>
                )}
              </View>
              <View style={styles.rowText}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {firstNameOnly(item.otherDisplayName)}
                  </Text>
                  <Text style={styles.time}>
                    {formatConversationTime(item.lastMessageAt ?? item.updatedAt)}
                  </Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text style={styles.roleChip}>
                    {item.myRole === 'cliente' ? (item.primaryTrade?.trim() || 'Oficio') : 'Cliente'}
                  </Text>
                  {item.lastMessage ? (
                    <View style={styles.previewRow}>
                      {renderTicks({
                        mine: item.lastMessageSenderId === user?.id,
                        peerReadAt: item.peerReadAt,
                        lastMessageAt: item.lastMessageAt,
                      })}
                      <Text style={styles.rowSub} numberOfLines={2}>
                        {item.lastMessage}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.rowSubMuted}>Sin mensajes todavía</Text>
                  )}
                </View>
              </View>
              {item.unreadCount && item.unreadCount > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>
                    {item.unreadCount > 5 ? '+5' : String(item.unreadCount)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      )}

      <Modal
        visible={Boolean(deleteTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDeleteTarget(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Quitar chat</Text>
            <Text style={styles.modalText}>
              {deleteTarget
                ? `Se quitará de tu lista el chat con ${firstNameOnly(deleteTarget.otherDisplayName)}. La otra persona lo seguirá viendo.`
                : ''}
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalBtn, styles.modalBtnGhost, pressed && styles.pressed]}
                onPress={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                <Text style={styles.modalBtnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalBtn, styles.modalBtnDanger, pressed && styles.pressed]}
                onPress={() => {
                  const target = deleteTarget;
                  if (!target || !user?.id || deleting) return;
                  Alert.alert(
                    'Quitar chat',
                    '¿Querés quitar este chat de tu lista? La otra persona lo seguirá viendo.',
                    [
                      { text: 'Cancelar', style: 'cancel' },
                      {
                        text: 'Quitar',
                        style: 'destructive',
                        onPress: () => {
                          setDeleteTarget(null);
                          setDeleting(true);
                          void (async () => {
                            try {
                              await deleteConversation(user.id, target.id);
                              setItems((prev) => prev.filter((x) => x.id !== target.id));
                              await refreshUnread();
                              toast.success('Chat quitado.', 'Mensajes');
                            } catch (e) {
                              console.error('[delete chat:list]', e);
                              toast.error(
                                e instanceof Error ? e.message : 'No se pudo eliminar el chat',
                                'Mensajes',
                              );
                            } finally {
                              setDeleting(false);
                            }
                          })();
                        },
                      },
                    ],
                  );
                }}
                disabled={deleting}
              >
                <Text style={styles.modalBtnDangerText}>{deleting ? 'Quitando…' : 'Quitar'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  rowUnread: {
    backgroundColor: '#F0F0F0',
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
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
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
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: spacing.sm },
  tick: { fontSize: 12, fontWeight: '900', color: colors.textSecondary },
  tickDelivered: { color: colors.textSecondary },
  tickSeen: { color: '#34B7F1' },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    marginLeft: spacing.sm,
  },
  unreadBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  modalText: { marginTop: spacing.sm, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  modalBtnGhost: { borderColor: colors.border, backgroundColor: 'transparent' },
  modalBtnGhostText: { color: colors.text, fontWeight: '800' },
  modalBtnDanger: { borderColor: '#DC2626', backgroundColor: '#DC2626' },
  modalBtnDangerText: { color: '#fff', fontWeight: '900' },
  pressed: { opacity: 0.9 },
});
