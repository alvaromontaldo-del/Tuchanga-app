import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChangaCard } from './ChangaCard';
import { StarRating } from '../profile/StarRating';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { FeedPost } from '../../types/feed';
import { formatPostDate } from '../../utils/formatDate';
import { professionalDisplayNameForClient } from '../../utils/professionalDisplayName';
import { FeedPublicationMeta } from './FeedPublicationMeta';
import { canShowWorkerReputation } from '../../utils/workerReputation';

export type ChangaPostListRowProps = {
  post: FeedPost;
  onPress: () => void;
  /** Menú ⋮ (eliminar, ocultar, etc.) — el padre muestra Alert u hoja */
  onPressMenu?: () => void;
  /** Estrellas de ranking. Default true; Mis publicaciones las oculta. */
  showWorkerRating?: boolean;
};

function thumbUri(post: FeedPost): string | undefined {
  return post.workImageUrls[0];
}

/**
 * Fila de publicación para listas (Mis trabajos, publicaciones de perfil): misma silueta que resultados de búsqueda.
 */
export function ChangaPostListRow({
  post,
  onPress,
  onPressMenu,
  showWorkerRating = true,
}: ChangaPostListRowProps) {
  const uri = thumbUri(post);
  const rating = post.workerRatingAverage;
  const jobsDone = post.workerTotalJobsDone;
  const showNuevo =
    showWorkerRating && jobsDone !== undefined && !canShowWorkerReputation(jobsDone);

  return (
    <View style={styles.wrap}>
      <ChangaCard style={styles.card}>
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [styles.mainPress, pressed && styles.mainPressed]}
          accessibilityRole="button"
          accessibilityLabel="Abrir publicación"
        >
          <View style={styles.thumbBox}>
            {uri ? (
              <Image source={{ uri }} style={styles.thumbImg} resizeMode="contain" />
            ) : (
              <Ionicons name="image-outline" size={32} color={colors.textSecondary} />
            )}
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>
                {professionalDisplayNameForClient(post.workerFirstName)}
              </Text>
              {showNuevo ? (
                <StarRating completedJobs={jobsDone} score={rating} inline size={12} textSize={12} />
              ) : null}
              <FeedPublicationMeta
                score={rating}
                jobs={jobsDone}
                antecedentesAprobado={post.workerAntecedentesAprobado}
                oficios={post.workerMatriculasVerificadas}
                showScore={showWorkerRating && !showNuevo}
              />
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.subtitle} numberOfLines={1}>
                {post.trade}
              </Text>
            </View>
            <Text style={styles.preview} numberOfLines={2}>
              {post.description}
            </Text>
            <Text style={styles.date}>{formatPostDate(post.createdAt)}</Text>
          </View>
        </Pressable>

        {onPressMenu ? (
          <Pressable
            onPress={onPressMenu}
            hitSlop={10}
            style={({ pressed }) => [styles.kebab, pressed && styles.kebabPressed]}
            accessibilityRole="button"
            accessibilityLabel="Opciones de la publicación"
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </ChangaCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
  },
  card: { width: '100%', minWidth: 0 },
  mainPress: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mainPressed: { opacity: 0.96 },
  thumbBox: {
    width: 90,
    height: 90,
    borderRadius: radii.thumb,
    backgroundColor: colors.imagePlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  body: {
    flex: 1,
    marginLeft: spacing.md,
    minWidth: 0,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  title: {
    ...typography.title,
    fontWeight: '700',
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 4,
  },
  subtitle: {
    ...typography.subtitle,
    color: colors.primary,
    fontWeight: '600',
    flexShrink: 1,
  },
  preview: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 6,
  },
  date: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 6,
  },
  kebab: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
  },
  kebabPressed: { opacity: 0.75 },
});
