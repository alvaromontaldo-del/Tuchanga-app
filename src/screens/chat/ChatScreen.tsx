import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { useAppToast } from '../../components/toast/toast';
import { isSupabaseConfigured } from '../../config/supabase';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useUnreadMessages } from '../../context/UnreadMessagesContext';
import { setConversationLastRead } from '../../services/conversationReadsStorage';
import { fetchConversationReads, upsertConversationRead } from '../../services/conversationReadsSupabase';
import { sendMessageSupabase } from '../../services/chatSupabase';
import { deleteConversation, loadMessages, subscribeChatMessages } from '../../services/messaging';
import {
  computeFinalAmount,
  createQuote,
  createReview,
  fetchConversationParticipants,
  fetchQuotesByConversation,
  fetchReviewForConversation,
  fetchReviewForJob,
  subscribeQuotes,
  type ChatQuote,
  type QuoteStatus,
} from '../../services/quotesSupabase';
import {
  acceptQuoteCreateJob,
  completeJob,
  fetchLatestJobByConversation,
  processPayment,
  subscribeJobsByConversation,
  type ServiceJob,
} from '../../services/serviceJobsSupabase';
import { newRandomUserId } from '../../utils/stableUserId';
import { detectBlockedContact } from '../../utils/chatModeration';
import { setActiveConversationForNotifications } from '../../services/chatFocus';

export type ChatScreenParams = {
  conversationId: string;
  /** Nombre para mostrar del otro participante (cliente o profesional). */
  otherDisplayName: string;
  /** Línea secundaria del encabezado, ej. "Profesional · Plomería" o "Cliente". */
  headerSubtitle: string;
  /** Si el otro participante es un profesional, su userId/UUID para abrir su perfil. */
  workerId?: string;
};

type UiMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  status: string;
  created_at: string;
  clientMessageId?: string | null;
  type?: 'text' | 'budget';
  metadata?: Record<string, unknown>;
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

function firstNameOnly(name: string): string {
  const s = (name ?? '').trim();
  if (!s) return 'Usuario';
  const parts = s.split(/\s+/).filter(Boolean);
  return parts[0] ?? 'Usuario';
}

type Props = {
  conversationId: string;
  otherDisplayName: string;
  headerSubtitle: string;
  workerId?: string;
};

