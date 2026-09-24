import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { IntegerRatingStars } from '../../components/profile/IntegerRatingStars';
import { ExpandableText } from '../../components/common/ExpandableText';
import { colors, radii, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { getWorkerBackendUserId } from '../../data/workerChatIds';
import { getReviewsForWorker, getWorkerById } from '../../data/mockFeed';
import { getSupabaseClient } from '../../lib/supabase';
import type {
  FeedStackScreenProps,
  MessagesStackScreenProps,
  SearchStackScreenProps,
} from '../../navigation/mainTypes';
import type { WorkerReview } from '../../types/feed';
import { formatPostDate } from '../../utils/formatDate';
import { listKey } from '../../utils/safeAsync';

type Props =
  | FeedStackScreenProps<'WorkerReviews'>
  | SearchStackScreenProps<'WorkerReviews'>
  | MessagesStackScreenProps<'WorkerReviews'>;

function ReviewRow({ item }: { item: WorkerReview }) {
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewAccent} />
      <Text style={styles.clientName}>{item.clientFirstName}</Text>
      <View style={styles.starsWrap}>
        <IntegerRatingStars rating={item.rating} size={20} />
      </View>
      {item.comment?.trim() ? (
        <ExpandableText
          key={`${item.id}-comment`}
          text={item.comment.trim()}
          textStyle={styles.commentText}
          style={styles.commentWrap}
        />
      ) : null}
      <Text style={styles.date}>{formatPostDate(item.createdAt)}</Text>
    </View>
  );
}

/**
 * Listado de reseñas con nombre del cliente (sin apellido) y puntuación.
 * - Mocks: usa `getWorkerById` + `getReviewsForWorker`
 * - Supabase: consulta `worker_reviews` por `worker_id` (UUID real)
 */
export function WorkerReviewsScreen({ route }: Props) {
  const { workerId } = route.params;
  const mockWorker = getWorkerById(workerId);
  const backendWorkerId = useMemo(() => getWorkerBackendUserId(workerId) ?? '', [workerId]);

  const [loading, setLoading] = useState(false);
  const [remoteReviews, setRemoteReviews] = useState<WorkerReview[] | null>(null);
  const [remoteWorkerName, setRemoteWorkerName] = useState<string | null>(null);

  const reviews = useMemo(() => {
    if (remoteReviews) return remoteReviews;
    return getReviewsForWorker(workerId);
  }, [remoteReviews, workerId]);

  useEffect(() => {
    let cancelled = false;

    if (!isSupabaseConfigured() || !backendWorkerId) {
      setRemoteReviews(null);
      setRemoteWorkerName(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    void (async () => {
      try {
        const sb = getSupabaseClient();

        // Nombre para header (perfiles reales UUID)
        if (!mockWorker) {
          const { data: p } = await sb.from('profiles').select('nombre').eq('id', backendWorkerId).maybeSingle();
          const first = String((p as any)?.nombre ?? '').trim().split(/\s+/)[0] || '';
          if (!cancelled) setRemoteWorkerName(first || null);
        } else {
          if (!cancelled) setRemoteWorkerName(null);
        }

        const { data, error } = await sb
          .from('worker_reviews')
          .select('id,client_id,rating,comment,created_at')
          .eq('worker_id', backendWorkerId)
          .order('created_at', { ascending: false })
          .limit(80);
        if (error) throw error;

        const rows = (data ?? []) as any[];
        const clientIds = Array.from(new Set(rows.map((r) => String(r.client_id ?? '')).filter(Boolean)));

        const nameById: Record<string, string> = {};
        if (clientIds.length) {
          const { data: profiles, error: pe } = await sb.from('profiles').select('id,nombre').in('id', clientIds);
          if (!pe) {
            for (const p of (profiles ?? []) as any[]) {
              nameById[String(p.id)] = String(p.nombre ?? '').trim() || 'Cliente';
            }
          }
        }

        const mapped: WorkerReview[] = rows.map((r) => {
          const clientId = String(r.client_id ?? '');
          return {
            id: String(r.id),
            clientFirstName: nameById[clientId] || 'Cliente',
            rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))),
            comment: String(r.comment ?? ''),
            createdAt: String(r.created_at),
          };
        });

        if (!cancelled) setRemoteReviews(mapped);
      } catch {
        if (!cancelled) setRemoteReviews(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [backendWorkerId, mockWorker, workerId]);

  const displayName = mockWorker?.firstName ?? remoteWorkerName ?? 'Profesional';

  if (loading) {
    return (
      <View style={styles.emptyWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Sin Supabase / sin UUID backend: requerimos mock worker para mostrar el listado mock.
  if (!isSupabaseConfigured() || !backendWorkerId) {
    if (!mockWorker) {
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>Trabajador no encontrado.</Text>
        </View>
      );
    }
  }

  if (reviews.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>{displayName} todavía no tiene reseñas públicas.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={reviews}
      keyExtractor={(r, index) => listKey(r?.id, index, 'review')}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => <ReviewRow item={item} />}
      ListHeaderComponent={
        <Text style={styles.header}>Opiniones de clientes sobre {displayName}</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  header: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  reviewAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.primary,
  },
  clientName: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.text,
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
  },
  starsWrap: {
    marginLeft: spacing.sm,
  },
  commentWrap: {
    marginLeft: spacing.sm,
    marginTop: spacing.sm,
  },
  commentText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  date: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
    marginTop: spacing.sm,
    fontWeight: '700',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  empty: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '600',
  },
});
