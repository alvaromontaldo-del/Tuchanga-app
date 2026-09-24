import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ImageLightboxModal } from '../../components/common/ImageLightboxModal';
import { ExpandableText } from '../../components/common/ExpandableText';
import { ClickableAvatar } from '../../components/common/ClickableAvatar';
import { useAppToast } from '../../components/toast/toast';
import { colors, radii, shadows, spacing, typography } from '../../constants/theme';
import { isMessagingAvailable } from '../../config/api';
import { isSupabaseConfigured } from '../../config/supabase';
import { useAuth } from '../../context/AuthContext';
import { useFavorites } from '../../context/FavoritesContext';
import { useUserMode } from '../../context/UserModeContext';
import { getWorkerBackendUserId, isWorkerUserIdUuid } from '../../data/workerChatIds';
import { getWorkerById } from '../../data/mockFeed';
import { openAuthModal } from '../../navigation/openAuthModal';
import { openOrCreateChat } from '../../services/messaging';
import { fetchWorkerPublicProfileFromSupabase } from '../../services/workerProfileSupabase';
import { StarRating } from '../../components/profile/StarRating';
import type {
  FeedStackScreenProps,
  MessagesStackScreenProps,
  SearchStackScreenProps,
} from '../../navigation/mainTypes';
import type { WorkerPublicProfile, WorkerTradeEntry } from '../../types/feed';

type Props =
  | FeedStackScreenProps<'WorkerProfile'>
  | SearchStackScreenProps<'WorkerProfile'>
  | MessagesStackScreenProps<'WorkerProfile'>;

/** Evita conflicto de tipos entre stack de feed y de búsqueda (mismas rutas). */
type WorkerProfileFlowNav = NativeStackNavigationProp<
  {
    WorkerProfile: { workerId: string; conversationId?: string };
    WorkerPosts: { workerId: string };
    WorkerReviews: { workerId: string };
    ChatConversation: {
      conversationId: string;
      otherDisplayName: string;
      headerSubtitle: string;
      workerId?: string;
    };
  },
  'WorkerProfile'
>;

