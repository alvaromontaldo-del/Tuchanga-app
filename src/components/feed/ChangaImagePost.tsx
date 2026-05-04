import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { ClickableAvatar } from '../common/ClickableAvatar';
import { ExpandableText } from '../common/ExpandableText';
import { PostImageCarousel } from './PostImageCarousel';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { formatPostDate } from '../../utils/formatDate';
import type { FeedPost } from '../../types/feed';
import { StarRating } from '../profile/StarRating';

type Props = {
  post: FeedPost;
  onToggleLike: () => void;
  onOpenProfile: () => void;
  onOpenMessage?: () => void | Promise<void>;
  showMessageButton?: boolean;
  onRequestDelete?: () => void;
  onRequestHide?: () => void;
};

/**
 * Publicación tipo feed inmersivo: cabecera, carrusel a ancho completo, acciones y descripción.
 */
export function ChangaImagePost({
  post,
  onToggleLike,
  onOpenProfile,
  onOpenMessage,
  showMessageButton = Boolean(onOpenMessage),
  onRequestDelete,
  onRequestHide,
}: Props) {
  const insets = useSafeAreaInsets();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const showMenu = Boolean(onRequestDelete || onRequestHide);
  const rating = post.workerRatingAverage;
  const reviewCount = post.workerReviewCount;

  async function onShare() {
    try {
      const { workerFirstName, trade, workerId } = post;
      const message = `¡Mirá el trabajo de ${workerFirstName} en Tu Changa! Oficio: ${trade}. Link: https://tuchanga.app/perfil/${workerId}`;
      await Share.share({
        message,
        title: 'Tu Changa',
      });
    } catch {
      /* cancelación */
    }
  }

  async function onPressMessage() {
    if (!onOpenMessage) return;
    try {
      await onOpenMessage();
    } catch {
      /* toast en el caller */
    }
  }

  return (
    <View style={styles.block}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onOpenProfile}
          style={({ pressed }) => [styles.headerMain, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Perfil de ${post.workerFirstName}`}
        >
          <ClickableAvatar uri={post.workerAvatarUrl} style={styles.avatar} />
          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {post.workerFirstName}
              </Text>
              <StarRating
                score={rating}
                reviewCount={reviewCount}
                size={12}
                textSize={12}
              />
            </View>
            <View style={styles.tradeRow}>
              <Text style={styles.trade} numberOfLines={1}>
                {post.trade}
              </Text>
            </View>
            <Text style={styles.date}>{formatPostDate(post.createdAt)}</Text>
          </View>
        </Pressable>

        {showMenu ? (
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={12}
            style={({ pressed }) => [styles.menuTrigger, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Opciones de la publicación"
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.menuTriggerPlaceholder} />
        )}
      </View>

      <PostImageCarousel
        urls={post.workImageUrls}
        variant="feed"
        aspectRatio={4 / 5}
        onPressImage={(_url, index) => setLightboxIndex(index)}
      />

      <View style={styles.actions}>
        <Pressable
          onPress={onToggleLike}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={post.likedByMe ? 'Quitar me gusta' : 'Me gusta'}
        >
          <Ionicons
            name={post.likedByMe ? 'heart' : 'heart-outline'}
            size={26}
            color={post.likedByMe ? colors.primary : colors.text}
          />
          <Text style={styles.likeCount}>{post.likeCount}</Text>
        </Pressable>

        {showMessageButton && onOpenMessage ? (
          <Pressable
            onPress={() => void onPressMessage()}
            style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Mensaje al profesional"
          >
            <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => {
            void onShare();
          }}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Compartir publicación"
        >
          <Ionicons name="share-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.bodyPad}>
        <ExpandableText
          text={post.description}
          numberOfLinesCollapsed={2}
          textStyle={styles.description}
          moreAlign="right"
        />
      </View>

      <ImageLightboxModal
        photos={lightboxIndex != null ? post.workImageUrls : []}
        initialIndex={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
      />

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setMenuOpen(false)} />
          <View style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.sheetCard}>
              <Text style={styles.sheetTitle}>Publicación</Text>
              {onRequestDelete ? (
                <Pressable
                  style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                  onPress={() => {
                    setMenuOpen(false);
                    onRequestDelete();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Eliminar publicación"
                >
                  <Ionicons name="trash-outline" size={20} color={colors.error} />
                  <Text style={styles.sheetDelete}>Eliminar</Text>
                </Pressable>
              ) : null}
              {onRequestHide ? (
                <Pressable
                  style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                  onPress={() => {
                    setMenuOpen(false);
                    onRequestHide();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Ocultar publicación"
                >
                  <Ionicons name="eye-off-outline" size={20} color={colors.text} />
                  <Text style={styles.sheetNeutral}>Ocultar</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}
                onPress={() => setMenuOpen(false)}
              >
                <Text style={styles.sheetCancelText}>Cancelar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    width: '100%',
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    minWidth: 0,
  },
  menuTrigger: {
    paddingLeft: spacing.sm,
    paddingTop: 2,
    marginLeft: spacing.xs,
  },
  menuTriggerPlaceholder: {
    width: 34,
  },
  pressed: {
    opacity: 0.85,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(198, 40, 40, 0.35)',
    backgroundColor: colors.border,
  },
  headerText: {
    flex: 1,
    marginLeft: spacing.sm,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 8,
  },
  name: {
    ...typography.title,
    fontWeight: '700',
    flexShrink: 1,
  },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  trade: {
    ...typography.subtitle,
    color: colors.primary,
    fontWeight: '600',
    flexShrink: 1,
  },
  date: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 4,
  },
  bodyPad: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  description: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  likeCount: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
    minWidth: 20,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheetWrap: {
    width: '100%',
    zIndex: 2,
  },
  sheetCard: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 5,
      },
      android: { elevation: 3 },
    }),
  },
  sheetTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
  },
  sheetDelete: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.error,
  },
  sheetNeutral: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  sheetCancel: {
    marginTop: spacing.xs,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetCancelText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
});
