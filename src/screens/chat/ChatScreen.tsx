import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { ExpandableText } from '../../components/common/ExpandableText';
import { useAppToast } from '../../components/toast/toast';
import { isSupabaseConfigured } from '../../config/supabase';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useFeed } from '../../context/FeedContext';
import { useSocket } from '../../context/SocketContext';
import { useUnreadMessages } from '../../context/UnreadMessagesContext';
import { fetchConversationReads } from '../../services/conversationReadsSupabase';
import { sendMessageSupabase } from '../../services/chatSupabase';
import {
  IMAGE_BODY_PREVIEW,
  sendChatImageMessageSupabase,
} from '../../services/chatMediaSupabase';
import { ChatReportUserModal } from '../../components/chat/ChatReportUserModal';
import { ChatSafetyOptionsModal } from '../../components/chat/ChatSafetyOptionsModal';
import {
  blockUserInSupabase,
  fetchPeerBlockStatus,
  reportUserInSupabase,
  type ChatReportReasonCode,
  type PeerBlockStatus,
  unblockUserInSupabase,
} from '../../services/chatSecuritySupabase';
import { deleteConversation, loadMessages, subscribeChatMessages } from '../../services/messaging';
import {
  COMISION_APP_RATE,
  computeFinalAmount,
  createQuote,
  createReview,
  fetchConversationParticipants,
  fetchQuotesByConversation,
  fetchReviewForConversation,
  fetchReviewForJob,
  chatQuoteFromMessageMetadata,
  rechazarPrecioCotizado,
  subscribeQuotes,
  type ChatQuote,
  type QuoteStatus,
} from '../../services/quotesSupabase';
import {
  completeJob,
  fetchLatestJobByConversation,
  subscribeJobsByConversation,
  type ServiceJob,
} from '../../services/serviceJobsSupabase';
import { AgendaOpcionesCliente } from '../../components/servicios/AgendaOpcionesCliente';
import {
  aceptarDisponibilidadOpcion,
  aceptarPrecioCotizado,
  clienteNotificarPagoOffline,
  trabajadorConfirmarRecepcionOffline,
  fetchDisponibilidadOpciones,
  obtenerPinCliente,
  rechazarDisponibilidad,
} from '../../services/contratacionesSupabase';
import {
  fetchClosedClaimChatIds,
  subscribeClaimChatLock,
} from '../../services/claimChatSupabase';
import type { DisponibilidadOpcion } from '../../types/contrataciones';
import { isMercadoPagoEnabled } from '../../config/mercadoPago';
import { openPagoCheckout } from '../../navigation/openPagoCheckout';
import { crearPreferenciaSeña, sincronizarSeñaSiPendiente } from '../../services/pagosMercadoPago';
import { computeSaldoPendiente } from '../../types/contrataciones';
import { ESTADOS_PUEDEN_NOTIFICAR_SALDO } from '../../utils/contratacionStatus';
import {
  CHAT_CERRADO_POR_RECLAMO,
  CHAT_CERRADO_POR_RECLAMO_DETALLE,
} from '../../utils/claimChatVisibility';
import { getSystemEvent, shouldRenderSystemMessageInChat } from '../../utils/chatSystemMessages';
import { newRandomUserId } from '../../utils/stableUserId';
import { mapChatSendError } from '../../utils/chatErrors';
import {
  CONTACT_MODERATION_POLICY_MESSAGE,
  validateContactInfo,
} from '../../utils/contactModeration';
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
  type?: 'text' | 'budget' | 'quotation' | 'system' | 'image';
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
  const s = (name ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return 'Usuario';
  const parts = s.split(' ').filter(Boolean);
  return parts[0] ?? 'Usuario';
}

/** Lista invertida: mensajes más nuevos al inicio del array (índice 0 = abajo en pantalla). */
function mergeIncomingMessage(prev: UiMessage[], msg: UiMessage): UiMessage[] {
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
  return [{ ...msg, optimistic: false }, ...prev];
}

function patchUpdatedMessage(prev: UiMessage[], msg: UiMessage): UiMessage[] {
  const i = prev.findIndex((p) => p.id === msg.id);
  if (i < 0) return mergeIncomingMessage(prev, msg);
  const next = [...prev];
  next[i] = {
    ...next[i],
    ...msg,
    text: msg.text ?? next[i].text,
    metadata: msg.metadata ?? next[i].metadata,
    optimistic: false,
  };
  return next;
}

function normalizeMessageMetadata(
  metadata: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  return metadata;
}

function materialQuoteRequestKey(meta: Record<string, unknown>): string {
  return String(
    meta.request_id ?? meta.materialListId ?? meta.requestId ?? '',
  ).trim();
}