function calcAgeLabel(birthDate: string | undefined): string | null {
  const t = (birthDate ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  const today = new Date();
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();

  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  return `${age} años`;
}

function mergeTradesForCurrentUser(
  trades: WorkerTradeEntry[],
  workerTrade: string,
): WorkerTradeEntry[] {
  if (trades.length === 0) {
    return [
      {
        title: workerTrade,
        description: 'Servicios generales a medida del cliente.',
        yearsExperience: 1,
      },
    ];
  }
  return trades.map((t, index) =>
    index === 0 ? { ...t, title: workerTrade } : t,
  );
}

/**
 * Perfil público: calificación, reseñas navegables, oficios con años de experiencia por rubro.
 */
export function WorkerProfileScreen({ route, navigation }: Props) {
  const { workerId, conversationId: originConversationId } = route.params;
  const { workerTrade, isWorker } = useUserMode();
  const { user, isRestoring, ensureActiveAccount } = useAuth();
  const { isFavorite, toggleFavoriteById } = useFavorites();
  const toast = useAppToast();
  const mockWorker = getWorkerById(workerId);
  const [remoteWorker, setRemoteWorker] = useState<WorkerPublicProfile | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [contactBusy, setContactBusy] = useState(false);
  const closeLightbox = useCallback(() => {
    setLightboxPhotos([]);
    setLightboxIndex(0);
  }, []);

  useEffect(() => {
    setRemoteWorker(null);
    const localMock = getWorkerById(workerId);
    if (localMock) {
      setRemoteStatus('done');
      return;
    }
    if (!isSupabaseConfigured() || !isWorkerUserIdUuid(workerId)) {
      setRemoteStatus('done');
      return;
    }

    // IMPORTANT: si intentamos fetchear como invitado, puede devolver null y luego
    // no reintenta al loguear (mismo workerId). Esperamos a que haya sesión.
    if (isRestoring || !user) {
      setRemoteStatus('idle');
      return;
    }

    setRemoteStatus('loading');
    let cancelled = false;
    void fetchWorkerPublicProfileFromSupabase(workerId)
      .then((w) => {
        if (!cancelled) {
          setRemoteWorker(w);
          setRemoteStatus('done');
        }
      })
      .catch(() => {
        if (!cancelled) setRemoteStatus('done');
      });
    return () => {
      cancelled = true;
    };
  }, [workerId, isRestoring, user]);

  // Al volver a la pantalla (p. ej. tras una reseña), refrescar estrellas.
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured() || !isWorkerUserIdUuid(workerId)) return;
      if (isRestoring || !user) return;
      if (getWorkerById(workerId)) return;
      let cancelled = false;
      void fetchWorkerPublicProfileFromSupabase(workerId)
        .then((w) => {
          if (!cancelled && w) setRemoteWorker(w);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [workerId, isRestoring, user]),
  );

  const authGateOpenedRef = useRef(false);
  useEffect(() => {
    if (isRestoring) return;
    if (user) {
      authGateOpenedRef.current = false;
      return;
    }
    if (authGateOpenedRef.current) return;
    authGateOpenedRef.current = true;

    const backendId = getWorkerBackendUserId(workerId);
    const redirectId =
      backendId ?? (isWorkerUserIdUuid(workerId) ? workerId : null);
    openAuthModal('Login', { redirectTo: redirectId ? `worker:${redirectId}` : undefined });
  }, [isRestoring, user, workerId]);

  if (!user && !isRestoring) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={30} color={colors.textSecondary} />
        <Text style={[styles.muted, styles.loadingHint]}>
          Iniciá sesión para ver perfiles.
        </Text>
        <Pressable
          onPress={() => {
            const backendId = getWorkerBackendUserId(workerId);
            const redirectId =
              backendId ?? (isWorkerUserIdUuid(workerId) ? workerId : null);
            openAuthModal('Login', {
              redirectTo: redirectId ? `worker:${redirectId}` : undefined,
            });
          }}
          style={({ pressed }) => [styles.authGateBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Iniciar sesión"
        >
          <Text style={styles.authGateBtnText}>Iniciar sesión</Text>
        </Pressable>
      </View>
    );
  }

  const worker = mockWorker ?? remoteWorker;

  if (!worker) {
    if (remoteStatus === 'loading') {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.muted, styles.loadingHint]}>Cargando perfil…</Text>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>
          Perfil no disponible. Este trabajador puede ser un usuario nuevo o no tener oficios
          cargados.
        </Text>
      </View>
    );
  }

  const trades =
    worker.id === 'me'
      ? mergeTradesForCurrentUser(worker.trades, workerTrade)
      : worker.trades;

  const workerBackendId = getWorkerBackendUserId(workerId);
  /** Para pantallas que consultan Supabase (reseñas), siempre preferimos el UUID real. */
  const reviewsNavWorkerId = workerBackendId ?? workerId;

  const primaryTradeLabel = trades[0]?.title ?? worker.trade;
  const ageLabel = calcAgeLabel(worker.birthDate);
  const isOtherProfile = workerId !== 'me' && Boolean(workerBackendId);
  const viewingOwnProfile =
    workerId === 'me' ||
    (user != null &&
      (user.id === workerId || (workerBackendId != null && user.id === workerBackendId)));
  const showVisitorActions = isOtherProfile && !viewingOwnProfile;
  const chatReady = isMessagingAvailable();

  const workerFirst = worker.firstName;
  const favId = workerBackendId ?? '';
  const favOn = favId ? isFavorite(favId) : false;

  const avgRating = Math.min(5, Math.max(0, Number(worker.ratingAverage) || 0));

  async function onToggleFavorite() {
    if (!favId) return;
    const w = worker;
    if (!w) return;
    if (!user) {
      openAuthModal('Login');
      return;
    }
    try {
      await toggleFavoriteById({
        professionalId: favId,
        optimisticData: {
          id: favId,
          firstName: w.firstName,
          summary: w.bio || `${primaryTradeLabel}`,
          avatarUrl: w.avatarUrl,
          ratingAverage: w.ratingAverage,
          reviewCount: w.reviewCount,
          categories: trades.map((t) => t.title).filter(Boolean),
        },
      });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo actualizar el favorito',
        'Favoritos',
        { durationMs: 4200 },
      );
    }
  }

  async function onContact() {
    if (!workerBackendId) return;
    if (contactBusy) return;
    if (!user?.id) {
      openAuthModal('Register', { redirectTo: `worker:${workerBackendId}` });
      return;
    }
    if (!isMessagingAvailable()) {
      toast.warning(
        'Agregá Supabase (EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY) o el servidor Node (EXPO_PUBLIC_API_URL) y reiniciá Expo.',
        'Configurar chat',
        { durationMs: 5200 },
      );
      return;
    }
    try {
      setContactBusy(true);
      const redirectTo = `worker:${workerBackendId}`;
      const ok = await ensureActiveAccount({ redirectTo });
      if (!ok) return;

      // Si llegamos desde un chat, volvemos atrás (evita duplicar pantalla y canales Realtime).
      if (originConversationId) {
        if (navigation.canGoBack()) {
          navigation.goBack();
        }
        return;
      }
      const res = await openOrCreateChat(user.id, {
        workerUserId: workerBackendId,
        workerDisplayName: workerFirst,
        primaryTrade: primaryTradeLabel,
      });
      const trade = res.primaryTrade || primaryTradeLabel;
      (navigation as unknown as WorkerProfileFlowNav).navigate('ChatConversation', {
        conversationId: res.conversationId,
        otherDisplayName: res.workerDisplayName,
        headerSubtitle: trade ? `Profesional · ${trade}` : 'Profesional',
        workerId: workerBackendId,
      });
    } catch (e) {
      const { isDeletedOrInvalidAuthError } = await import('../../services/sessionValidity');
      if (isDeletedOrInvalidAuthError(e)) {
        await ensureActiveAccount({ redirectTo: `worker:${workerBackendId}` });
        return;
      }
      // Si el chat falla por cuenta inexistente / JWT inválido, ensureActiveAccount lo detecta.
      const stillOk = await ensureActiveAccount({
        redirectTo: workerBackendId ? `worker:${workerBackendId}` : undefined,
      });
      if (!stillOk) return;
      toast.error(
        e instanceof Error ? e.message : 'No se pudo abrir el chat',
        'Chat',
        { durationMs: 4200 },
      );
    } finally {
      setContactBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <ImageLightboxModal photos={lightboxPhotos} initialIndex={lightboxIndex} onClose={closeLightbox} />

      <View style={styles.card}>
        <View style={styles.accent} />

        {showVisitorActions ? (
          <Pressable
            onPress={() => void onToggleFavorite()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={favOn ? 'Quitar de favoritos' : 'Agregar a favoritos'}
            style={({ pressed }) => [
              styles.heartBtn,
              favOn && styles.heartBtnOn,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={favOn ? 'heart' : 'heart-outline'}
              size={22}
              color={favOn ? '#DC2626' : colors.textSecondary}
            />
          </Pressable>
        ) : null}

        <ClickableAvatar uri={worker.avatarUrl} style={styles.avatar} />
        <Text style={styles.name}>{worker.firstName}</Text>
        {ageLabel ? <Text style={styles.age}>{ageLabel}</Text> : null}

        <View style={styles.tradesSummary}>
          {trades.map((t, index) => (
            <View key={`${t.title}-${index}`} style={styles.tradeChip}>
              <Text style={styles.tradeChipText}>{t.title}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={({ pressed }) => [styles.proRatingRow, pressed && styles.pressed]}
          accessibilityRole={worker.reviewCount > 0 ? 'button' : 'text'}
          accessibilityLabel={
            worker.reviewCount > 0
              ? `Profesional, calificación ${avgRating.toFixed(1)} de 5. Ver reseñas`
              : `Profesional, sin reseñas aún`
          }
          disabled={worker.reviewCount <= 0}
          onPress={() => {
            if (worker.reviewCount <= 0) return;
            (navigation as unknown as WorkerProfileFlowNav).navigate('WorkerReviews', {
              workerId: reviewsNavWorkerId,
            });
          }}
        >
          <Text style={styles.proLabel}>Profesional</Text>
          <StarRating score={avgRating} reviewCount={worker.reviewCount} size={14} textSize={13} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.postsCta, pressed && styles.pressed]}
          onPress={() =>
            (navigation as unknown as WorkerProfileFlowNav).navigate('WorkerPosts', {
              workerId,
            })
          }
          accessibilityRole="button"
          accessibilityLabel="Ver publicaciones del trabajador"
        >
          <Ionicons name="images-outline" size={22} color={colors.primary} />
          <Text style={styles.postsCtaText}>Ver publicaciones</Text>
          <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
        </Pressable>

        {showVisitorActions ? (
          <View style={styles.contactWrap}>
            {!user ? (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.contactBtn,
                    pressed && styles.contactBtnPressed,
                  ]}
                  onPress={() =>
                    openAuthModal('Register', {
                      redirectTo: workerBackendId ? `worker:${workerBackendId}` : undefined,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Registrarse para contactar"
                >
                  <Text style={styles.contactBtnText}>Registrate para contactar</Text>
                </Pressable>
                <Text style={styles.contactHint}>
                  Creá tu cuenta para chatear con {worker.firstName}.
                </Text>
              </>
            ) : (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.contactBtn,
                    !chatReady && styles.contactBtnMuted,
                    contactBusy && styles.contactBtnMuted,
                    pressed && styles.contactBtnPressed,
                  ]}
                  onPress={() => void onContact()}
                  accessibilityRole="button"
                  accessibilityLabel="Contactar por chat"
                  disabled={!chatReady || contactBusy}
                >
                  <Text style={styles.contactBtnText}>
                    {contactBusy ? 'Abriendo chat…' : 'Contactar'}
                  </Text>
                </Pressable>
                {!chatReady ? (
                  <Text style={styles.contactHint}>
                    Configurá Supabase (URL + anon key) o EXPO_PUBLIC_API_URL con el servidor Node para
                    chatear.
                  </Text>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Sobre {worker.firstName}</Text>
        {worker.bio?.trim() ? (
          <ExpandableText text={worker.bio.trim()} textStyle={styles.bio} />
        ) : null}

        <Text style={styles.sectionTitle}>Oficios</Text>

        {trades.map((trade, index) => {
          const key = `${trade.title}-${index}`;
          return (
          <View key={key} style={styles.tradeCard}>
            <View style={styles.tradeAccent} />
            <Text style={styles.tradeTitle}>{trade.title}</Text>
            <Text style={styles.expPerTrade}>
              {Math.max(1, Math.floor(Number(trade.yearsExperience) || 0))}{' '}
              {Math.max(1, Math.floor(Number(trade.yearsExperience) || 0)) === 1 ? 'año' : 'años'} de
              experiencia en este oficio
            </Text>
            {trade.photoUrls?.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tradePhotos}
                nestedScrollEnabled
              >
                {trade.photoUrls.map((url, photoIndex) => (
                  <Pressable
                    key={`${url}-${photoIndex}`}
                    onPress={() => {
                      setLightboxPhotos(trade.photoUrls ?? []);
                      setLightboxIndex(photoIndex);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Ver foto ampliada"
                    hitSlop={6}
                  >
                    <Image source={{ uri: url }} style={styles.tradePhoto} />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {trade.description?.trim() ? (
              <ExpandableText
                text={trade.description.trim()}
                textStyle={styles.tradeDescriptionText}
                style={styles.tradeDescriptionWrap}
              />
            ) : null}
          </View>
        );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    paddingTop: spacing.md + 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  accent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: colors.primary,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: colors.primary,
    alignSelf: 'center',
    marginTop: spacing.md,
    backgroundColor: colors.imagePlaceholder,
  },
  name: {
    ...typography.title,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  age: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  tradesSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginHorizontal: -4,
  },
  tradeChip: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(198, 40, 40, 0.06)',
    marginHorizontal: 4,
    marginBottom: 8,
  },
  tradeChipText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
  },
  proRatingRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  proLabel: { fontSize: 13, fontWeight: '900', color: colors.textSecondary },
  // rating normalizado via StarRating
  sectionTitle: {
    ...typography.title,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  bio: {
    ...typography.subtitle,
    lineHeight: 24,
    color: colors.textSecondary,
    fontWeight: '400',
  },
  tradeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  pressed: { opacity: 0.9 },
  heartBtn: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md + 4,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    zIndex: 5,
  },
  heartBtnOn: {
    backgroundColor: 'rgba(220,38,38,0.10)',
    borderColor: 'rgba(220,38,38,0.35)',
  },
  tradeAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.primary,
    borderTopLeftRadius: radii.card,
    borderBottomLeftRadius: radii.card,
  },
  tradeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
    marginLeft: spacing.sm,
    marginBottom: spacing.xs,
  },
  expPerTrade: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textSecondary,
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
  },
  tradeDescriptionWrap: {
    marginLeft: spacing.sm,
  },
  tradeDescriptionText: {
    ...typography.body,
    lineHeight: 22,
  },
  tradePhotos: {
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    paddingVertical: 2,
  },
  tradePhoto: {
    width: 150,
    height: 96,
    borderRadius: radii.thumb,
    backgroundColor: colors.imagePlaceholder,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  muted: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  id: {
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 12,
  },
  loadingHint: {
    marginTop: spacing.md,
  },
  authGateBtn: {
    marginTop: spacing.md,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
  },
  authGateBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  postsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'rgba(198, 40, 40, 0.08)',
    gap: spacing.sm,
  },
  postsCtaText: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  contactWrap: { marginTop: spacing.lg },
  contactBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.button,
    alignItems: 'center',
  },
  contactBtnMuted: { opacity: 0.75 },
  contactBtnPressed: { opacity: 0.88 },
  contactBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  contactHint: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
  },
});
