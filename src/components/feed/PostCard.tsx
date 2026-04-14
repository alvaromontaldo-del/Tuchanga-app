import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { PostImageCarousel } from './PostImageCarousel';
import { colors, radii, spacing } from '../../constants/theme';
import { formatPostDate } from '../../utils/formatDate';
import type { FeedPost } from '../../types/feed';

type Props = {
  post: FeedPost;
  onToggleLike: () => void;
  onOpenProfile: () => void;
};

/**
 * Tarjeta de publicación: hasta 3 fotos con desliz, texto y acciones.
 */
export function PostCard({ post, onToggleLike, onOpenProfile }: Props) {
  const { width, height } = useWindowDimensions();
  const cardInnerWidth = width - spacing.lg * 2;
  const imageHeight = Math.round(cardInnerWidth * 0.62);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [activeLightboxIndex, setActiveLightboxIndex] = useState(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const pagerRef = useRef<FlatList<string> | null>(null);

  const closeLightbox = useMemo(
    () => () => {
      Animated.timing(translateY, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start(() => setLightboxIndex(null));
    },
    [translateY],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
        onPanResponderMove: (_, g) => {
          translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          const shouldClose = Math.abs(g.dy) > 140 || Math.abs(g.vy) > 1.2;
          if (shouldClose) {
            Animated.timing(translateY, {
              toValue: g.dy > 0 ? 900 : -900,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              translateY.setValue(0);
              setLightboxIndex(null);
            });
            return;
          }

          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [translateY],
  );

  const backdropOpacity = translateY.interpolate({
    inputRange: [-240, 0, 240],
    outputRange: [0.6, 0.9, 0.6],
    extrapolate: 'clamp',
  });

  async function onShare() {
    try {
      const { workerFirstName, trade, workerId } = post;
      const message = `¡Mirá el trabajo de ${workerFirstName} en Tu Changa! Oficio: ${trade}. Link: https://tuchanga.app/perfil/${workerId}`;
      await Share.share({
        message,
        title: 'Tu Changa',
      });
    } catch {
      // Cancelación del sheet o error del sistema: no mostramos nada ruidoso
    }
  }

  return (
    <View style={styles.outer}>
      <View style={styles.card}>
        <View style={styles.accentBar} />

        <Pressable
          onPress={onOpenProfile}
          style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        >
          <Image source={{ uri: post.workerAvatarUrl }} style={styles.avatar} />
          <View style={styles.headerText}>
            <Text style={styles.name}>{post.workerFirstName}</Text>
            <Text style={styles.trade}>{post.trade}</Text>
          </View>
          <Text style={styles.date}>{formatPostDate(post.createdAt)}</Text>
        </Pressable>

        <PostImageCarousel
          urls={post.workImageUrls}
          imageHeight={imageHeight}
          onPressImage={(_url, index) => {
            translateY.setValue(0);
            setActiveLightboxIndex(index);
            setLightboxIndex(index);
            requestAnimationFrame(() => {
              if (pagerRef.current && index > 0) {
                pagerRef.current.scrollToIndex({ index, animated: false });
              }
            });
          }}
        />

        <Text style={styles.description}>{post.description}</Text>

        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <Pressable
              onPress={onToggleLike}
              style={styles.likeRow}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={post.likedByMe ? 'Quitar me gusta' : 'Me gusta'}
            >
              <Ionicons
                name={post.likedByMe ? 'heart' : 'heart-outline'}
                size={26}
                color={post.likedByMe ? colors.primary : '#E0E0E0'}
              />
              <Text style={styles.likeCount}>{post.likeCount}</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                void onShare();
              }}
              style={styles.shareBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Compartir publicación"
            >
              <Ionicons name="share-outline" size={24} color="#E0E0E0" />
            </Pressable>
          </View>

          <Pressable onPress={onOpenProfile} hitSlop={8}>
            <Text style={styles.profileLink}>Ver perfil</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={lightboxIndex != null}
        transparent
        animationType="fade"
        onRequestClose={closeLightbox}
      >
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={closeLightbox}
          accessibilityRole="button"
          accessibilityLabel="Cerrar imagen (tocar fondo)"
        >
          <Animated.View
            style={[
              styles.lightboxBackdrop,
              { opacity: backdropOpacity },
            ]}
          />
        </Pressable>

        <View style={styles.lightboxShell}>
          <Pressable
            style={styles.lightboxCloseBtn}
            onPress={closeLightbox}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Cerrar imagen"
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>

          <Animated.View
            style={[styles.lightboxContent, { transform: [{ translateY }] }]}
            {...panResponder.panHandlers}
          >
            <FlatList
              ref={(node) => {
                pagerRef.current = node;
              }}
              data={post.workImageUrls}
              style={styles.lightboxPager}
              contentContainerStyle={{ height: '100%' }}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, index) => `${index}-${item}`}
              initialScrollIndex={lightboxIndex ?? 0}
              getItemLayout={(_, index) => ({
                length: width,
                offset: width * index,
                index,
              })}
              onScroll={(e) => {
                const next = Math.round(e.nativeEvent.contentOffset.x / width);
                setActiveLightboxIndex((prev) => (prev !== next ? next : prev));
              }}
              scrollEventThrottle={16}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.lightboxPage, { width, height }]}
                  onPress={closeLightbox}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar imagen"
                >
                  <Image
                    source={{ uri: item }}
                    style={[styles.lightboxImage, { width, height }]}
                    resizeMode="contain"
                  />
                </Pressable>
              )}
              onScrollToIndexFailed={() => {
                // noop: si falla, queda en la primera.
              }}
            />

            {post.workImageUrls.length > 1 ? (
              <View style={styles.lightboxDots}>
                {post.workImageUrls.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.lightboxDot,
                      i === activeLightboxIndex && styles.lightboxDotActive,
                    ]}
                  />
                ))}
              </View>
            ) : null}
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: '#121212',
    borderRadius: radii.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2C2C2C',
  },
  accentBar: {
    height: 4,
    backgroundColor: colors.primary,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  pressed: {
    opacity: 0.85,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: '#2C2C2C',
  },
  headerText: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  trade: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  date: {
    fontSize: 12,
    color: '#9CA3AF',
    alignSelf: 'flex-start',
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#E5E5E5',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  likeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shareBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  likeCount: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  profileLink: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  lightboxBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  lightboxShell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    pointerEvents: 'box-none',
  },
  lightboxCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  lightboxContent: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  lightboxImage: {
    backgroundColor: 'transparent',
  },
  lightboxPager: {
    flex: 1,
  },
  lightboxPage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  lightboxDots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  lightboxDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginHorizontal: 4,
  },
  lightboxDotActive: {
    backgroundColor: colors.primary,
    width: 9,
    height: 9,
    borderRadius: 5,
  },
});