export function ChatScreen({ conversationId, otherDisplayName, headerSubtitle, workerId }: Props) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { user } = useAuth();
  const toast = useAppToast();
  const { refreshUnread } = useUnreadMessages();
  const { socket, connected } = useSocket();
  const listRef = useRef<FlatList<UiMessage>>(null);
  const [androidKeyboardOpen, setAndroidKeyboardOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const myId = user?.id ?? '';
  const displayName = useMemo(() => firstNameOnly(otherDisplayName), [otherDisplayName]);

  const blocked = useMemo(() => detectBlockedContact(input), [input]);

  // Presupuestos/reviews (solo Supabase)
  const [participants, setParticipants] = useState<{
    clientId: string;
    workerId: string;
    myRole: 'cliente' | 'trabajador';
  } | null>(null);
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [quoteBusy, setQuoteBusy] = useState<QuoteStatus | 'none'>('none');
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteNetAmount, setQuoteNetAmount] = useState(0);
  const [quoteNetText, setQuoteNetText] = useState('');
  const [quoteDetail, setQuoteDetail] = useState('');
  const [replacesQuoteId, setReplacesQuoteId] = useState<string | null>(null);
  const [job, setJob] = useState<ServiceJob | null>(null);
  const [review, setReview] = useState<Awaited<ReturnType<typeof fetchReviewForJob>>>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSending, setReviewSending] = useState(false);
  const [reviewFocused, setReviewFocused] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  const feeRate = 0.2;
  const quoteNetNum = useMemo(() => Math.max(0, Math.floor(quoteNetAmount)), [quoteNetAmount]);
  const quoteFinalPreview = useMemo(
    () => computeFinalAmount(quoteNetNum, feeRate),
    [quoteNetNum],
  );

  const quoteById = useMemo(() => {
    const m = new Map<string, ChatQuote>();
    for (const q of quotes) m.set(q.id, q);
    return m;
  }, [quotes]);

  const showPay = Boolean(job && participants?.myRole === 'cliente' && job.payment_status === 'PENDING');
  const showComplete = Boolean(
    job &&
      participants?.myRole === 'trabajador' &&
      job.work_status === 'PENDING',
  );
  const showReviewForm = Boolean(
    job &&
      participants?.myRole === 'cliente' &&
      job.work_status === 'COMPLETED_BY_WORKER' &&
      !reviewSubmitted &&
      !review,
  );

  // Revalidación puntual: si la cotización del job ya fue marcada como completada,
  // refetch del job para que el cliente reciba el work_status actualizado sin polling.
  useEffect(() => {
    if (!isSupabaseConfigured() || !conversationId) return;
    if (!job) return;
    if (job.work_status !== 'PENDING') return;
    const q = quoteById.get(job.quote_id);
    if (!q?.completed_at) return;
    void fetchLatestJobByConversation(conversationId)
      .then((j) => setJob(j))
      .catch(() => {});
  }, [conversationId, job?.id, job?.work_status, job?.quote_id, quoteById]);

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const formatMoney = useCallback(
    (n: number) => `$${currency.format(Math.round((Number(n) || 0) * 100) / 100)}`,
    [currency],
  );

  const quoteNetDisplay = useMemo(() => formatMoney(quoteNetNum), [formatMoney, quoteNetNum]);

  const hasActiveQuote = useMemo(() => quotes.some((q) => q.status === 'pending'), [quotes]);
  const hasActiveJob = useMemo(() => Boolean(job && job.work_status === 'PENDING'), [job]);
  const latestRejected = useMemo(() => {
    const rejected = quotes.filter((q) => q.status === 'rejected');
    return rejected.length ? rejected[rejected.length - 1] : null;
  }, [quotes]);

  const latestQuoteAny = useMemo(() => (quotes.length ? quotes[quotes.length - 1] : null), [quotes]);
  // "Cotizar" debe permanecer activo; solo evitamos doble envío con `quoteSubmitting`.

  function onChangeQuoteNetText(text: string) {
    // Entero positivo (sin decimales). Editable: dejamos solo dígitos y permitimos vacío.
    const digits = (text ?? '').replace(/\D/g, '').slice(0, 9);
    setQuoteNetText(digits);
    const next = digits ? Math.min(Number(digits), 999_999_999) : 0;
    setQuoteNetAmount(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
  }

  /** Android usa `softwareKeyboardLayoutMode: resize` (app.json): no hace falta KeyboardAvoidingView. */
  useEffect(() => {
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(eventName, () => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return () => sub.remove();
  }, []);

  // Para evitar duplicidad visual: si estamos dentro del chat en foreground,
  // suprimimos el alert del push para esta conversación.
  useFocusEffect(
    useCallback(() => {
      setActiveConversationForNotifications(conversationId);
      return () => setActiveConversationForNotifications(null);
    }, [conversationId]),
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setAndroidKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setAndroidKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  // Android: al abrir teclado, forzamos scroll al final con delay (algunos IME tardan en aplicar resize).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!androidKeyboardOpen) return;
    const id = setTimeout(() => scrollToEnd(), 100);
    return () => clearTimeout(id);
  }, [androidKeyboardOpen, scrollToEnd]);

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
    if (!isSupabaseConfigured() || !myId || !conversationId) return;
    let cancelled = false;
    void (async () => {
      try {
        const c = await fetchConversationParticipants(conversationId);
        if (cancelled) return;
        const myRole = c.cliente_id === myId ? 'cliente' : 'trabajador';
        setParticipants({
          clientId: c.cliente_id,
          workerId: c.trabajador_id,
          myRole,
        });
      } catch {
        // si falla, dejamos sin módulo de presupuesto
        if (!cancelled) setParticipants(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, myId]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !conversationId) return;
    let cancelled = false;
    void fetchQuotesByConversation(conversationId)
      .then((rows) => {
        if (!cancelled) setQuotes(rows);
      })
      .catch(() => {
        if (!cancelled) setQuotes([]);
      });
    const unsub = subscribeQuotes(conversationId, (q) => {
      setQuotes((prev) => {
        const i = prev.findIndex((x) => x.id === q.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = q;
          return next;
        }
        return [...prev, q].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [conversationId]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !conversationId) return;
    let cancelled = false;
    void fetchLatestJobByConversation(conversationId)
      .then((j) => {
        if (!cancelled) setJob(j);
      })
      .catch(() => {
        if (!cancelled) setJob(null);
      });
    const unsub = subscribeJobsByConversation(conversationId, (j) => {
      setJob((prev) => {
        if (!prev) return j;
        // Nos quedamos con el job más reciente por updated_at
        if (new Date(j.updated_at).getTime() >= new Date(prev.updated_at).getTime()) return j;
        return prev;
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [conversationId]);

  // Reseña 1:1 por job_id (robusto: soporta múltiples trabajos por conversación).
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const jobId = job?.id ?? '';
    if (!jobId) {
      setReview(null);
      setReviewSubmitted(false);
      return;
    }
    let cancelled = false;
    setReview(null);
    setReviewSubmitted(false);
    void fetchReviewForJob(jobId).then((r) => {
      if (!cancelled) setReview(r);
    });
    return () => {
      cancelled = true;
    };
  }, [job?.id]);

  // Marcar leído inmediatamente al abrir (borra badge al volver sin esperar a cargar mensajes).
  useEffect(() => {
    if (!myId || !conversationId) return;
    const now = new Date().toISOString();
    void (async () => {
      await setConversationLastRead(myId, conversationId, now);
      await refreshUnread();
      if (isSupabaseConfigured()) {
        await upsertConversationRead(conversationId, now);
      }
    })();
  }, [myId, conversationId, refreshUnread]);

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

  // Al abrir la conversación: forzar un scroll al final después del primer frame,
  // así el último mensaje queda pegado al footer (sin “aire”).
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => scrollToEnd(), 0);
    return () => clearTimeout(t);
  }, [conversationId, loading, scrollToEnd]);

  useEffect(() => {
    if (!myId || !conversationId || loading || messages.length === 0) return;
    let maxIso = messages[0].created_at;
    for (const m of messages) {
      if (new Date(m.created_at) > new Date(maxIso)) maxIso = m.created_at;
    }
    void (async () => {
      await setConversationLastRead(myId, conversationId, maxIso);
      await refreshUnread();
      if (isSupabaseConfigured()) {
        await upsertConversationRead(conversationId, maxIso);
        const rows = await fetchConversationReads(conversationId);
        const peer = rows
          .filter((r) => r.user_id !== myId)
          .sort((a, b) => new Date(b.read_at).getTime() - new Date(a.read_at).getTime())[0];
        setPeerReadAt(peer?.read_at ?? null);
      }
    })();
  }, [myId, conversationId, loading, messages, refreshUnread]);

  function send() {
    const text = input.trim();
    if (!text || !myId) return;
    const block = detectBlockedContact(text);
    if (block) {
      toast.warning(
        'Por seguridad, no está permitido compartir datos de contacto (WhatsApp, teléfono, Instagram, emails o links).',
        'Mensaje bloqueado',
        { durationMs: 5200 },
      );
      return;
    }

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
      const seenByPeer =
        mine &&
        peerReadAt != null &&
        new Date(peerReadAt).getTime() >= new Date(item.created_at).getTime();

      if (item.type === 'budget') {
        const quoteId = String(item.metadata?.quoteId ?? '');
        const q = quoteId ? quoteById.get(quoteId) ?? null : null;
        const myRole = participants?.myRole ?? null;
        const status: QuoteStatus | null = q?.status ?? null;
        const badge =
          status === 'pending'
            ? { label: 'Pendiente', icon: 'time-outline' as const, tone: 'pending' as const }
            : status === 'accepted'
              ? { label: 'Aceptado', icon: 'checkmark-circle-outline' as const, tone: 'accepted' as const }
              : status === 'rejected'
                ? { label: 'Rechazado', icon: 'close-circle-outline' as const, tone: 'rejected' as const }
                : status === 'paid'
                  ? { label: 'Pagado', icon: 'card-outline' as const, tone: 'paid' as const }
                  : { label: '—', icon: 'help-circle-outline' as const, tone: 'pending' as const };
        return (
          <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
            <View style={[styles.quoteCard, badge.tone === 'accepted' && styles.quoteCardAccepted, badge.tone === 'rejected' && styles.quoteCardRejected, badge.tone === 'paid' && styles.quoteCardPaid]}>
              <View style={styles.quoteTopRow}>
                <Text style={styles.quoteTitle}>Presupuesto</Text>
                <View style={[styles.quoteBadge, badge.tone === 'accepted' && styles.quoteBadgeAccepted, badge.tone === 'rejected' && styles.quoteBadgeRejected, badge.tone === 'paid' && styles.quoteBadgePaid]}>
                  <Ionicons name={badge.icon} size={14} color={colors.text} />
                  <Text style={styles.quoteBadgeText}>{badge.label}</Text>
                </View>
              </View>
              {q ? (
                <>
                  {q.service_detail?.trim() ? (
                    <Text style={styles.quoteDetail} numberOfLines={6}>
                      {q.service_detail.trim()}
                    </Text>
                  ) : null}

                  {myRole === 'trabajador' ? (
                    <Text style={styles.quoteLine}>
                      Neto (lo que cobrás): <Text style={styles.quoteStrong}>{formatMoney(q.net_amount)}</Text>
                    </Text>
                  ) : null}

                  <Text style={styles.quoteLine}>
                    Precio final: <Text style={styles.quoteStrong}>{formatMoney(q.final_amount)}</Text>
                  </Text>

                  {participants?.myRole === 'cliente' && q.status === 'pending' ? (
                    <View style={styles.quoteActions}>
                      <Pressable
                        style={({ pressed }) => [styles.quoteBtn, styles.quoteBtnGhost, pressed && styles.pressed]}
                        onPress={() => {
                          if (quoteBusy !== 'none') return;
                          setQuoteBusy('rejected');
                          void (async () => {
                            try {
                              const sb = (await import('../../lib/supabase')).getSupabaseClient();
                              const { error } = await sb
                                .from('chat_quotes')
                                .update({ status: 'rejected', rejected_at: new Date().toISOString() })
                                .eq('id', q.id);
                              if (error) throw error;
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'No se pudo rechazar', 'Presupuesto');
                            } finally {
                              setQuoteBusy('none');
                            }
                          })();
                        }}
                      >
                        <Text style={styles.quoteBtnGhostText}>Rechazar</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.quoteBtn, styles.quoteBtnPrimary, pressed && styles.pressed]}
                        onPress={() => {
                          if (quoteBusy !== 'none') return;
                          setQuoteBusy('accepted');
                          void (async () => {
                            try {
                              await acceptQuoteCreateJob(q.id);
                              toast.success('Cotización aceptada. Trabajo creado.', 'Trabajo');
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'No se pudo aceptar', 'Presupuesto');
                            } finally {
                              setQuoteBusy('none');
                            }
                          })();
                        }}
                      >
                        <Text style={styles.quoteBtnPrimaryText}>Aceptar</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {participants?.myRole === 'trabajador' &&
                  q.status === 'rejected' &&
                  !hasActiveQuote &&
                  latestRejected?.id === q.id &&
                  latestQuoteAny?.id === q.id ? (
                    <Pressable
                      style={({ pressed }) => [styles.quoteBtn, styles.quoteBtnPrimary, pressed && styles.pressed]}
                      onPress={() => {
                        setQuoteModalOpen(true);
                        setQuoteNetAmount(Math.max(0, Math.floor(Number(q.net_amount) || 0)));
                        setQuoteNetText(String(Math.max(0, Math.floor(Number(q.net_amount) || 0))));
                        setQuoteDetail(q.service_detail ?? '');
                        setReplacesQuoteId(q.id);
                      }}
                    >
                      <Text style={styles.quoteBtnPrimaryText}>Recotizar</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Text style={styles.quoteLine}>Cargando presupuesto…</Text>
              )}
              <Text style={styles.quoteMeta}>{formatTime(item.created_at)}</Text>
            </View>
          </View>
        );
      }
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
              {mine ? (
                item.status === 'failed' ? (
                  <Text style={styles.failed}>No enviado</Text>
                ) : item.status === 'sending' ? (
                  <Text style={[styles.tick, styles.tickMine]}>✓</Text>
                ) : (
                  <Text
                    style={[
                      styles.tick,
                      seenByPeer ? styles.tickSeen : styles.tickMine,
                    ]}
                  >
                    ✓✓
                  </Text>
                )
              ) : null}
            </View>
          </View>
        </View>
      );
    },
    [formatMoney, myId, participants?.myRole, peerReadAt, quoteBusy, quoteById, toast],
  );

  // KAV: compensar solo el header del stack. La tab bar es bottom (no entra en el offset del teclado)
  // y en Android ya estamos en `softwareKeyboardLayoutMode: resize`.
  const keyboardVerticalOffset = useMemo(() => {
    const h = Number(headerHeight) || 0;
    return Math.max(0, Math.round(h));
  }, [headerHeight]);

  const renderContenidoChat = () => (
    <View style={styles.flex}>
      <View style={styles.flex}>
        <View style={styles.flex}>
          <Modal
            visible={quoteModalOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setQuoteModalOpen(false)}
          >
            <AppKeyboardAvoidingView style={styles.flex} keyboardVerticalOffset={0}>
              <Pressable style={styles.modalBackdrop} onPress={() => setQuoteModalOpen(false)}>
                <Pressable
                  style={[styles.modalCard, { paddingBottom: spacing.lg + Math.max(insets.bottom, 0) }]}
                  onPress={() => {}}
                >
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.modalScrollContent}
                  >
                    <Text style={styles.modalTitle}>Cotizar</Text>
                    <Text style={styles.modalText}>
                      Ingresá el monto neto que querés cobrar. El precio final se calcula con comisión del 20%.
                    </Text>

                    <Text style={styles.fieldLabel}>Monto neto</Text>
                    <TextInput
                      value={quoteNetText}
                      onChangeText={onChangeQuoteNetText}
                      placeholder="0"
                      keyboardType="number-pad"
                      inputMode="numeric"
                      returnKeyType="done"
                      style={styles.quoteInput}
                      placeholderTextColor={colors.textSecondary}
                    />

                    <View style={styles.quotePreviewRow}>
                      <Text style={styles.quotePreviewLabel}>Neto (lo que cobrás)</Text>
                      <Text style={styles.quotePreviewValue}>{quoteNetDisplay}</Text>
                    </View>

                    <View style={styles.quotePreviewRow}>
                      <Text style={styles.quotePreviewLabel}>Precio final</Text>
                      <Text style={styles.quotePreviewValue}>{formatMoney(quoteFinalPreview || 0)}</Text>
                    </View>

                    <Text style={styles.fieldLabel}>Detalle del servicio</Text>
                    <TextInput
                      value={quoteDetail}
                      onChangeText={setQuoteDetail}
                      placeholder="Ej: instalación + materiales, tiempos, condiciones…"
                      placeholderTextColor={colors.textSecondary}
                      style={styles.quoteDetailInput}
                      multiline
                      maxLength={1200}
                    />

                    <View style={styles.modalActions}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.modalBtn,
                          styles.modalBtnGhost,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => setQuoteModalOpen(false)}
                      >
                        <Text style={styles.modalBtnGhostText}>Cancelar</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.modalBtn,
                          styles.modalBtnPrimary,
                          (quoteNetNum <= 0 ||
                            quoteSubmitting ||
                            !participants ||
                            participants.myRole !== 'trabajador') &&
                            styles.modalBtnDisabled,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => {
                          if (!participants || participants.myRole !== 'trabajador') return;
                          if (quoteNetNum <= 0) return;
                          if (quoteSubmitting) return;
                          setQuoteSubmitting(true);
                          void (async () => {
                            try {
                              const q = await createQuote({
                                conversationId,
                                workerId: participants.workerId,
                                clientId: participants.clientId,
                                netAmount: quoteNetNum,
                                feeRate,
                                serviceDetail: quoteDetail,
                                replacesQuoteId,
                              });
                              await sendMessageSupabase(conversationId, 'Presupuesto', 'budget', {
                                quoteId: q.id,
                                serviceDetail: quoteDetail.trim(),
                              });
                              setQuoteModalOpen(false);
                              setQuoteNetAmount(0);
                              setQuoteNetText('');
                              setQuoteDetail('');
                              setReplacesQuoteId(null);
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'No se pudo cotizar', 'Presupuesto');
                            } finally {
                              setQuoteSubmitting(false);
                            }
                          })();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Enviar presupuesto"
                        disabled={
                          quoteNetNum <= 0 ||
                          quoteSubmitting ||
                          !participants ||
                          participants.myRole !== 'trabajador'
                        }
                      >
                        <Text style={styles.modalBtnPrimaryText}>Enviar</Text>
                      </Pressable>
                    </View>
                  </ScrollView>
                </Pressable>
              </Pressable>
            </AppKeyboardAvoidingView>
          </Modal>

          <Modal
            visible={confirmDelete}
            transparent
            animationType="fade"
            onRequestClose={() => setConfirmDelete(false)}
          >
            <Pressable style={styles.modalBackdrop} onPress={() => setConfirmDelete(false)}>
              <Pressable style={styles.modalCard} onPress={() => {}}>
                <Text style={styles.modalTitle}>Quitar chat</Text>
                <Text style={styles.modalText}>
                  Se quitará de tu lista el chat con {displayName}. La otra persona lo seguirá viendo.
                </Text>
                <View style={styles.modalActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.modalBtn,
                      styles.modalBtnGhost,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    <Text style={styles.modalBtnGhostText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.modalBtn,
                      styles.modalBtnDanger,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => {
                      if (!myId || deleting) return;
                      Alert.alert(
                        'Quitar chat',
                        '¿Querés quitar este chat de tu lista? La otra persona lo seguirá viendo.',
                        [
                          { text: 'Cancelar', style: 'cancel' },
                          {
                            text: 'Quitar',
                            style: 'destructive',
                            onPress: () => {
                              setConfirmDelete(false);
                              setDeleting(true);
                              void (async () => {
                                try {
                                  await deleteConversation(myId, conversationId);
                                  await refreshUnread();
                                  toast.success('Chat quitado.', 'Mensajes');
                                  navigation.goBack();
                                } catch (e) {
                                  console.error('[delete chat:detail]', e);
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

          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <View style={styles.headerTitleBlock}>
                {workerId ? (
                  <Pressable
                    onPress={() => navigation.navigate('WorkerProfile', { workerId, conversationId })}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver perfil de ${displayName}`}
                    hitSlop={10}
                  >
                    <Text style={[styles.headerName, styles.headerNameLink]}>{displayName}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.headerName}>{displayName}</Text>
                )}
              </View>
              <View style={styles.headerActions}>
                {isSupabaseConfigured() && participants?.myRole === 'trabajador' ? (
                  <Pressable
                    onPress={() => {
                      if (hasActiveJob) {
                        toast.warning('Ya hay un trabajo activo en este chat.', 'Trabajo');
                        return;
                      }
                      setQuoteModalOpen(true);
                      setReplacesQuoteId(null);
                      setQuoteNetAmount(0);
                      setQuoteNetText('');
                      setQuoteDetail('');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Cotizar"
                    hitSlop={10}
                    style={({ pressed }) => [
                      styles.quoteHeaderBtn,
                      hasActiveJob && styles.modalBtnDisabled,
                      pressed && styles.pressed,
                    ]}
                    disabled={hasActiveJob}
                  >
                    <Ionicons name="calculator-outline" size={18} color={colors.text} />
                    <Text style={styles.quoteHeaderBtnText}>Cotizar</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => setConfirmDelete(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Eliminar chat"
                  hitSlop={10}
                  style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>

            <View style={styles.headerBottomRow}>
              {headerSubtitle ? <Text style={styles.headerTrade}>{headerSubtitle}</Text> : null}
              {!isSupabaseConfigured() && !connected ? <Text style={styles.headerWarn}>Reconectando…</Text> : null}
            </View>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : reviewFocused ? (
            <View style={styles.reviewFocusSpacer} />
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              style={styles.list}
              initialNumToRender={18}
              maxToRenderPerBatch={24}
              windowSize={10}
              removeClippedSubviews={Platform.OS === 'android'}
              contentContainerStyle={[
                styles.listContent,
                messages.length === 0 && styles.listEmpty,
                { paddingBottom: spacing.sm },
              ]}
              onContentSizeChange={scrollToEnd}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Escribí un mensaje para iniciar el contacto</Text>
              }
              keyboardShouldPersistTaps="handled"
            />
          )}

          {isSupabaseConfigured() && showPay && job ? (
            <View style={styles.payBar}>
              <View style={styles.payBarText}>
                <Text style={styles.payTitle}>Trabajo creado</Text>
                <Text style={styles.paySubtitle}>Total: {formatMoney(job.amount)}</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.payBtn, pressed && styles.pressed]}
                onPress={() => {
                  Alert.alert(
                    'Confirmar pago',
                    `Vas a confirmar el pago de ${formatMoney(job.amount)}.`,
                    [
                      { text: 'Cancelar', style: 'cancel' },
                      {
                        text: 'Pagar',
                        onPress: () => {
                          if (quoteBusy !== 'none') return;
                          setQuoteBusy('paid');
                          void processPayment(job.id)
                            .catch((e) => {
                              toast.error(
                                e instanceof Error ? e.message : 'No se pudo confirmar pago',
                                'Pago',
                              );
                            })
                            .finally(() => setQuoteBusy('none'));
                        },
                      },
                    ],
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel="Pagar"
              >
                <Text style={styles.payBtnText}>Pagar</Text>
              </Pressable>
            </View>
          ) : null}

          {isSupabaseConfigured() && showComplete && job ? (
            <View style={styles.completeBar}>
              <View style={styles.payBarText}>
                <Text style={styles.payTitle}>Pago confirmado</Text>
                <Text style={styles.paySubtitle}>Cuando termines el trabajo, marcá como realizado.</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.payBtn, pressed && styles.pressed]}
                onPress={() => {
                  if (quoteBusy !== 'none') return;
                  setQuoteBusy('paid');
                  void completeJob(job.id)
                    .then(() => {
                      setJob((prev) =>
                        prev
                          ? {
                              ...prev,
                              work_status: 'COMPLETED_BY_WORKER',
                              completed_by_worker_at: new Date().toISOString(),
                            }
                          : prev,
                      );
                    })
                    .catch((e) => {
                      toast.error(e instanceof Error ? e.message : 'No se pudo completar', 'Servicio');
                    })
                    .finally(() => setQuoteBusy('none'));
                }}
                accessibilityRole="button"
                accessibilityLabel="Marcar realizado"
              >
                <Text style={styles.payBtnText}>Realizado</Text>
              </Pressable>
            </View>
          ) : null}

          {isSupabaseConfigured() && showReviewForm && job && participants?.myRole === 'cliente' ? (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Dejá tu reseña</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setReviewRating(n)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${n} estrellas`}
                  >
                    <Ionicons
                      name={n <= reviewRating ? 'star' : 'star-outline'}
                      size={22}
                      color={n <= reviewRating ? '#D97706' : colors.textSecondary}
                    />
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={reviewComment}
                onChangeText={setReviewComment}
                placeholder="Contá cómo fue la experiencia…"
                placeholderTextColor={colors.textSecondary}
                style={styles.reviewInput}
                multiline
                maxLength={800}
                onFocus={() => setReviewFocused(true)}
                onBlur={() => setReviewFocused(false)}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.reviewSend,
                  reviewSending && styles.modalBtnDisabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  if (!participants) return;
                  if (reviewSending) return;
                  setReviewSending(true);
                  void (async () => {
                    try {
                      await createReview({
                        conversationId,
                        workerId: participants.workerId,
                        quoteId: job.quote_id,
                        jobId: job.id,
                        rating: reviewRating,
                        comment: reviewComment,
                      });
                      setReviewSubmitted(true);
                      const r = await fetchReviewForJob(job.id);
                      setReview(r);
                      toast.success('¡Gracias por tu reseña!', 'Reseña');
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : 'No se pudo enviar la reseña',
                        'Reseña',
                      );
                    } finally {
                      setReviewSending(false);
                    }
                  })();
                }}
                accessibilityRole="button"
                accessibilityLabel="Enviar reseña"
              >
                <Text style={styles.reviewSendText}>
                  {reviewSending ? 'Enviando…' : 'Enviar reseña'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View
            style={[
              styles.composer,
              Platform.OS === 'android'
                ? { paddingBottom: androidKeyboardOpen ? 10 : 0 }
                : { paddingBottom: Math.max(insets.bottom || 0, spacing.sm) },
            ]}
          >
            {blocked ? (
              <View style={styles.blockedBanner} accessibilityLiveRegion="polite">
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.blockedText}>
                  No compartas datos de contacto (WhatsApp, teléfono, Instagram, emails o links).
                </Text>
              </View>
            ) : null}
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
              style={[
                styles.sendBtn,
                (!input.trim() || sending || Boolean(blocked)) && styles.sendBtnDisabled,
              ]}
              onPress={send}
              disabled={
                !input.trim() ||
                sending ||
                Boolean(blocked) ||
                (!isSupabaseConfigured() && !connected)
              }
            >
              <Ionicons name="send" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );

  const body = (
    <View style={styles.flex}>
      {Platform.OS === 'ios' ? (
        <AppKeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={keyboardVerticalOffset}
          style={styles.flex}
        >
          {renderContenidoChat()}
        </AppKeyboardAvoidingView>
      ) : (
        // EN ANDROID: Un View simple, sin trucos.
        <View style={styles.flex}>{renderContenidoChat()}</View>
      )}
    </View>
  );

  return body;
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
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerBottomRow: { marginTop: 4 },
  headerTitleBlock: { flex: 1, minWidth: 0 },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: { fontSize: 18, fontWeight: '800', color: colors.text },
  headerNameLink: { textDecorationLine: 'underline' },
  headerTrade: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 4 },
  headerWarn: { fontSize: 12, fontWeight: '700', color: colors.primary, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  listEmpty: { justifyContent: 'flex-end' },
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
  tick: { fontSize: 12, fontWeight: '900' },
  tickMine: { color: 'rgba(255,255,255,0.85)' },
  tickSeen: { color: '#34B7F1' },
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
  blockedBanner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: -34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F0F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  blockedText: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
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
  pressed: { opacity: 0.9 },
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
    maxHeight: '86%',
  },
  modalScrollContent: { paddingBottom: spacing.md },
  modalTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  modalText: { marginTop: spacing.sm, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  modalBtnGhost: { borderColor: colors.border, backgroundColor: 'transparent' },
  modalBtnGhostText: { color: colors.text, fontWeight: '800' },
  modalBtnPrimary: { borderColor: colors.primary, backgroundColor: colors.primary },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '900' },
  modalBtnDisabled: { opacity: 0.55 },
  modalBtnDanger: { borderColor: '#DC2626', backgroundColor: '#DC2626' },
  modalBtnDangerText: { color: '#fff', fontWeight: '900' },

  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  quoteHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,24,39,0.10)',
  },
  quoteHeaderBtnText: { fontSize: 13, fontWeight: '800', color: colors.text },

  fieldLabel: { marginTop: spacing.md, fontSize: 12, fontWeight: '900', color: colors.textSecondary },
  quoteInput: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    backgroundColor: colors.background,
  },
  quotePreviewRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(198,40,40,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(198,40,40,0.20)',
  },
  quotePreviewLabel: { fontSize: 13, fontWeight: '900', color: colors.textSecondary },
  quotePreviewValue: { fontSize: 16, fontWeight: '900', color: colors.text },
  quoteDetailInput: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
    minHeight: 90,
    textAlignVertical: 'top',
  },

  quoteCard: {
    width: '92%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  quoteTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  quoteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,24,39,0.14)',
    backgroundColor: 'rgba(17,24,39,0.06)',
  },
  quoteBadgeAccepted: { borderColor: 'rgba(13,148,136,0.35)', backgroundColor: 'rgba(13,148,136,0.10)' },
  quoteBadgeRejected: { borderColor: 'rgba(220,38,38,0.35)', backgroundColor: 'rgba(220,38,38,0.10)' },
  quoteBadgePaid: { borderColor: 'rgba(59,130,246,0.35)', backgroundColor: 'rgba(59,130,246,0.10)' },
  quoteBadgeText: { fontSize: 12, fontWeight: '900', color: colors.text },
  quoteCardAccepted: { borderColor: 'rgba(13,148,136,0.35)' },
  quoteCardRejected: { borderColor: 'rgba(220,38,38,0.35)' },
  quoteCardPaid: { borderColor: 'rgba(59,130,246,0.35)' },
  quoteTitle: { fontSize: 16, fontWeight: '900', color: colors.text, marginBottom: 6 },
  quoteDetail: {
    marginTop: 2,
    marginBottom: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    fontWeight: '600',
  },
  quoteLine: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 4 },
  quoteStrong: { color: colors.text, fontWeight: '900' },
  quoteStatus: { marginTop: spacing.sm, fontSize: 13, fontWeight: '800', color: colors.textSecondary },
  quoteStatusStrong: { color: colors.text, fontWeight: '900' },
  quoteMeta: { marginTop: spacing.sm, fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  quoteActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  quoteBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  quoteBtnGhost: { borderColor: colors.border, backgroundColor: 'transparent' },
  quoteBtnGhostText: { color: colors.text, fontWeight: '900' },
  quoteBtnPrimary: { borderColor: colors.primary, backgroundColor: colors.primary },
  quoteBtnPrimaryText: { color: '#fff', fontWeight: '900' },

  payBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: 'rgba(13,148,136,0.25)',
    backgroundColor: 'rgba(13,148,136,0.08)',
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  completeBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.22)',
    backgroundColor: 'rgba(59,130,246,0.07)',
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  payBarText: { flex: 1, minWidth: 0 },
  payTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  paySubtitle: { marginTop: 3, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  payBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  payBtnText: { color: '#fff', fontWeight: '900' },

  reviewCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  reviewTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
  starsRow: { flexDirection: 'row', gap: 6, marginTop: spacing.sm },
  reviewInput: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
    minHeight: 74,
  },
  reviewSend: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  reviewSendText: { color: '#fff', fontWeight: '900' },

  reviewFocusSpacer: { flex: 1, minHeight: 10 },
});
