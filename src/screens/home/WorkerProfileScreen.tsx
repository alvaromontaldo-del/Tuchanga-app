import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StarRating } from '../../components/profile/StarRating';
import { colors, radii, spacing } from '../../constants/theme';
import { isMessagingAvailable } from '../../config/api';
import { isSupabaseConfigured } from '../../config/supabase';
import { useAuth } from '../../context/AuthContext';
import { useUserMode } from '../../context/UserModeContext';
import { getWorkerBackendUserId, isWorkerUserIdUuid } from '../../data/workerChatIds';
import { getWorkerById } from '../../data/mockFeed';
import { openAuthModal } from '../../navigation/openAuthModal';
import { openOrCreateChat } from '../../services/messaging';
import { fetchWorkerPublicProfileFromSupabase } from '../../services/workerProfileSupabase';
import type {
  FeedStackScreenProps,
  SearchStackScreenProps,
} from '../../navigation/mainTypes';
import type { WorkerPublicProfile, WorkerTradeEntry } from '../../types/feed';

type Props =
  | FeedStackScreenProps<'WorkerProfile'>
  | SearchStackScreenProps<'WorkerProfile'>;

/** Evita conflicto de tipos entre stack de feed y de búsqueda (mismas rutas). */
type WorkerProfileFlowNav = NativeStackNavigationProp<
  {
    WorkerProfile: { workerId: string };
    WorkerReviews: { workerId: string };
    ChatConversation: {
      conversationId: string;
      otherDisplayName: string;
      headerSubtitle: string;
    };
  },
  'WorkerProfile'
>;

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
  const { workerId } = route.params;
  const { workerTrade, isWorkerMode } = useUserMode();
  const { user } = useAuth();
  const mockWorker = getWorkerById(workerId);
  const [remoteWorker, setRemoteWorker] = useState<WorkerPublicProfile | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'loading' | 'done'>('idle');

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
    setRemoteStatus('loading');
    let cancelled = false;
    void fetchWorkerPublicProfileFromSupabase(workerId).then((w) => {
      if (!cancelled) {
        setRemoteWorker(w);
        setRemoteStatus('done');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workerId]);

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
        <Text style={styles.id}>ID: {workerId}</Text>
      </View>
    );
  }

  const trades =
    worker.id === 'me'
      ? mergeTradesForCurrentUser(worker.trades, workerTrade)
      : worker.trades;

  const openReviews =
    worker.reviewCount > 0
      ? () =>
          (navigation as unknown as WorkerProfileFlowNav).navigate(
            'WorkerReviews',
            { workerId },
          )
      : undefined;

  const workerBackendId = getWorkerBackendUserId(workerId);
  const primaryTradeLabel = trades[0]?.title ?? worker.trade;
  const isOtherProfile = workerId !== 'me' && Boolean(workerBackendId);
  const chatReady = isMessagingAvailable();

  const workerFirst = worker.firstName;

  async function onContact() {
    if (!user?.id || !workerBackendId) return;
    if (isWorkerMode) return;
    if (!isMessagingAvailable()) {
      Alert.alert(
        'Configurar chat',
        'Agregá Supabase (EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY) o el servidor Node (EXPO_PUBLIC_API_URL) y reiniciá Expo.',
      );
      return;
    }
    try {
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
      });
    } catch (e) {
      Alert.alert('Chat', e instanceof Error ? e.message : 'No se pudo abrir el chat');
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <View style={styles.accent} />
        <Image source={{ uri: worker.avatarUrl }} style={styles.avatar} />
        <Text style={styles.name}>{worker.firstName}</Text>

        <View style={styles.tradesSummary}>
          {trades.map((t, index) => (
            <View key={`${t.title}-${index}`} style={styles.tradeChip}>
              <Text style={styles.tradeChipText}>{t.title}</Text>
            </View>
          ))}
        </View>

        <StarRating
          value={worker.ratingAverage}
          reviewCount={worker.reviewCount}
          onPressReviews={openReviews}
        />

        {isOtherProfile ? (
          <View style={styles.contactWrap}>
            {!user ? (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.contactBtn,
                    pressed && styles.contactBtnPressed,
                  ]}
                  onPress={() => openAuthModal('Login')}
                  accessibilityRole="button"
                  accessibilityLabel="Iniciar sesión para contactar"
                >
                  <Text style={styles.contactBtnText}>Iniciá sesión para contactar</Text>
                </Pressable>
                <Text style={styles.contactHint}>
                  Creá o ingresá a tu cuenta para chatear con {worker.firstName}.
                </Text>
              </>
            ) : isWorkerMode ? (
              <Text style={styles.contactHint}>
                Como profesional, los mensajes de clientes aparecen en el tab Mensajes. No podés
                iniciar un chat desde el perfil de otro profesional.
              </Text>
            ) : (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.contactBtn,
                    !chatReady && styles.contactBtnMuted,
                    pressed && styles.contactBtnPressed,
                  ]}
                  onPress={() => void onContact()}
                  accessibilityRole="button"
                  accessibilityLabel="Contactar por chat"
                >
                  <Text style={styles.contactBtnText}>Contactar</Text>
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
        <Text style={styles.bio}>{worker.bio}</Text>

        <Text style={styles.sectionTitle}>Oficios</Text>

        {trades.map((item, index) => (
          <View key={`${item.title}-${index}`} style={styles.tradeCard}>
            <View style={styles.tradeAccent} />
            <Text style={styles.tradeTitle}>{item.title}</Text>
            <Text style={styles.expPerTrade}>
              {item.yearsExperience}{' '}
              {item.yearsExperience === 1 ? 'año' : 'años'} de experiencia en este oficio
            </Text>
            <Text style={styles.tradeDescription}>{item.description}</Text>
          </View>
        ))}
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
    backgroundColor: '#121212',
    borderRadius: radii.card,
    padding: spacing.lg,
    paddingTop: spacing.md + 4,
    borderWidth: 1,
    borderColor: '#2C2C2C',
    overflow: 'hidden',
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
    backgroundColor: '#2C2C2C',
  },
  name: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FAFAFA',
    textAlign: 'center',
    marginTop: spacing.md,
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
    backgroundColor: '#1A1A1A',
    marginHorizontal: 4,
    marginBottom: 8,
  },
  tradeChipText: {
    color: '#F5F5F5',
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FAFAFA',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  bio: {
    fontSize: 16,
    lineHeight: 24,
    color: '#D1D5DB',
  },
  tradeCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#2C2C2C',
    overflow: 'hidden',
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
    fontSize: 14,
    fontWeight: '700',
    color: '#E5E7EB',
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
  },
  tradeDescription: {
    fontSize: 15,
    lineHeight: 22,
    color: '#E5E7EB',
    marginLeft: spacing.sm,
    opacity: 0.92,
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
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 17,
  },
});
