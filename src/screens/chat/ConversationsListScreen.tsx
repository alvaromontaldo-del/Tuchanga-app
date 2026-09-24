import { useFocusEffect, useIsFocused, useScrollToTop } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { useUserMode } from '../../context/UserModeContext';
import { useUnreadMessages } from '../../context/UnreadMessagesContext';
import type { ConversationRole } from '../../services/chatApi';
import { listKey } from '../../utils/safeAsync';
import { isMessagingAvailable } from '../../config/api';
import {
  buildChatHeaderSubtitle,
  deleteConversation,
  dedupeInboxByPeer,
  loadConversations,
  type ApiConversation,
} from '../../services/messaging';
import { patchConversationRow, sortConversations } from '../../services/inboxState';
import { formatConversationTime } from '../../utils/formatDate';
import type { MessagesStackScreenProps } from '../../navigation/mainTypes';
import { useAppToast } from '../../components/toast/toast';
import { useRef } from 'react';

type Props = MessagesStackScreenProps<'ConversationsList'>;

type InboxTab = ConversationRole;

const INBOX_TABS: { id: InboxTab; label: string }[] = [
  { id: 'trabajador', label: 'Mis Clientes' },
  { id: 'cliente', label: 'Mis Contrataciones' },
];

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function firstNameOnly(name: string): string {
  const s = (name ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return 'Usuario';
  const parts = s.split(' ').filter(Boolean);
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

function InboxTabSelector({
  activeTab,
  onChange,
  unreadByTab,
}: {
  activeTab: InboxTab;
  onChange: (tab: InboxTab) => void;
  unreadByTab: Record<InboxTab, number>;
}) {
  return (
    <View style={styles.tabRow}>
      {INBOX_TABS.map((tab) => {
        const active = activeTab === tab.id;
        const unread = unreadByTab[tab.id] ?? 0;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [
              styles.tabBtn,
              active ? styles.tabBtnActive : null,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.tabBtnText, active ? styles.tabBtnTextActive : null]} numberOfLines={1}>
              {tab.label}
            </Text>
            {unread > 0 ? (
              <View style={[styles.tabBadge, active ? styles.tabBadgeActive : null]}>
                <Text style={styles.tabBadgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ConversationsListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { isWorker } = useUserMode();
  const insets = useSafeAreaInsets();
  const {
    unreadByConversationId,
    onInboxEvent,
    syncInboxLight,
    reconcileInboxFromServer,
  } = useUnreadMessages();
  const isFocused = useIsFocused();
  const toast = useAppToast();
  const [items, setItems] = useState<ApiConversation[]>([]);
  const listRef = useRef<FlatList<ApiConversation> | null>(null);
  useScrollToTop(listRef);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiConversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<InboxTab>(isWorker ? 'trabajador' : 'cliente');

  const load = useCallback(async () => {
    if (!user?.id || !isMessagingAvailable()) {
      setItems([]);
      return;
    }
    const data = await loadConversations(user.id);
    // #7: ocultar conversaciones sin mensajes (solo mostrar hilos reales).
    const filtered = data.filter((c) => Boolean(c.lastMessageAt));
    // Obligatorio en UI: 1 fila por peer (vieja soft-deleted / huérfana nunca compite).
    const deduped = dedupeInboxByPeer(filtered);
    const sorted = [...deduped].sort(
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

  // Sincronizar badges de fila con estado global (optimista).
  useEffect(() => {
    setItems((prev) =>
      prev.map((c) => ({
        ...c,
        unreadCount: unreadByConversationId[c.id] ?? c.unreadCount ?? 0,
      })),
    );
  }, [unreadByConversationId]);

  // Realtime: parche local de preview + unread sin refetch completo.
  useEffect(() => {
    if (!user?.id) return;
    return onInboxEvent((event) => {
      if (event.type === 'read') {
        setItems((prev) =>
          sortConversations(
            prev.map((c) =>
              c.id === event.conversationId ? { ...c, unreadCount: 0 } : c,
            ),
          ),
        );
        return;
      }
      setItems((prev) => {
        const idx = prev.findIndex((c) => c.id === event.conversationId);
        if (idx < 0) {
          void load();
          return prev;
        }
        const next = [...prev];
        next[idx] = patchConversationRow(
          next[idx],
          event,
          user.id,
          event.conversationUnread,
        );
        return dedupeInboxByPeer(sortConversations(next));
      });
    });
  }, [user?.id, onInboxEvent, load]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void syncInboxLight();
    }, [load, syncInboxLight]),
  );

  /** Respaldo si el WebSocket de Realtime no entrega (común en dev client / redes móviles). */
  useEffect(() => {
    if (!isFocused || !user?.id || !isMessagingAvailable()) return;
    void syncInboxLight();
    const id = setInterval(() => void syncInboxLight(), 4_000);
    return () => clearInterval(id);
  }, [isFocused, user?.id, syncInboxLight]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), reconcileInboxFromServer({ force: true })]);
    } finally {
      setRefreshing(false);
    }
  }, [load, reconcileInboxFromServer]);

  const itemsForTab = useMemo(() => {
    const tabItems = isWorker ? items.filter((c) => c.myRole === activeTab) : items;
    // Re-dedupe por si realtime/patches metieron un id viejo del mismo peer.
    return dedupeInboxByPeer(tabItems);
  }, [items, activeTab, isWorker]);

  const emptyCopy = useMemo(() => {
    if (isWorker && activeTab === 'trabajador') {
      return {
        title: 'Sin chats con clientes',
        body: 'No tenés chats activos como trabajador todavía. Cuando un cliente te contacte desde tu perfil, aparecerán aquí.',
      };
    }
    return {
      title: 'Sin contrataciones',
      body: 'No tenés chats activos como cliente todavía. Contactá a un profesional desde su perfil para iniciar una conversación.',
    };
  }, [activeTab, isWorker]);

  const unreadByTab = useMemo(() => {
    const counts: Record<InboxTab, number> = { trabajador: 0, cliente: 0 };
    for (const c of items) {
      const n = unreadByConversationId[c.id] ?? c.unreadCount ?? 0;
      if (n > 0) counts[c.myRole] += n;
    }
    return counts;
  }, [items, unreadByConversationId]);

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
        <Text style={styles.titleSub}>
          {isWorker
            ? activeTab === 'trabajador'
              ? 'Conversaciones donde ofrecés tu servicio'
              : 'Conversaciones donde contrataste un profesional'
            : 'Conversaciones con profesionales'}
        </Text>
        {isWorker ? (
          <InboxTabSelector
            activeTab={activeTab}
            onChange={setActiveTab}
            unreadByTab={unreadByTab}
          />
        ) : null}
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={itemsForTab}
          keyExtractor={(item, index) => listKey(item?.id, index, 'chat')}
          extraData={activeTab}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
              <Text style={styles.empty}>{emptyCopy.body}</Text>
            </View>
          }
          contentContainerStyle={
            itemsForTab.length === 0 ? styles.emptyListContent : styles.listContent
          }
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
            <Text style={styles.modalTitle}>Eliminar chat</Text>
            <Text style={styles.modalText}>
              {deleteTarget
                ? `Se archivará la conversación con ${firstNameOnly(deleteTarget.otherDisplayName)} para ambos. Si vuelven a contactarse, empezarán un chat nuevo sin el historial anterior.`
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
                    'Eliminar chat',
                    '¿Archivar esta conversación? Ambos dejarán de verla; un nuevo contacto abre un chat en blanco.',
                    [
                      { text: 'Cancelar', style: 'cancel' },
                      {
                        text: 'Eliminar',
                        style: 'destructive',
                        onPress: () => {
                          setDeleteTarget(null);
                          setDeleting(true);
                          void (async () => {
                            try {
                              await deleteConversation(user.id, target.id);
                              setItems((prev) => prev.filter((x) => x.id !== target.id));
                              await reconcileInboxFromServer({ force: true });
                              toast.success('Chat eliminado.', 'Mensajes');
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
                <Text style={styles.modalBtnDangerText}>{deleting ? 'Eliminando…' : 'Eliminar'}</Text>
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
  tabRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.imagePlaceholder,
    borderRadius: 12,
    padding: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
  },
  tabBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabBtnText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  tabBtnTextActive: {
    color: colors.text,
    fontWeight: '800',
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  tabBadgeActive: {
    backgroundColor: colors.primaryDark,
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
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