function isMaterialQuoteMessage(m: {
  type?: string;
  metadata?: Record<string, unknown> | string | null;
}): { meta: Record<string, unknown>; requestKey: string } | null {
  const meta = normalizeMessageMetadata(m.metadata);
  if (meta.hidden === true || meta.hidden === 'true') return null;
  const kind = String(meta.kind ?? '').trim();
  if (kind !== 'material_quote') return null;
  if (m.type && m.type !== 'quotation' && m.type !== 'budget') return null;
  return { meta, requestKey: materialQuoteRequestKey(meta) };
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
  const { user } = useAuth();
  const { refresh: refreshFeed, updateWorkerRatings } = useFeed();

  /** KAV debajo del SafeArea top: no sumar insets.top otra vez (evita hueco sobre teclado). */
  const keyboardVerticalOffset = Platform.OS === 'ios' ? 48 : 0;
  const toast = useAppToast();
  const {
    markConversationRead,
    setActiveConversationId,
    reconcileInboxFromServer,
    ingestInboxMessage,
  } = useUnreadMessages();
  const { socket, connected } = useSocket();
  const listRef = useRef<FlatList<UiMessage>>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachingImage, setAttachingImage] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [participants, setParticipants] = useState<{
    clientId: string;
    workerId: string;
    myRole: 'cliente' | 'trabajador';
  } | null>(null);
  const [blockStatus, setBlockStatus] = useState<PeerBlockStatus>({
    iBlockedThem: false,
    theyBlockedMe: false,
  });
  const [blockStatusLoading, setBlockStatusLoading] = useState(false);
  const [safetyMenuOpen, setSafetyMenuOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [blockActionBusy, setBlockActionBusy] = useState(false);

  const myId = user?.id ?? '';
  const displayName = useMemo(() => firstNameOnly(otherDisplayName), [otherDisplayName]);

  const inputModeration = useMemo(() => validateContactInfo(input), [input]);

  const otherUserId = useMemo(() => {
    if (!participants) return null;
    return participants.myRole === 'cliente' ? participants.workerId : participants.clientId;
  }, [participants]);

  const chatBlocked = blockStatus.iBlockedThem || blockStatus.theyBlockedMe;
  const [chatClosedByClaim, setChatClosedByClaim] = useState(false);
  const [claimLockLoading, setClaimLockLoading] = useState(() => isSupabaseConfigured());

  const refreshBlockStatus = useCallback(async () => {
    if (!otherUserId || !isSupabaseConfigured()) {
      setBlockStatus({ iBlockedThem: false, theyBlockedMe: false });
      return;
    }
    setBlockStatusLoading(true);
    try {
      const status = await fetchPeerBlockStatus(otherUserId);
      setBlockStatus(status);
    } catch {
      setBlockStatus({ iBlockedThem: false, theyBlockedMe: false });
    } finally {
      setBlockStatusLoading(false);
    }
  }, [otherUserId]);

  useEffect(() => {
    void refreshBlockStatus();
  }, [refreshBlockStatus]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !conversationId) {
      setChatClosedByClaim(false);
      setClaimLockLoading(false);
      return;
    }
    let cancelled = false;
    setClaimLockLoading(true);
    void fetchClosedClaimChatIds([conversationId])
      .then((ids) => {
        if (!cancelled) setChatClosedByClaim(ids.has(conversationId));
      })
      .catch(() => {
        if (!cancelled) setChatClosedByClaim(false);
      })
      .finally(() => {
        if (!cancelled) setClaimLockLoading(false);
      });
    const unsub = subscribeClaimChatLock(conversationId, (closed) => {
      if (!cancelled) setChatClosedByClaim(closed);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [conversationId]);

  const handleBlockUser = useCallback(() => {
    if (!otherUserId) return;
    Alert.alert(
      'Bloquear usuario',
      'No vas a poder enviarle mensajes. Podés desbloquearlo cuando quieras desde este chat.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Bloquear',
          style: 'destructive',
          onPress: () => {
            setBlockActionBusy(true);
            void (async () => {
              try {
                await blockUserInSupabase(otherUserId);
                setBlockStatus({ iBlockedThem: true, theyBlockedMe: false });
                toast.success('Usuario bloqueado.', 'Listo');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'No se pudo bloquear', 'Bloqueo');
              } finally {
                setBlockActionBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [otherUserId, toast]);

  const handleUnblockUser = useCallback(() => {
    if (!otherUserId) return;
    setBlockActionBusy(true);
    void (async () => {
      try {
        await unblockUserInSupabase(otherUserId);
        setBlockStatus({ iBlockedThem: false, theyBlockedMe: false });
        toast.success('Usuario desbloqueado.', 'Listo');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudo desbloquear', 'Desbloqueo');
      } finally {
        setBlockActionBusy(false);
      }
    })();
  }, [otherUserId, toast]);

  const handleSubmitReport = useCallback(
    (reasonCode: ChatReportReasonCode) => {
      if (!otherUserId) return;
      setReportSubmitting(true);
      void (async () => {
        try {
          await reportUserInSupabase({
            reportedUserId: otherUserId,
            conversationId,
            reason: reasonCode,
          });
          setReportModalOpen(false);
          toast.success('Reporte enviado. Lo revisaremos.', 'Gracias');
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'No se pudo enviar el reporte', 'Reporte');
        } finally {
          setReportSubmitting(false);
        }
      })();
    },
    [conversationId, otherUserId, toast],
  );

  const profileWorkerId = useMemo(() => {
    if (workerId) return workerId;
    if (participants?.myRole === 'cliente') return participants.workerId;
    return null;
  }, [workerId, participants]);

  const openWorkerProfile = useCallback(() => {
    const id = profileWorkerId;
    if (!id) {
      toast.warning('No se pudo abrir el perfil del profesional.', 'Perfil');
      return;
    }
    navigation.navigate('WorkerProfile', { workerId: id, conversationId });
  }, [conversationId, navigation, profileWorkerId, toast]);

  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [quoteBusy, setQuoteBusy] = useState<QuoteStatus | 'none'>('none');
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteNetAmount, setQuoteNetAmount] = useState(0);
  const [quoteNetText, setQuoteNetText] = useState('');
  const [quoteDetail, setQuoteDetail] = useState('');
  const quoteDetailModeration = useMemo(() => validateContactInfo(quoteDetail), [quoteDetail]);
  const [replacesQuoteId, setReplacesQuoteId] = useState<string | null>(null);
  const [job, setJob] = useState<ServiceJob | null>(null);
  const [clientPin, setClientPin] = useState<string | null>(null);
  const [review, setReview] = useState<Awaited<ReturnType<typeof fetchReviewForJob>>>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSending, setReviewSending] = useState(false);
  const [reviewFocused, setReviewFocused] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [agendaOpciones, setAgendaOpciones] = useState<DisponibilidadOpcion[]>([]);
  const [agendaBusy, setAgendaBusy] = useState(false);
  const [saldoBusy, setSaldoBusy] = useState(false);
  const jobRef = useRef(job);
  const participantsRef = useRef(participants);
  jobRef.current = job;
  participantsRef.current = participants;

  const feeRate = COMISION_APP_RATE;
  const quoteNetNum = useMemo(() => Math.max(0, Math.floor(quoteNetAmount)), [quoteNetAmount]);
  const quoteFinalPreview = useMemo(
    () => computeFinalAmount(quoteNetNum, feeRate),
    [quoteNetNum, feeRate],
  );
  const quoteFeePreview = useMemo(
    () => Math.max(0, quoteFinalPreview - quoteNetNum),
    [quoteFinalPreview, quoteNetNum],
  );

  const quoteById = useMemo(() => {
    const m = new Map<string, ChatQuote>();
    for (const q of quotes) m.set(q.id, q);
    return m;
  }, [quotes]);

  const canPaySeña = Boolean(
    job &&
      participants?.myRole === 'cliente' &&
      job.payment_status === 'PENDING' &&
      (job.estado_trabajo === 'aceptado' ||
        job.estado_trabajo === 'en_curso' ||
        job.estado_trabajo === 'pendiente_pago_diferencia'),
  );
  const showPay = canPaySeña;
  const showClientPinBar = Boolean(
    job &&
      participants?.myRole === 'cliente' &&
      job.payment_status === 'PAID' &&
      job.estado_trabajo === 'aceptado',
  );
  const showWorkerAvailabilityBar = Boolean(
    job &&
      participants?.myRole === 'trabajador' &&
      job.estado_trabajo === 'precio_aceptado' &&
      agendaOpciones.length === 0,
  );
  const showWorkerAgendaSentBar = Boolean(
    job &&
      participants?.myRole === 'trabajador' &&
      job.estado_trabajo === 'precio_aceptado' &&
      agendaOpciones.length > 0,
  );
  const showClientWaitingAvailabilityBar = Boolean(
    job &&
      participants?.myRole === 'cliente' &&
      job.estado_trabajo === 'precio_aceptado' &&
      agendaOpciones.length === 0,
  );
  const showClientAgendaBar = Boolean(
    job &&
      participants?.myRole === 'cliente' &&
      job.estado_trabajo === 'precio_aceptado' &&
      agendaOpciones.length > 0,
  );
  const showWorkerJobBar = Boolean(
    job &&
      participants?.myRole === 'trabajador' &&
      job.estado_trabajo === 'en_curso' &&
      job.payment_status === 'PAID' &&
      !showWorkerAvailabilityBar &&
      !showWorkerAgendaSentBar,
  );
  const showWorkerSeñaPagadaBar = Boolean(
    job &&
      participants?.myRole === 'trabajador' &&
      job.estado_trabajo === 'aceptado' &&
      job.payment_status === 'PAID' &&
      !showWorkerAvailabilityBar &&
      !showWorkerAgendaSentBar,
  );
  const workerJobPaid = Boolean(job?.payment_status === 'PAID');
  const saldoPendiente = job ? computeSaldoPendiente(job.amount, job.seña) : 0;
  const showClientSaldoPagadoBar = Boolean(
    job &&
      participants?.myRole === 'cliente' &&
      ESTADOS_PUEDEN_NOTIFICAR_SALDO.includes(job.estado_trabajo) &&
      job.estado_pago === 'seña_pagada' &&
      !job.offline_pago_notificado_at &&
      saldoPendiente > 0,
  );
  const showClientSaldoEsperandoBar = Boolean(
    job &&
      participants?.myRole === 'cliente' &&
      ESTADOS_PUEDEN_NOTIFICAR_SALDO.includes(job.estado_trabajo) &&
      job.offline_pago_notificado_at &&
      job.estado_pago === 'seña_pagada',
  );
  const showWorkerSaldoRecibidoBar = Boolean(
    job &&
      participants?.myRole === 'trabajador' &&
      ESTADOS_PUEDEN_NOTIFICAR_SALDO.includes(job.estado_trabajo) &&
      job.offline_pago_notificado_at &&
      job.estado_pago === 'seña_pagada',
  );
  const showReviewForm = Boolean(
    job &&
      participants?.myRole === 'cliente' &&
      job.estado_trabajo === 'finalizado' &&
      !reviewSubmitted &&
      !review,
  );

  useEffect(() => {
    if (!showClientPinBar || !job?.id) {
      setClientPin(null);
      return;
    }
    let cancelled = false;
    void obtenerPinCliente(job.id)
      .then((pin) => {
        if (!cancelled) setClientPin(pin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showClientPinBar, job?.id, job?.payment_status]);

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
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    [],
  );
  const formatMoney = useCallback(
    (n: number) =>
      `$${currency.format(Math.max(0, Math.ceil(Number(n) || 0)))}`,
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

  // Para evitar duplicidad visual: si estamos dentro del chat en foreground,
  // suprimimos el alert del push para esta conversación.
  // Al enfocar el chat siempre refrescamos el job (p. ej. saldo notificado offline).
  useFocusEffect(
    useCallback(() => {
      setActiveConversationForNotifications(conversationId);
      if (isSupabaseConfigured() && conversationId) {
        void fetchLatestJobByConversation(conversationId)
          .then((j) => {
            if (j) setJob(j);
          })
          .catch(() => {});
      }
      if (job?.id && job.payment_status === 'PENDING') {
        void sincronizarSeñaSiPendiente(job.id).then((ok) => {
          if (!ok) return;
          void fetchLatestJobByConversation(conversationId).then((j) => {
            if (j) setJob(j);
          });
        });
      }
      return () => setActiveConversationForNotifications(null);
    }, [conversationId, job?.id, job?.payment_status]),
  );

  /** Con `inverted`, el último mensaje está en el índice 0 (offset 0). */
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!myId || !conversationId) return;
    try {
      const rows = await loadMessages(myId, conversationId);
      setMessages(rows.map((r) => ({ ...r, optimistic: false })));
    } catch {
      /* */
    }
  }, [conversationId, myId]);

  const refreshQuotes = useCallback(async () => {
    if (!conversationId) return;
    try {
      const rows = await fetchQuotesByConversation(conversationId);
      setQuotes(rows);
    } catch {
      /* */
    }
  }, [conversationId]);

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
        if (!c) {
          toast.warning('No tenés acceso a este chat.', 'Chat');
          navigation.goBack();
          return;
        }
        const myRole = c.cliente_id === myId ? 'cliente' : 'trabajador';
        setParticipants({
          clientId: c.cliente_id,
          workerId: c.trabajador_id,
          myRole,
        });
      } catch {
        if (!cancelled) {
          toast.warning('No se pudo abrir este chat.', 'Chat');
          navigation.goBack();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, myId, navigation, toast]);

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
      void fetchLatestJobByConversation(conversationId).then((j) => {
        if (j) setJob(j);
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [conversationId]);

  useEffect(() => {
    if (!showPay || !job?.id || !conversationId) return;
    const contratacionId = job.id;
    const sync = () => {
      void sincronizarSeñaSiPendiente(contratacionId).then((ok) => {
        if (!ok) return;
        void fetchLatestJobByConversation(conversationId).then((j) => {
          if (j) setJob(j);
        });
        void refreshMessages();
      });
    };
    sync();
    const timer = setInterval(sync, 3000);
    return () => clearInterval(timer);
  }, [showPay, job?.id, conversationId, refreshMessages]);

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
        if (prev.id !== j.id) {
          const prevTs = new Date(prev.updated_at).getTime();
          const nextTs = new Date(j.updated_at).getTime();
          if (Number.isFinite(nextTs) && Number.isFinite(prevTs) && nextTs < prevTs) return prev;
          return j;
        }
        // Mismo job: preferir snapshot más nuevo; si updated_at es inválido, aceptar el upsert
        // (evita perder offline_pago_notificado_at por payload realtime incompleto).
        const prevTs = new Date(prev.updated_at).getTime();
        const nextTs = new Date(j.updated_at).getTime();
        if (!Number.isFinite(nextTs) || !Number.isFinite(prevTs) || nextTs >= prevTs) {
          return {
            ...prev,
            ...j,
            offline_pago_notificado_at:
              j.offline_pago_notificado_at ?? prev.offline_pago_notificado_at,
            offline_pago_confirmado_at:
              j.offline_pago_confirmado_at ?? prev.offline_pago_confirmado_at,
          };
        }
        return prev;
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [conversationId]);

  const visibleMessages = useMemo(() => {
    const filtered = messages.filter((m) => {
      const meta = normalizeMessageMetadata(m.metadata);
      if (
        String(meta.kind ?? '') === 'material_quote' &&
        (meta.hidden === true || meta.hidden === 'true')
      ) {
        return false;
      }
      // Evita CTA suelto legado ("Ver cotizaciones") fuera de la tarjeta quotation.
      const body = String(m.text ?? '').trim().toLowerCase();
      if (
        (m.type === 'text' || !m.type) &&
        (body === 'ver cotizaciones' || body === 'lista de materiales')
      ) {
        return false;
      }
      if (m.type !== 'system') return true;
      return shouldRenderSystemMessageInChat(meta, participants?.myRole ?? null);
    });

    // Varias cotizaciones del mismo pedido → UNA tarjeta.
    // Agrupa por request_id; si falta, por quote_id (legado) y enriquece conteos.
    type Bucket = {
      keep: (typeof filtered)[number];
      storeIds: Set<string>;
      quoteIds: Set<string>;
      quoteCountMeta: number;
      storeCountMeta: number;
    };
    const buckets = new Map<string, Bucket>();

    for (const m of filtered) {
      const parsed = isMaterialQuoteMessage(m);
      if (!parsed) continue;
      const { meta } = parsed;
      let key = parsed.requestKey;
      if (!key) {
        const qid = String(meta.quote_id ?? meta.quoteId ?? '').trim();
        key = qid ? `quote:${qid}` : `msg:${m.id}`;
      }
      const storeId = String(meta.store_id ?? meta.storeId ?? '').trim();
      const quoteId = String(meta.quote_id ?? meta.quoteId ?? '').trim();
      const quoteCountMeta = Number(meta.quoteCount ?? meta.quote_count) || 0;
      const storeCountMeta = Number(meta.storeCount ?? meta.store_count) || 0;

      const prev = buckets.get(key);
      if (!prev) {
        buckets.set(key, {
          keep: m,
          storeIds: new Set(storeId ? [storeId] : []),
          quoteIds: new Set(quoteId ? [quoteId] : []),
          quoteCountMeta,
          storeCountMeta,
        });
        continue;
      }
      if (storeId) prev.storeIds.add(storeId);
      if (quoteId) prev.quoteIds.add(quoteId);
      prev.quoteCountMeta = Math.max(prev.quoteCountMeta, quoteCountMeta);
      prev.storeCountMeta = Math.max(prev.storeCountMeta, storeCountMeta);
      const tNew = new Date(m.created_at).getTime();
      const tPrev = new Date(prev.keep.created_at).getTime();
      if (tNew > tPrev || (tNew === tPrev && m.id > prev.keep.id)) {
        prev.keep = m;
      }
    }

    // Segunda pasada: si hay buckets con request_id real y buckets quote:* ,
    // no podemos unirlos sin mapa quote→request; el upsert SQL evita nuevos dupes.
    // Si TODOS los material_quote del hilo carecen de request_id pero hay varios,
    // colapsarlos en uno solo (mismo chat = mismo pedido típico).
    const materialKeys = Array.from(buckets.keys());
    const allLackRequest = materialKeys.every(
      (k) => k.startsWith('quote:') || k.startsWith('msg:'),
    );
    if (allLackRequest && materialKeys.length > 1) {
      const merged: Bucket = {
        keep: buckets.get(materialKeys[0])!.keep,
        storeIds: new Set<string>(),
        quoteIds: new Set<string>(),
        quoteCountMeta: 0,
        storeCountMeta: 0,
      };
      for (const k of materialKeys) {
        const b = buckets.get(k)!;
        for (const s of b.storeIds) merged.storeIds.add(s);
        for (const q of b.quoteIds) merged.quoteIds.add(q);
        merged.quoteCountMeta = Math.max(merged.quoteCountMeta, b.quoteCountMeta);
        merged.storeCountMeta = Math.max(merged.storeCountMeta, b.storeCountMeta);
        const tNew = new Date(b.keep.created_at).getTime();
        const tPrev = new Date(merged.keep.created_at).getTime();
        if (tNew > tPrev || (tNew === tPrev && b.keep.id > merged.keep.id)) {
          merged.keep = b.keep;
        }
        buckets.delete(k);
      }
      buckets.set('collapsed:all', merged);
    }

    const enrichedById = new Map<string, UiMessage>();
    for (const bucket of buckets.values()) {
      const meta = {
        ...normalizeMessageMetadata(bucket.keep.metadata),
      };
      const storeCount = Math.max(
        bucket.storeCountMeta,
        bucket.storeIds.size,
        Number(meta.storeCount) || 0,
        1,
      );
      const quoteCount = Math.max(
        bucket.quoteCountMeta,
        bucket.quoteIds.size,
        Number(meta.quoteCount) || 0,
        storeCount,
      );
      meta.storeCount = storeCount;
      meta.quoteCount = quoteCount;
      delete meta.title;
      enrichedById.set(bucket.keep.id, {
        ...bucket.keep,
        metadata: meta,
      });
    }

    const keepIds = new Set(enrichedById.keys());

    return filtered
      .filter((m) => {
        if (!isMaterialQuoteMessage(m)) return true;
        return keepIds.has(m.id);
      })
      .map((m) => enrichedById.get(m.id) ?? m);
  }, [messages, participants?.myRole]);

  const refreshAgendaOpciones = useCallback(async (contratacionId: string) => {
    try {
      const ops = await fetchDisponibilidadOpciones(contratacionId);
      setAgendaOpciones(ops);
    } catch {
      setAgendaOpciones([]);
    }
  }, []);

  useEffect(() => {
    const role = participants?.myRole;
    if (
      !job?.id ||
      job.estado_trabajo !== 'precio_aceptado' ||
      (role !== 'cliente' && role !== 'trabajador')
    ) {
      setAgendaOpciones([]);
      return;
    }
    void refreshAgendaOpciones(job.id);
  }, [job?.id, job?.estado_trabajo, participants?.myRole, refreshAgendaOpciones]);

  useFocusEffect(
    useCallback(() => {
      const role = participants?.myRole;
      if (
        !job?.id ||
        job.estado_trabajo !== 'precio_aceptado' ||
        (role !== 'cliente' && role !== 'trabajador')
      ) {
        return;
      }
      void refreshAgendaOpciones(job.id);
    }, [job?.id, job?.estado_trabajo, participants?.myRole, refreshAgendaOpciones]),
  );

  const handleConfirmAgenda = useCallback(
    (opcionId: string) => {
      if (agendaBusy) return;
      setAgendaBusy(true);
      void (async () => {
        try {
          await aceptarDisponibilidadOpcion(opcionId);
          setAgendaOpciones([]);
          const j = await fetchLatestJobByConversation(conversationId);
          setJob(j);
          await refreshMessages();
          toast.success('Horario confirmado', 'Agenda');
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'No se pudo confirmar', 'Agenda');
        } finally {
          setAgendaBusy(false);
        }
      })();
    },
    [agendaBusy, conversationId, refreshMessages, toast],
  );

  const handleRejectAgenda = useCallback(() => {
    if (agendaBusy || !job?.id) return;
    setAgendaBusy(true);
    void (async () => {
      try {
        await rechazarDisponibilidad(job.id);
        setAgendaOpciones([]);
        await refreshMessages();
        toast.success('Le pedimos otras fechas al profesional', 'Agenda');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudo enviar', 'Agenda');
      } finally {
        setAgendaBusy(false);
      }
    })();
  }, [agendaBusy, job?.id, refreshMessages, toast]);

  const handleSaldoPagadoCliente = useCallback(() => {
    if (saldoBusy || !job?.id) return;
    setSaldoBusy(true);
    void (async () => {
      try {
        await clienteNotificarPagoOffline(job.id);
        const j = await fetchLatestJobByConversation(conversationId);
        if (j) setJob(j);
        await refreshMessages();
        toast.success('Saldo marcado como pagado', 'Pago');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudo registrar el pago', 'Pago');
      } finally {
        setSaldoBusy(false);
      }
    })();
  }, [conversationId, job?.id, refreshMessages, saldoBusy, toast]);

  const runConfirmarSaldoTrabajador = useCallback(() => {
    if (saldoBusy || !job?.id) return;
    setSaldoBusy(true);
    void (async () => {
      try {
        await trabajadorConfirmarRecepcionOffline(job.id);
        const j = await fetchLatestJobByConversation(conversationId);
        if (j) setJob(j);
        await refreshMessages();
        toast.success('Trabajo pagado', 'Pago');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudo confirmar', 'Pago');
      } finally {
        setSaldoBusy(false);
      }
    })();
  }, [conversationId, job?.id, refreshMessages, saldoBusy, toast]);

  const handleConfirmarSaldoTrabajador = useCallback(() => {
    if (saldoBusy || !job?.id) return;
    if (job.estado_trabajo !== 'finalizado') {
      Alert.alert(
        '¿Confirmar pago recibido?',
        'El trabajo aún no está marcado como finalizado. ¿Confirmás que recibiste el pago del saldo?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Sí, confirmar', onPress: runConfirmarSaldoTrabajador },
        ],
      );
      return;
    }
    runConfirmarSaldoTrabajador();
  }, [job?.estado_trabajo, job?.id, runConfirmarSaldoTrabajador, saldoBusy]);

  const runMarcarTrabajoFinalizado = useCallback(() => {
    if (!job?.id || quoteBusy !== 'none') return;
    setQuoteBusy('paid');
    void completeJob(job.id)
      .then(async () => {
        const j = await fetchLatestJobByConversation(conversationId);
        setJob(j);
        await refreshMessages();
        toast.success('Trabajo finalizado', 'Servicio');
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'No se pudo completar', 'Servicio');
      })
      .finally(() => setQuoteBusy('none'));
  }, [conversationId, job?.id, quoteBusy, refreshMessages, toast]);

  const handleMarcarTrabajoFinalizado = useCallback(() => {
    if (!job?.id || quoteBusy !== 'none') return;
    if (job.offline_pago_notificado_at) {
      Alert.alert(
        '¿Marcar trabajo finalizado?',
        'El cliente ya indicó que pagó el saldo. ¿Confirmás que el trabajo está terminado?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Sí, finalizar', onPress: runMarcarTrabajoFinalizado },
        ],
      );
      return;
    }
    runMarcarTrabajoFinalizado();
  }, [job?.id, job?.offline_pago_notificado_at, quoteBusy, runMarcarTrabajoFinalizado]);

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

  useEffect(() => {
    setActiveConversationId(conversationId);
    return () => setActiveConversationId(null);
  }, [conversationId, setActiveConversationId]);

  // Marcar leído al instante (badge footer + fila en lista) y persistir en background.
  useEffect(() => {
    if (!myId || !conversationId) return;
    markConversationRead(conversationId, new Date().toISOString());
  }, [myId, conversationId, markConversationRead]);

  useEffect(() => {
    if (!conversationId || !myId) return;

    if (isSupabaseConfigured()) {
      const unsub = subscribeChatMessages(
        conversationId,
        (msg) => {
          setMessages((prev) => mergeIncomingMessage(prev, msg as UiMessage));
          scrollToLatest();
          const j = jobRef.current;
          const p = participantsRef.current;
          if (msg.type === 'system') {
            const event = getSystemEvent(msg.metadata);
            if (
              event === 'disponibilidad_propuesta' &&
              (p?.myRole === 'cliente' || p?.myRole === 'trabajador') &&
              j?.id
            ) {
              void refreshAgendaOpciones(j.id);
            }
            if (
              event === 'trabajo_finalizado' ||
              event === 'conformidad_solicitada' ||
              event === 'conformidad_aceptada' ||
              event === 'conformidad_rechazada' ||
              event === 'horario_confirmado' ||
              event === 'pin_validado' ||
              event === 'seña_pagada_cliente' ||
              event === 'seña_pagada_trabajador' ||
              event === 'saldo_pagado_cliente' ||
              event === 'saldo_pagado_trabajador' ||
              event === 'saldo_confirmado_cliente' ||
              event === 'saldo_confirmado_trabajador' ||
              event === 'precio_aceptado_cliente' ||
              event === 'precio_aceptado_trabajador'
            ) {
              void fetchLatestJobByConversation(conversationId).then((next) => {
                if (next) setJob(next);
              });
              void refreshMessages();
              void refreshQuotes();
            }
          } else if (msg.type === 'budget' || msg.type === 'quotation') {
            void refreshQuotes();
            void fetchLatestJobByConversation(conversationId).then((next) => {
              if (next) setJob(next);
            });
          } else if (
            p?.myRole === 'cliente' &&
            j?.estado_trabajo === 'precio_aceptado' &&
            j.id &&
            msg.sender_id !== myId
          ) {
            void refreshAgendaOpciones(j.id);
          }
          if (msg.sender_id !== myId) {
            ingestInboxMessage({
              type: 'message',
              conversationId: msg.conversation_id,
              senderId: msg.sender_id,
              body: msg.text,
              createdAt: msg.created_at,
              messageId: msg.id,
            });
          }
        },
        myId,
        (msg) => {
          setMessages((prev) => patchUpdatedMessage(prev, msg as UiMessage));
          if (msg.type === 'budget' || msg.type === 'quotation') {
            void refreshQuotes();
          }
        },
      );
      return unsub;
    }

    if (!socket) return;
    socket.emit('join_conversation', { conversationId }, () => {});
    const onNew = (msg: UiMessage) => {
      if (msg.conversation_id !== conversationId) return;
      setMessages((prev) => mergeIncomingMessage(prev, msg));
      scrollToLatest();
    };
    socket.on('message:new', onNew);
    return () => {
      socket.emit('leave_conversation', { conversationId });
      socket.off('message:new', onNew);
    };
  }, [socket, conversationId, scrollToLatest, myId, ingestInboxMessage, refreshAgendaOpciones, refreshQuotes, refreshMessages]);

  useEffect(() => {
    if (!myId || !conversationId || loading || messages.length === 0) return;
    let maxIso = messages[0].created_at;
    for (const m of messages) {
      if (new Date(m.created_at).getTime() > new Date(maxIso).getTime()) maxIso = m.created_at;
    }
    markConversationRead(conversationId, maxIso);
    if (isSupabaseConfigured()) {
      void fetchConversationReads(conversationId).then((rows) => {
        const peer = rows
          .filter((r) => r.user_id !== myId)
          .sort((a, b) => new Date(b.read_at).getTime() - new Date(a.read_at).getTime())[0];
        setPeerReadAt(peer?.read_at ?? null);
      });
    }
  }, [myId, conversationId, loading, messages, markConversationRead]);

  function send() {
    const text = input.trim();
    if (!text || !myId) return;
    if (chatBlocked || chatClosedByClaim) return;
    if (inputModeration.blocked) {
      toast.warning(CONTACT_MODERATION_POLICY_MESSAGE, 'Mensaje bloqueado', {
        durationMs: 5200,
      });
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
      setMessages((prev) => mergeIncomingMessage(prev, optimistic));
      setInput('');
      setSending(true);
      void (async () => {
        try {
          const saved = await sendMessageSupabase(conversationId, text);
          setMessages((prev) => {
            const mapped = prev.map((m) =>
              m.clientMessageId === clientMessageId
                ? { ...(saved as UiMessage), optimistic: false }
                : m,
            );
            const seen = new Set<string>();
            return mapped.filter((m) => {
              if (seen.has(m.id)) return false;
              seen.add(m.id);
              return true;
            });
          });
        } catch (e) {
          const errMsg = mapChatSendError(e);
          toast.error(errMsg, 'No se pudo enviar');
          if (errMsg.toLowerCase().includes('bloqueo')) {
            void refreshBlockStatus();
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === clientMessageId ? { ...m, status: 'failed' } : m,
            ),
          );
        } finally {
          setSending(false);
        }
      })();
      scrollToLatest();
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
    setMessages((prev) => mergeIncomingMessage(prev, optimistic));
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
    scrollToLatest();
  }

  const sendImageFromUri = useCallback(
    async (localUri: string) => {
      if (!myId || !isSupabaseConfigured()) return;
      if (chatBlocked || chatClosedByClaim) return;
      if (participants?.myRole !== 'cliente') {
        toast.warning('Solo el cliente puede enviar imágenes.', 'Imágenes');
        return;
      }

      const clientMessageId = newRandomUserId();
      const optimistic: UiMessage = {
        id: clientMessageId,
        conversation_id: conversationId,
        sender_id: myId,
        text: IMAGE_BODY_PREVIEW,
        status: 'sending',
        created_at: new Date().toISOString(),
        clientMessageId,
        type: 'image',
        metadata: { image_url: localUri },
        optimistic: true,
      };
      setMessages((prev) => mergeIncomingMessage(prev, optimistic));
      setAttachingImage(true);
      scrollToLatest();

      try {
        const saved = await sendChatImageMessageSupabase(conversationId, localUri);
        setMessages((prev) => {
          const mapped = prev.map((m) =>
            m.clientMessageId === clientMessageId
              ? { ...(saved as UiMessage), optimistic: false }
              : m,
          );
          const seen = new Set<string>();
          return mapped.filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
        });
      } catch (e) {
        const errMsg = mapChatSendError(e);
        toast.error(errMsg, 'No se pudo enviar la imagen');
        if (errMsg.toLowerCase().includes('bloqueo')) {
          void refreshBlockStatus();
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === clientMessageId ? { ...m, status: 'failed' } : m,
          ),
        );
      } finally {
        setAttachingImage(false);
      }
    },
    [
      chatBlocked,
      chatClosedByClaim,
      conversationId,
      myId,
      participants?.myRole,
      refreshBlockStatus,
      scrollToLatest,
      toast,
    ],
  );

  const pickChatImage = useCallback(
    async (source: 'camera' | 'gallery') => {
      if (attachingImage || sending || chatBlocked || chatClosedByClaim) return;
      try {
        if (source === 'gallery') {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            toast.warning('Necesitamos acceso a tu galería para enviar fotos.', 'Permisos');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: false,
            allowsEditing: false,
            quality: 1,
          });
          if (result.canceled) return;
          const uri = result.assets?.[0]?.uri?.trim();
          if (!uri) return;
          const mime = String(result.assets?.[0]?.mimeType ?? '').toLowerCase();
          if (mime && !mime.startsWith('image/')) {
            toast.warning('Solo se admiten archivos de imagen.', 'Formato');
            return;
          }
          await sendImageFromUri(uri);
          return;
        }

        const cam = await ImagePicker.requestCameraPermissionsAsync();
        if (cam.status !== 'granted') {
          toast.warning('Necesitamos acceso a la cámara para sacar la foto.', 'Permisos');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 1,
        });
        if (result.canceled) return;
        const uri = result.assets?.[0]?.uri?.trim();
        if (!uri) return;
        await sendImageFromUri(uri);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'No se pudo obtener la imagen.',
          'Imágenes',
        );
      }
    },
    [attachingImage, chatBlocked, chatClosedByClaim, sendImageFromUri, sending, toast],
  );

  const openAttachImageMenu = useCallback(() => {
    if (attachingImage || sending || chatBlocked || chatClosedByClaim) return;
    if (participants?.myRole !== 'cliente') return;
    Alert.alert('Enviar imagen', 'Elegí el origen de la foto', [
      { text: 'Cámara', onPress: () => void pickChatImage('camera') },
      { text: 'Galería', onPress: () => void pickChatImage('gallery') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }, [attachingImage, chatBlocked, chatClosedByClaim, participants?.myRole, pickChatImage, sending]);

  const renderItem = useCallback(
    ({ item }: { item: UiMessage }) => {
      const mine = item.sender_id === myId;
      const seenByPeer =
        mine &&
        peerReadAt != null &&
        new Date(peerReadAt).getTime() >= new Date(item.created_at).getTime();

      if (item.type === 'system') {
        if (!shouldRenderSystemMessageInChat(item.metadata, participants?.myRole ?? null)) {
          return null;
        }

        return (
          <View style={styles.systemRow}>
            <View style={styles.systemCard}>
              <Text style={styles.systemText}>{item.text}</Text>
              <Text style={styles.systemMeta}>{formatTime(item.created_at)}</Text>
            </View>
          </View>
        );
      }

      if (item.type === 'image') {
        const imageUrl = String(item.metadata?.image_url ?? '').trim();
        return (
          <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
            <View style={[styles.imageBubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
              {imageUrl ? (
                <Pressable
                  onPress={() => setPreviewImageUrl(imageUrl)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Ver imagen ampliada"
                >
                  <Image source={{ uri: imageUrl }} style={styles.chatImage} resizeMode="cover" />
                </Pressable>
              ) : (
                <Text
                  style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextOther]}
                >
                  Imagen no disponible
                </Text>
              )}
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
                      style={[styles.tick, seenByPeer ? styles.tickSeen : styles.tickMine]}
                    >
                      ✓✓
                    </Text>
                  )
                ) : null}
              </View>
            </View>
          </View>
        );
      }

      if (item.type === 'budget' || item.type === 'quotation') {
        const meta = normalizeMessageMetadata(item.metadata);
        const metaKind = String(meta.kind ?? '');
        if (metaKind === 'material_quote') {
          const requestId = materialQuoteRequestKey(meta);
          const storeCount = Math.max(
            Number(meta.storeCount ?? meta.store_count) || 0,
            1,
          );
          const quoteCount = Math.max(
            Number(meta.quoteCount ?? meta.quote_count) || 0,
            storeCount,
          );
          const countLabel =
            storeCount > 1
              ? `${storeCount} comercios`
              : quoteCount > 1
                ? `${quoteCount} cotizaciones`
                : '1 cotización';
          return (
            <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
              <View style={styles.quoteCard}>
                <View style={styles.quoteTopRow}>
                  <Text style={styles.quoteTitle} numberOfLines={2}>
                    Cotizaciones de materiales
                  </Text>
                  <View style={styles.quoteBadge}>
                    <Ionicons name="storefront-outline" size={14} color={colors.text} />
                    <Text style={styles.quoteBadgeText}>{countLabel}</Text>
                  </View>
                </View>
                {requestId ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.quoteBtn,
                      styles.quoteBtnPrimary,
                      { marginTop: spacing.sm, flex: 0, alignSelf: 'stretch' },
                      pressed && styles.pressed,
                    ]}
                    onPress={() =>
                      (navigation as any).navigate('ClientCompareQuotes', {
                        requestId,
                        readOnly: participants?.myRole === 'trabajador',
                      })
                    }
                  >
                    <Text style={styles.quoteBtnPrimaryText}>Ver cotizaciones</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }

        const quoteId = String(meta.quoteId ?? meta.contratacion_id ?? '');
        const q = quoteId
          ? quoteById.get(quoteId) ?? chatQuoteFromMessageMetadata(item, conversationId)
          : null;
        const myRole = participants?.myRole ?? null;
        const status: QuoteStatus | null = q?.status ?? null;
        const badge =
          status === 'pending'
            ? { label: 'Pendiente', icon: 'time-outline' as const, tone: 'pending' as const }
            : status === 'accepted'
              ? { label: 'Aceptado', icon: 'checkmark-circle-outline' as const, tone: 'accepted' as const }
              : status === 'rejected'
                ? { label: 'Rechazado', icon: 'close-circle-outline' as const, tone: 'rejected' as const }
                : status === 'seña_pagada'
                  ? {
                      label: 'Costo de servicio pagado',
                      icon: 'card-outline' as const,
                      tone: 'seña_pagada' as const,
                    }
                  : status === 'paid'
                    ? { label: 'Pagado', icon: 'card-outline' as const, tone: 'paid' as const }
                    : { label: '—', icon: 'help-circle-outline' as const, tone: 'pending' as const };
        return (
          <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
            <View
              style={[
                styles.quoteCard,
                badge.tone === 'accepted' && styles.quoteCardAccepted,
                badge.tone === 'rejected' && styles.quoteCardRejected,
                badge.tone === 'seña_pagada' && styles.quoteCardSeñaPagada,
                badge.tone === 'paid' && styles.quoteCardPaid,
              ]}
            >
              <View style={styles.quoteTopRow}>
                <Text style={styles.quoteTitle}>Presupuesto</Text>
                <View
                  style={[
                    styles.quoteBadge,
                    badge.tone === 'accepted' && styles.quoteBadgeAccepted,
                    badge.tone === 'rejected' && styles.quoteBadgeRejected,
                    badge.tone === 'seña_pagada' && styles.quoteBadgeSeñaPagada,
                    badge.tone === 'paid' && styles.quoteBadgePaid,
                  ]}
                >
                  <Ionicons name={badge.icon} size={14} color={colors.text} />
                  <Text style={styles.quoteBadgeText}>{badge.label}</Text>
                </View>
              </View>
              {q ? (
                <>
                  {q.service_detail?.trim() ? (
                    <ExpandableText
                      text={q.service_detail.trim()}
                      numberOfLinesCollapsed={4}
                      textStyle={styles.quoteDetail}
                    />
                  ) : null}

                  {myRole === 'trabajador' ? (
                    <Text style={styles.quoteLine}>
                      Neto (lo que cobrás): <Text style={styles.quoteStrong}>{formatMoney(q.net_amount)}</Text>
                    </Text>
                  ) : null}

                  <Text style={styles.quoteLine}>
                    Precio final: <Text style={styles.quoteStrong}>{formatMoney(q.final_amount)}</Text>
                  </Text>

                  {myRole === 'cliente' ? (
                    <>
                      <Text style={styles.quoteLine}>
                        Costo de servicio de YaChanga:{' '}
                        <Text style={styles.quoteStrong}>
                          {formatMoney(Math.max(q.final_amount - q.net_amount, 0))}
                        </Text>
                      </Text>
                      <Text style={styles.quoteLine}>
                        Saldo pendiente:{' '}
                        <Text style={styles.quoteStrong}>
                          {formatMoney(computeSaldoPendiente(q.final_amount, q.final_amount - q.net_amount))}
                        </Text>
                      </Text>
                    </>
                  ) : null}

                  {q.status !== 'rejected' ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.quoteBtn,
                        styles.quoteBtnGhost,
                        { marginTop: spacing.sm },
                        pressed && styles.pressed,
                      ]}
                      onPress={() =>
                        navigation.navigate('DetalleServicio', {
                          contratacionId: q.id,
                          conversationId,
                        })
                      }
                    >
                      <Text style={styles.quoteBtnGhostText}>Ver servicio</Text>
                    </Pressable>
                  ) : null}

                  {participants?.myRole === 'cliente' && q.status === 'pending' ? (
                    <View style={styles.quoteActions}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.quoteBtn,
                          styles.quoteBtnGhost,
                          quoteBusy !== 'none' && styles.quoteBtnDisabled,
                          pressed && quoteBusy === 'none' && styles.pressed,
                        ]}
                        disabled={quoteBusy !== 'none'}
                        onPress={() => {
                          if (quoteBusy !== 'none') return;
                          setQuoteBusy('rejected');
                          void (async () => {
                            try {
                              await rechazarPrecioCotizado(q.id);
                              await refreshQuotes();
                              await refreshMessages();
                              scrollToLatest();
                              toast.success('Presupuesto rechazado.', 'Presupuesto');
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'No se pudo rechazar', 'Presupuesto');
                            } finally {
                              setQuoteBusy('none');
                            }
                          })();
                        }}
                      >
                        <Text style={styles.quoteBtnGhostText}>
                          {quoteBusy === 'rejected' ? 'Rechazando…' : 'Rechazar'}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.quoteBtn,
                          styles.quoteBtnPrimary,
                          quoteBusy !== 'none' && styles.quoteBtnDisabled,
                          pressed && quoteBusy === 'none' && styles.pressed,
                        ]}
                        disabled={quoteBusy !== 'none'}
                        onPress={() => {
                          if (quoteBusy !== 'none') return;
                          setQuoteBusy('accepted');
                          void (async () => {
                            try {
                              await aceptarPrecioCotizado(q.id);
                              await refreshQuotes();
                              await refreshMessages();
                              const j = await fetchLatestJobByConversation(conversationId);
                              setJob(j);
                              scrollToLatest();
                              toast.success('Presupuesto aceptado.', 'Presupuesto');
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'No se pudo aceptar', 'Presupuesto');
                            } finally {
                              setQuoteBusy('none');
                            }
                          })();
                        }}
                      >
                        <Text style={styles.quoteBtnPrimaryText}>
                          {quoteBusy === 'accepted' ? 'Aceptando…' : 'Aceptar'}
                        </Text>
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
    [
      conversationId,
      formatMoney,
      hasActiveQuote,
      latestQuoteAny,
      latestRejected?.id,
      myId,
      navigation,
      participants?.myRole,
      peerReadAt,
      quoteBusy,
      quoteById,
      refreshMessages,
      refreshQuotes,
      scrollToLatest,
      toast,
    ],
  );

  const chatActionBars = useMemo(
    () => (
      <>
        {isSupabaseConfigured() && showWorkerAvailabilityBar && job ? (
          <View style={styles.completeBar}>
            <View style={styles.payBarText}>
              <Text style={styles.paySubtitle}>
                Envíe hasta 5 opciones para coordinar la visita.
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.payBtn, pressed && styles.pressed]}
              onPress={() =>
                navigation.navigate('DetalleServicio', {
                  contratacionId: job.id,
                  conversationId,
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Coordinar agenda"
            >
              <Text style={styles.payBtnText}>Agenda</Text>
            </Pressable>
          </View>
        ) : null}

        {isSupabaseConfigured() && showWorkerAgendaSentBar && job ? (
          <View style={styles.completeBarStackedWrapper}>
            <AgendaOpcionesCliente
              mode="readonly"
              opciones={agendaOpciones}
              embedded
              onEdit={() =>
                navigation.navigate('DetalleServicio', {
                  contratacionId: job.id,
                  conversationId,
                })
              }
            />
          </View>
        ) : null}

        {isSupabaseConfigured() && showClientWaitingAvailabilityBar && job ? (
          <View style={styles.completeBar}>
            <View style={styles.payBarText}>
              <Text style={styles.paySubtitle}>
                Aguarde hasta que el profesional le envíe su disponibilidad horaria.
              </Text>
            </View>
          </View>
        ) : null}

        {isSupabaseConfigured() && showClientAgendaBar && job ? (
          <View style={styles.completeBarStackedWrapper}>
            <AgendaOpcionesCliente
              opciones={agendaOpciones}
              busy={agendaBusy}
              embedded
              onConfirm={handleConfirmAgenda}
              onReject={handleRejectAgenda}
            />
          </View>
        ) : null}

        {isSupabaseConfigured() && showClientSaldoPagadoBar && job ? (
          <View style={[styles.completeBar, styles.completeBarStacked]}>
            <Text style={styles.paySubtitle}>
              Pagá el saldo restante ({formatMoney(saldoPendiente)}) al profesional y confirmá acá cuando
              lo hayas hecho.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.payBtn,
                { alignSelf: 'stretch', marginTop: spacing.sm },
                saldoBusy && styles.quoteBtnDisabled,
                pressed && !saldoBusy && styles.pressed,
              ]}
              disabled={saldoBusy}
              onPress={handleSaldoPagadoCliente}
            >
              <Text style={styles.payBtnText}>
                {saldoBusy ? 'Registrando…' : 'Saldo pagado al profesional'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {isSupabaseConfigured() && showClientSaldoEsperandoBar && job ? (
          <View style={styles.completeBar}>
            <View style={styles.payBarText}>
              <Text style={styles.paySubtitle}>
                Indicaste que pagaste el saldo. Aguardá a que el profesional confirme la recepción.
              </Text>
            </View>
          </View>
        ) : null}

        {isSupabaseConfigured() && showWorkerSaldoRecibidoBar && job ? (
          <View style={[styles.completeBar, styles.completeBarStacked]}>
            <View style={styles.payBarText}>
              <Text style={styles.payTitle}>Saldo pagado por el cliente</Text>
              <Text style={styles.paySubtitle}>
                El cliente indicó que pagó el saldo restante. Confirmá que lo recibiste.
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.payBtn,
                { alignSelf: 'stretch', marginTop: spacing.sm },
                saldoBusy && styles.quoteBtnDisabled,
                pressed && !saldoBusy && styles.pressed,
              ]}
              disabled={saldoBusy}
              onPress={handleConfirmarSaldoTrabajador}
              accessibilityRole="button"
              accessibilityLabel="Confirmar pago recibido"
            >
              <Text style={styles.payBtnText}>
                {saldoBusy ? 'Confirmando…' : 'Confirmar pago recibido'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {isSupabaseConfigured() && showPay && job ? (
          <View style={styles.payBar}>
            <View style={styles.payBarText}>
              <Text style={styles.payTitle}>Costo de servicio pendiente</Text>
              <Text style={styles.paySubtitle}>
                Para compartir tu ubicación al profesional, se requiere el pago del costo de servicio
                de YaChanga.
              </Text>
              <Text style={[styles.paySubtitle, { marginTop: spacing.xs }]}>
                Costo de servicio {formatMoney(job.seña)} · Saldo pendiente{' '}
                {formatMoney(computeSaldoPendiente(job.amount, job.seña))}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.payBtn, pressed && styles.pressed]}
              onPress={() => {
                if (quoteBusy !== 'none') return;
                if (isMercadoPagoEnabled()) {
                  setQuoteBusy('paid');
                  void (async () => {
                    try {
                      const synced = await sincronizarSeñaSiPendiente(job.id);
                      if (synced) {
                        const j = await fetchLatestJobByConversation(conversationId);
                        setJob(j);
                        await refreshMessages();
                        toast.success('El costo de servicio ya estaba acreditado', 'Pago');
                        return;
                      }
                      const result = await crearPreferenciaSeña(job.id);
                      if (!result.ok) throw new Error(result.message);
                      openPagoCheckout({
                        contratacionId: job.id,
                        checkoutUrl: result.data.checkout_url,
                        sandbox: Boolean(result.data.sandbox),
                        conversationId,
                      });
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : 'No se pudo iniciar el pago',
                        'Pago',
                      );
                    } finally {
                      setQuoteBusy('none');
                    }
                  })();
                  return;
                }
                navigation.navigate('DetalleServicio', {
                  contratacionId: job.id,
                  conversationId,
                });
              }}
              accessibilityRole="button"
              accessibilityLabel="Pagar costo de servicio de YaChanga"
            >
              <Text style={styles.payBtnText}>
                {isMercadoPagoEnabled() ? 'Pagar costo de servicio' : 'Ver pago'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {isSupabaseConfigured() && showClientPinBar && job ? (
          <View style={styles.payBar}>
            <View style={styles.payBarText}>
              <Text style={styles.payTitle}>Costo de servicio pagado</Text>
              <Text style={styles.paySubtitle}>
                {clientPin
                  ? `Tu PIN: ${clientPin} · Compartilo con el profesional al iniciar el trabajo.`
                  : 'Generando tu PIN de verificación…'}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.payBtn, pressed && styles.pressed]}
              onPress={() =>
                navigation.navigate('DetalleServicio', {
                  contratacionId: job.id,
                  conversationId,
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Ver detalle del servicio"
            >
              <Text style={styles.payBtnText}>Ver servicio</Text>
            </Pressable>
          </View>
        ) : null}

        {isSupabaseConfigured() && showWorkerSeñaPagadaBar && job ? (
          <View style={styles.completeBar}>
            <View style={styles.payBarText}>
              <Text style={styles.payTitle}>Costo de servicio pagado</Text>
              <Text style={styles.paySubtitle}>
                Al llegar al domicilio, pedile el PIN al cliente para iniciar el trabajo.
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.payBtn, pressed && styles.pressed]}
              onPress={() =>
                navigation.navigate('DetalleServicio', {
                  contratacionId: job.id,
                  conversationId,
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Ver servicio"
            >
              <Text style={styles.payBtnText}>Ver servicio</Text>
            </Pressable>
          </View>
        ) : null}

        {isSupabaseConfigured() && showWorkerJobBar && job ? (
          <View style={styles.completeBar}>
            <View style={styles.payBarText}>
              <Text style={styles.payTitle}>
                {workerJobPaid ? 'Costo de servicio pagado' : 'Cotización aceptada'}
              </Text>
              <Text style={styles.paySubtitle}>
                {workerJobPaid
                  ? showWorkerSaldoRecibidoBar
                    ? 'Cuando termines el trabajo, marcá como realizado. El cliente ya indicó el pago del saldo.'
                    : 'Cuando termines el trabajo, marcá como realizado.'
                  : job.estado_trabajo === 'precio_aceptado'
                    ? 'Coordiná la agenda con el cliente.'
                    : `Esperá a que el cliente pague el costo de servicio de YaChanga (${formatMoney(job.seña)}).`}
              </Text>
            </View>
            {workerJobPaid ? (
              <Pressable
                style={({ pressed }) => [
                  styles.payBtn,
                  quoteBusy !== 'none' && styles.quoteBtnDisabled,
                  pressed && quoteBusy === 'none' && styles.pressed,
                ]}
                disabled={quoteBusy !== 'none'}
                onPress={handleMarcarTrabajoFinalizado}
                accessibilityRole="button"
                accessibilityLabel="Marcar realizado"
              >
                <Text style={styles.payBtnText}>
                  {quoteBusy !== 'none' ? '…' : 'Realizado'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {isSupabaseConfigured() && showReviewForm && job && participants?.myRole === 'cliente' ? (
          <View style={styles.reviewCard}>
            <Text style={styles.reviewTitle}>Dejá tu reseña</Text>
            <Text style={styles.paySubtitle}>
              El profesional marcó el trabajo como finalizado. Contanos cómo fue la experiencia.
            </Text>
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
                      jobId: job.id,
                      rating: reviewRating,
                      comment: reviewComment,
                    });
                    setReviewSubmitted(true);
                    const r = await fetchReviewForJob(job.id);
                    setReview(r);
                    toast.success('¡Gracias por tu reseña!', 'Reseña');
                    // Estrellas al día: leer rating actualizado del perfil + refrescar feed.
                    try {
                      const { getSupabaseClient } = await import('../../lib/supabase');
                      const sb = getSupabaseClient();
                      const { data: pr } = await sb
                        .from('profiles')
                        .select('rating_average,review_count')
                        .eq('id', participants.workerId)
                        .maybeSingle();
                      if (pr) {
                        updateWorkerRatings(
                          participants.workerId,
                          Number((pr as { rating_average?: number }).rating_average) || 0,
                          Number((pr as { review_count?: number }).review_count) || 0,
                        );
                      }
                    } catch {
                      /* ignore */
                    }
                    void refreshFeed();
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
      </>
    ),
    [
      agendaBusy,
      agendaOpciones,
      clientPin,
      conversationId,
      formatMoney,
      handleConfirmAgenda,
      handleConfirmarSaldoTrabajador,
      handleMarcarTrabajoFinalizado,
      handleSaldoPagadoCliente,
      handleRejectAgenda,
      job,
      navigation,
      participants,
      quoteBusy,
      refreshMessages,
      reviewComment,
      reviewRating,
      reviewSending,
      saldoBusy,
      saldoPendiente,
      showClientAgendaBar,
      showClientPinBar,
      showClientSaldoEsperandoBar,
      showClientSaldoPagadoBar,
      showClientWaitingAvailabilityBar,
      showPay,
      showReviewForm,
      showWorkerAgendaSentBar,
      showWorkerAvailabilityBar,
      showWorkerSaldoRecibidoBar,
      showWorkerSeñaPagadaBar,
      showWorkerJobBar,
      toast,
      workerJobPaid,
    ],
  );

  const inputContainer = useMemo(() => {
    const composerDisabled = chatBlocked || blockStatusLoading;
    const placeholder = composerDisabled
      ? 'No podés responder a esta conversación'
      : 'Mensaje…';
    const showClientAttach =
      !composerDisabled &&
      isSupabaseConfigured() &&
      participants?.myRole === 'cliente';

    return (
      <View style={[styles.inputContainer, { paddingBottom: spacing.sm }]}>
        {blockStatus.iBlockedThem ? (
          <View style={styles.unblockRow}>
            <Text style={styles.unblockHint}>Has bloqueado a este usuario.</Text>
            <Pressable
              onPress={handleUnblockUser}
              disabled={blockActionBusy}
              style={({ pressed }) => [styles.unblockLink, pressed && styles.pressed]}
            >
              <Text style={styles.unblockLinkText}>
                {blockActionBusy ? '…' : 'Desbloquear'}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composer}>
          {!composerDisabled && inputModeration.blocked ? (
            <View style={styles.blockedBanner} accessibilityLiveRegion="polite">
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.blockedText}>{CONTACT_MODERATION_POLICY_MESSAGE}</Text>
            </View>
          ) : null}
          {showClientAttach ? (
            <Pressable
              onPress={openAttachImageMenu}
              disabled={attachingImage || sending}
              accessibilityRole="button"
              accessibilityLabel="Adjuntar imagen"
              hitSlop={8}
              style={({ pressed }) => [
                styles.attachBtn,
                (attachingImage || sending) && styles.sendBtnDisabled,
                pressed && styles.pressed,
              ]}
            >
              {attachingImage ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="image-outline" size={22} color={colors.text} />
              )}
            </Pressable>
          ) : null}
          <TextInput
            style={[styles.input, composerDisabled && styles.inputDisabled]}
            value={composerDisabled ? '' : input}
            onChangeText={setInput}
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={2000}
            editable={!composerDisabled}
            onFocus={scrollToLatest}
          />
          {composerDisabled ? (
            <View style={[styles.sendBtn, styles.sendBtnDisabled, styles.sendBtnHidden]}>
              <Ionicons name="send" size={20} color="#fff" />
            </View>
          ) : (
            <Pressable
              style={[
                styles.sendBtn,
                (!input.trim() || sending || attachingImage || inputModeration.blocked) &&
                  styles.sendBtnDisabled,
              ]}
              onPress={send}
              disabled={
                !input.trim() ||
                sending ||
                attachingImage ||
                inputModeration.blocked ||
                (!isSupabaseConfigured() && !connected)
              }
            >
              <Ionicons name="send" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>
    );
  }, [
    attachingImage,
    blockActionBusy,
    blockStatus.iBlockedThem,
    blockStatusLoading,
    chatBlocked,
    connected,
    handleUnblockUser,
    input,
    inputModeration.blocked,
    openAttachImageMenu,
    participants?.myRole,
    scrollToLatest,
    send,
    sending,
  ]);

  return (
    <>
      <ChatSafetyOptionsModal
        visible={safetyMenuOpen}
        iBlockedThem={blockStatus.iBlockedThem}
        onClose={() => setSafetyMenuOpen(false)}
        onReport={() => setReportModalOpen(true)}
        onBlock={handleBlockUser}
        onUnblock={handleUnblockUser}
      />
      <ChatReportUserModal
        visible={reportModalOpen}
        displayName={displayName}
        submitting={reportSubmitting}
        onClose={() => !reportSubmitting && setReportModalOpen(false)}
        onConfirm={handleSubmitReport}
      />
      <Modal
        visible={Boolean(previewImageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImageUrl(null)}
      >
        <Pressable style={styles.imagePreviewBackdrop} onPress={() => setPreviewImageUrl(null)}>
          <SafeAreaView style={styles.imagePreviewSafe} edges={['top', 'bottom']}>
            <Pressable
              style={styles.imagePreviewClose}
              onPress={() => setPreviewImageUrl(null)}
              accessibilityRole="button"
              accessibilityLabel="Cerrar imagen"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
            {previewImageUrl ? (
              <Image
                source={{ uri: previewImageUrl }}
                style={styles.imagePreviewFull}
                resizeMode="contain"
              />
            ) : null}
          </SafeAreaView>
        </Pressable>
      </Modal>
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
                      Ingresá el monto neto que querés cobrar. YaChanga suma un 22% (ej. $100 → costo de servicio $22).
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
                      <Text style={styles.quotePreviewLabel}>Costo de servicio YaChanga (22%)</Text>
                      <Text style={styles.quotePreviewValue}>{formatMoney(quoteFeePreview || 0)}</Text>
                    </View>

                    <View style={styles.quotePreviewRow}>
                      <Text style={styles.quotePreviewLabel}>Precio final</Text>
                      <Text style={styles.quotePreviewValue}>{formatMoney(quoteFinalPreview || 0)}</Text>
                    </View>

                    <Text style={styles.fieldLabel}>Detalle del servicio *</Text>
                    <TextInput
                      value={quoteDetail}
                      onChangeText={setQuoteDetail}
                      placeholder="Ej: instalación + materiales, tiempos, condiciones…"
                      placeholderTextColor={colors.textSecondary}
                      style={styles.quoteDetailInput}
                      multiline
                      maxLength={1200}
                    />
                    {quoteDetailModeration.blocked ? (
                      <Text style={styles.quoteModerationWarning}>
                        {CONTACT_MODERATION_POLICY_MESSAGE}
                      </Text>
                    ) : null}

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
                            !quoteDetail.trim() ||
                            quoteSubmitting ||
                            quoteDetailModeration.blocked ||
                            !participants ||
                            participants.myRole !== 'trabajador') &&
                            styles.modalBtnDisabled,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => {
                          if (!participants || participants.myRole !== 'trabajador') return;
                          if (quoteNetNum <= 0) return;
                          if (!quoteDetail.trim()) {
                            toast.error('El detalle del servicio es obligatorio.', 'Presupuesto');
                            return;
                          }
                          if (quoteSubmitting) return;
                          setQuoteSubmitting(true);
                          void (async () => {
                            try {
                              await createQuote({
                                conversationId,
                                workerId: participants.workerId,
                                clientId: participants.clientId,
                                netAmount: quoteNetNum,
                                feeRate,
                                serviceDetail: quoteDetail,
                                replacesQuoteId,
                              });
                              setQuoteModalOpen(false);
                              setQuoteNetAmount(0);
                              setQuoteNetText('');
                              setQuoteDetail('');
                              setReplacesQuoteId(null);
                              await refreshQuotes();
                              await refreshMessages();
                              scrollToLatest();
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
                          !quoteDetail.trim() ||
                          quoteSubmitting ||
                          quoteDetailModeration.blocked ||
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
                <Text style={styles.modalTitle}>Eliminar chat</Text>
                <Text style={styles.modalText}>
                  Se archivará la conversación con {displayName} para ambos. Si vuelven a
                  contactarse, empezarán un chat nuevo sin el historial anterior.
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
                        'Eliminar chat',
                        '¿Archivar esta conversación? Ambos dejarán de verla; un nuevo contacto abre un chat en blanco.',
                        [
                          { text: 'Cancelar', style: 'cancel' },
                          {
                            text: 'Eliminar',
                            style: 'destructive',
                            onPress: () => {
                              setConfirmDelete(false);
                              setDeleting(true);
                              void (async () => {
                                try {
                                  await deleteConversation(myId, conversationId);
                                  await reconcileInboxFromServer({ force: true });
                                  toast.success('Chat eliminado.', 'Mensajes');
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
                    <Text style={styles.modalBtnDangerText}>
                      {deleting ? 'Eliminando…' : 'Eliminar'}
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
      </Modal>

      {/* Safe top propio: el stack header nativo está oculto en ChatConversation */}
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          {/* Una sola fila: back + nombre + chips + ⋮/trash */}
          <View style={styles.headerTopRow}>
            <Pressable
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Volver"
              hitSlop={8}
              style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>

            <View style={styles.headerIdentity}>
              <View style={styles.headerNameChipsRow}>
                {profileWorkerId ? (
                  <Pressable
                    onPress={openWorkerProfile}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver perfil de ${displayName}`}
                    hitSlop={6}
                    style={styles.headerNamePressable}
                  >
                    <Text
                      style={[styles.headerName, styles.headerNameLink]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {displayName}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
                    {displayName}
                  </Text>
                )}
                {isSupabaseConfigured() && participants?.myRole === 'trabajador' && !chatBlocked ? (
                  <View style={styles.headerChipsContainer}>
                    <View style={styles.headerChipsInline}>
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
                        hitSlop={4}
                        style={({ pressed }) => [
                          styles.headerActionChip,
                          hasActiveJob && styles.modalBtnDisabled,
                          pressed && styles.pressed,
                        ]}
                        disabled={hasActiveJob}
                      >
                        <Ionicons name="calculator-outline" size={14} color={colors.text} />
                        <Text style={styles.headerActionChipText}>Cotizar</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          if (!participants.clientId) {
                            toast.warning('No se pudo identificar al cliente de este chat.', 'Materiales');
                            return;
                          }
                          (navigation as any).navigate('CreateMaterialRequest', {
                            clientId: participants.clientId,
                            conversationId,
                          });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Cotizaciones de materiales"
                        hitSlop={4}
                        style={({ pressed }) => [styles.headerActionChip, pressed && styles.pressed]}
                      >
                        <Ionicons name="clipboard-outline" size={14} color={colors.text} />
                        <Text style={styles.headerActionChipText}>Materiales</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
              {headerSubtitle ? (
                <Text style={styles.headerTrade} numberOfLines={1} ellipsizeMode="tail">
                  {headerSubtitle}
                </Text>
              ) : null}
              {!isSupabaseConfigured() && !connected ? (
                <Text style={styles.headerWarn} numberOfLines={1}>
                  Reconectando…
                </Text>
              ) : null}
            </View>

            <View style={styles.headerIconCluster}>
              {isSupabaseConfigured() && otherUserId ? (
                <Pressable
                  onPress={() => setSafetyMenuOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Opciones de seguridad"
                  hitSlop={8}
                  style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
                >
                  <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setConfirmDelete(true)}
                accessibilityRole="button"
                accessibilityLabel="Eliminar chat"
                hitSlop={8}
                style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
              >
                <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          enabled={Platform.OS === 'ios'}
          keyboardVerticalOffset={keyboardVerticalOffset}
        >
          {loading || claimLockLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : chatClosedByClaim ? (
            <View style={styles.claimClosedWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={36} color={colors.textSecondary} />
              <Text style={styles.claimClosedTitle}>{CHAT_CERRADO_POR_RECLAMO}</Text>
              <Text style={styles.claimClosedText}>{CHAT_CERRADO_POR_RECLAMO_DETALLE}</Text>
            </View>
          ) : (
            <View style={styles.chatBody}>
              {reviewFocused ? (
                <View style={styles.reviewFocusSpacer} />
              ) : (
                <FlatList
                  ref={listRef}
                  inverted
                  data={visibleMessages}
                  keyExtractor={(item) => item.id}
                  renderItem={renderItem}
                  style={styles.list}
                  initialNumToRender={20}
                  maxToRenderPerBatch={24}
                  windowSize={10}
                  removeClippedSubviews={Platform.OS === 'android'}
                  maintainVisibleContentPosition={
                    Platform.OS === 'android'
                      ? { minIndexForVisible: 0, autoscrollToTopThreshold: 24 }
                      : undefined
                  }
                  contentContainerStyle={[
                    styles.listContent,
                    messages.length === 0 && styles.listEmptyInverted,
                  ]}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>Escribí un mensaje para iniciar el contacto</Text>
                  }
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                />
              )}
              {chatActionBars}
              {inputContainer}
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  /** Fila única: [←] identity+chips(flex:1,minWidth:0) [⋮][🗑] */
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 44,
  },
  headerIdentity: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  headerNameChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 6,
    minWidth: 0,
  },
  headerNamePressable: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '42%',
  },
  /** Contenedor: centrado vertical + chips hacia la derecha. */
  headerChipsContainer: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  headerChipsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  headerIconCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  headerNameLink: { textDecorationLine: 'underline' },
  headerTrade: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 1,
  },
  headerWarn: { fontSize: 12, fontWeight: '700', color: colors.primary, marginTop: 2 },
  headerActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    flexShrink: 0,
  },
  headerActionChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.text,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chatBody: { flex: 1 },
  list: { flex: 1 },
  inputContainer: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  listEmptyInverted: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: spacing.xl,
  },
  claimClosedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  claimClosedTitle: {
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  claimClosedText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
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
  unblockRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  unblockHint: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  unblockLink: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  unblockLinkText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    textDecorationLine: 'underline',
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
  inputDisabled: {
    opacity: 0.55,
    backgroundColor: '#ECECEC',
  },
  sendBtnHidden: {
    opacity: 0.35,
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
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,24,39,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,24,39,0.10)',
  },
  imageBubble: {
    maxWidth: '78%',
    borderRadius: 16,
    padding: 6,
    overflow: 'hidden',
  },
  chatImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
  },
  imagePreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  imagePreviewSafe: {
    flex: 1,
  },
  imagePreviewClose: {
    alignSelf: 'flex-end',
    padding: spacing.md,
  },
  imagePreviewFull: {
    flex: 1,
    width: '100%',
  },
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
  quoteModerationWarning: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.error,
  },
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
  quoteBadgeSeñaPagada: { borderColor: 'rgba(13,148,136,0.35)', backgroundColor: 'rgba(13,148,136,0.10)' },
  quoteBadgeRejected: { borderColor: 'rgba(220,38,38,0.35)', backgroundColor: 'rgba(220,38,38,0.10)' },
  quoteBadgePaid: { borderColor: 'rgba(59,130,246,0.35)', backgroundColor: 'rgba(59,130,246,0.10)' },
  quoteBadgeText: { fontSize: 12, fontWeight: '900', color: colors.text },
  quoteCardAccepted: { borderColor: 'rgba(13,148,136,0.35)' },
  quoteCardSeñaPagada: { borderColor: 'rgba(13,148,136,0.35)' },
  quoteCardRejected: { borderColor: 'rgba(220,38,38,0.35)' },
  quoteCardPaid: { borderColor: 'rgba(59,130,246,0.35)' },
  quoteTitle: {
    flex: 1,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
    marginRight: spacing.sm,
  },
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
  quoteBtnDisabled: { opacity: 0.45 },

  systemRow: {
    alignItems: 'center',
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  systemCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(13,148,136,0.08)',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: 'rgba(13,148,136,0.22)',
    padding: spacing.md,
    gap: spacing.xs,
  },
  systemText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    fontWeight: '600',
  },
  systemMeta: {
    marginTop: spacing.xs,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    alignSelf: 'flex-end',
  },

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
  completeBarStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  completeBarStackedWrapper: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.22)',
    backgroundColor: 'rgba(59,130,246,0.07)',
    padding: spacing.sm,
    overflow: 'hidden',
  },
  conformidadActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  conformidadBtnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  conformidadBtnGhostText: { fontSize: 13, fontWeight: '800', color: colors.text },
  conformidadBtnPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  conformidadBtnPrimaryText: { fontSize: 13, fontWeight: '800', color: '#fff' },
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
