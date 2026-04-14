import { FlatList, StyleSheet, Text, View } from 'react-native';
import { IntegerRatingStars } from '../../components/profile/IntegerRatingStars';
import { colors, radii, spacing } from '../../constants/theme';
import { getReviewsForWorker, getWorkerById } from '../../data/mockFeed';
import type {
  FeedStackScreenProps,
  SearchStackScreenProps,
} from '../../navigation/mainTypes';
import type { WorkerReview } from '../../types/feed';
import { formatPostDate } from '../../utils/formatDate';

type Props =
  | FeedStackScreenProps<'WorkerReviews'>
  | SearchStackScreenProps<'WorkerReviews'>;

function ReviewRow({ item }: { item: WorkerReview }) {
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewAccent} />
      <Text style={styles.clientName}>{item.clientFirstName}</Text>
      <View style={styles.starsWrap}>
        <IntegerRatingStars rating={item.rating} size={20} />
      </View>
      <Text style={styles.comment}>{item.comment}</Text>
      <Text style={styles.date}>{formatPostDate(item.createdAt)}</Text>
    </View>
  );
}

/**
 * Listado de reseñas con nombre del cliente (sin apellido) y puntuación.
 */
export function WorkerReviewsScreen({ route }: Props) {
  const { workerId } = route.params;
  const worker = getWorkerById(workerId);
  const reviews = getReviewsForWorker(workerId);

  if (!worker) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>Trabajador no encontrado.</Text>
      </View>
    );
  }

  if (reviews.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>
          {worker.firstName} todavía no tiene reseñas públicas.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={reviews}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => <ReviewRow item={item} />}
      ListHeaderComponent={
        <Text style={styles.header}>
          Opiniones de clientes sobre {worker.firstName}
        </Text>
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
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  reviewCard: {
    backgroundColor: '#121212',
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#2C2C2C',
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
    fontWeight: '800',
    color: '#FAFAFA',
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
  },
  starsWrap: {
    marginLeft: spacing.sm,
  },
  comment: {
    fontSize: 15,
    lineHeight: 22,
    color: '#E5E7EB',
    marginLeft: spacing.sm,
    marginTop: spacing.sm,
  },
  date: {
    fontSize: 12,
    color: '#9CA3AF',
    marginLeft: spacing.sm,
    marginTop: spacing.sm,
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
  },
});
