import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChangaCard } from './ChangaCard';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { FeedPost } from '../../types/feed';
import { formatPostDate } from '../../utils/formatDate';

export type ChangaPostListRowProps = {
  post: FeedPost;
  onPress: () => void;
  /** Menú ⋮ (eliminar, ocultar, etc.) — el padre muestra Alert u hoja */
  onPressMenu?: () => void;
};

function thumbUri(post: FeedPost): string | undefined {
  return post.workImageUrls[0];
}

/**
 * Fila de publicación para listas (Mis trabajos, publicaciones de perfil): misma silueta que resultados de búsqueda.
 */
export function ChangaPostListRow({ post, onPress, onPressMenu }: ChangaPostListRowProps) {
  const uri = thumbUri(post);
  const rating = post.workerRatingAverage;
  const showRating =
    typeof rating === 'number' && !Number.isNaN(rating) && rating > 0;

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
            <Text style={styles.title} numberOfLines={1}>
              {post.workerFirstName}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.subtitle} numberOfLines={1}>
                {post.trade}
              </Text>
              {showRating ? (
                <View style={styles.ratingBadge}>
                  <Text style={styles.ratingNum}>{rating.toFixed(1)}</Text>
                  <Ionicons name="star" size={12} color="#D97706" />
                </View>
              ) : null}
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
  title: {
    ...typography.title,
    fontWeight: '700',
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
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ratingNum: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
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
