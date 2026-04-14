import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isSupabaseConfigured } from '../../config/supabase';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { sendMessageSupabase } from '../../services/chatSupabase';
import { loadMessages, subscribeChatMessages } from '../../services/messaging';
import { newRandomUserId } from '../../utils/stableUserId';

export type ChatScreenParams = {
  conversationId: string;
  /** Nombre para mostrar del otro participante (cliente o profesional). */
  otherDisplayName: string;
  /** Línea secundaria del encabezado, ej. "Profesional · Plomería" o "Cliente". */
  headerSubtitle: string;
};

type UiMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  status: string;
  created_at: string;
  clientMessageId?: string | null;
  optimistic?: boolean;
};

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

type Props = {
  conversationId: string;
  otherDisplayName: string;
  headerSubtitle: string;
};

export function ChatScreen({ conversationId, otherDisplayName, headerSubtitle }: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { socket, connected } = useSocket();
  const listRef = useRef<FlatList<UiMessage>>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const myId = user?.id ?? '';

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    if (!myId || !conversationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await loadMessages(myId, conversationId);
        if (cancelled) return;
        setMessages(rows.map((r) => ({ ...r, optimistic: false })));
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myId, conversationId]);

  useEffect(() => {
    if (!conversationId || !myId) return;

    if (isSupabaseConfigured()) {
      const unsub = subscribeChatMessages(
        conversationId,
        (msg) => {
          setMessages((prev) => {
            if (prev.some((p) => p.id === msg.id)) return prev;
            const cmid = msg.clientMessageId;
            if (cmid) {
              const i = prev.findIndex((p) => p.clientMessageId === cmid || p.id === cmid);
              if (i >= 0) {
                const next = [...prev];
                next[i] = { ...msg, optimistic: false };
                return next;
              }
            }
            return [...prev, { ...msg, optimistic: false }];
          });
          scrollToEnd();
        },
        myId,
      );
      return unsub;
    }

    if (!socket) return;
    socket.emit('join_conversation', { conversationId }, () => {});
    const onNew = (msg: UiMessage) => {
      if (msg.conversation_id !== conversationId) return;
      setMessages((prev) => {
        if (prev.some((p) => p.id === msg.id)) return prev;
        const cmid = msg.clientMessageId;
        if (cmid) {
          const i = prev.findIndex((p) => p.clientMessageId === cmid || p.id === cmid);
          if (i >= 0) {
            const next = [...prev];
            next[i] = { ...msg, optimistic: false };
            return next;
          }
        }
        return [...prev, { ...msg, optimistic: false }];
      });
      scrollToEnd();
    };
    socket.on('message:new', onNew);
    return () => {
      socket.emit('leave_conversation', { conversationId });
      socket.off('message:new', onNew);
    };
  }, [socket, conversationId, scrollToEnd, myId]);

  useEffect(() => {
    scrollToEnd();
  }, [messages.length, loading, scrollToEnd]);

  function send() {
    const text = input.trim();
    if (!text || !myId) return;

    if (isSupabaseConfigured()) {
      const clientMessageId = newRandomUserId();
      const optimistic: UiMessage = {
        id: clientMessageId,
        conversation_id: conversationId,
        sender_id: myId,
        text,
        status: 'sending',
        created_at: new Date().toISOString(),
        clientMessageId,
        optimistic: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      setInput('');
      setSending(true);
      void (async () => {
        try {
          const saved = await sendMessageSupabase(conversationId, text);
          setMessages((prev) => {
            const mapped = prev.map((m) =>
              m.clientMessageId === clientMessageId
                ? { ...saved, optimistic: false }
                : m,
            );
            const seen = new Set<string>();
            return mapped.filter((m) => {
              if (seen.has(m.id)) return false;
              seen.add(m.id);
              return true;
            });
          });
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === clientMessageId ? { ...m, status: 'failed' } : m,
            ),
          );
        } finally {
          setSending(false);
        }
      })();
      scrollToEnd();
      return;
    }

    if (!socket || !connected) return;
    const clientMessageId = newRandomUserId();
    const optimistic: UiMessage = {
      id: clientMessageId,
      conversation_id: conversationId,
      sender_id: myId,
      text,
      status: 'sending',
      created_at: new Date().toISOString(),
      clientMessageId,
      optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    setSending(true);
    socket.emit(
      'send_message',
      { conversationId, text, clientMessageId },
      (res: { ok?: boolean; error?: string }) => {
        setSending(false);
        if (!res?.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === clientMessageId ? { ...m, status: 'failed' } : m,
            ),
          );
        }
      },
    );
    scrollToEnd();
  }

  const renderItem = useCallback(
    ({ item }: { item: UiMessage }) => {
      const mine = item.sender_id === myId;
      return (
        <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
            <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextOther]}>
              {item.text}
            </Text>
            <View style={styles.metaRow}>
              <Text style={[styles.time, mine ? styles.timeMine : styles.timeOther]}>
                {formatTime(item.created_at)}
              </Text>
              {item.status === 'sending' ? (
                <ActivityIndicator size="small" color={mine ? '#E0F2F1' : colors.textSecondary} />
              ) : null}
              {item.status === 'failed' && mine ? (
                <Text style={styles.failed}>No enviado</Text>
              ) : null}
            </View>
          </View>
        </View>
      );
    },
    [myId],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <View style={styles.header}>
        <Text style={styles.headerName}>{otherDisplayName}</Text>
        {headerSubtitle ? <Text style={styles.headerTrade}>{headerSubtitle}</Text> : null}
        {!isSupabaseConfigured() && !connected ? (
          <Text style={styles.headerWarn}>Reconectando…</Text>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          initialNumToRender={18}
          maxToRenderPerBatch={24}
          windowSize={10}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={[
            styles.listContent,
            messages.length === 0 && styles.listEmpty,
          ]}
          onContentSizeChange={scrollToEnd}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Escribí un mensaje para iniciar el contacto</Text>
          }
          keyboardShouldPersistTaps="handled"
        />
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Mensaje…"
          placeholderTextColor={colors.textSecondary}
          multiline
          maxLength={2000}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={send}
          disabled={
            !input.trim() ||
            sending ||
            (!isSupabaseConfigured() && !connected)
          }
        >
          <Ionicons name="send" size={20} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerName: { fontSize: 18, fontWeight: '800', color: colors.text },
  headerTrade: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 4 },
  headerWarn: { fontSize: 12, fontWeight: '700', color: colors.primary, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexGrow: 1 },
  listEmpty: { justifyContent: 'center' },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: spacing.xl,
  },
  row: { marginVertical: 4, maxWidth: '100%' },
  rowMine: { alignItems: 'flex-end' },
  rowOther: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '86%',
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: '#0D9488' },
  bubbleOther: { backgroundColor: '#E5E7EB' },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  bubbleTextMine: { color: '#fff' },
  bubbleTextOther: { color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  time: { fontSize: 11, fontWeight: '600' },
  timeMine: { color: 'rgba(255,255,255,0.85)' },
  timeOther: { color: colors.textSecondary },
  failed: { fontSize: 11, fontWeight: '700', color: '#FECACA' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.45 },
});
