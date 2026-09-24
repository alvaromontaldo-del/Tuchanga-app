import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, spacing } from '../../constants/theme';
import { isRenderableUri, listKey } from '../../utils/safeAsync';

export type PostImageCarouselProps =
  | {
      urls: string[];
      variant: 'feed';
      /** Relación ancho/alto (p. ej. 4/5 vertical estilo Instagram). Por defecto 4/5. */
      aspectRatio?: number;
      onPressImage?: (url: string, index: number) => void;
    }
  | {
      urls: string[];
      variant: 'fixedHeight';
      imageHeight: number;
      onPressImage?: (url: string, index: number) => void;
    };

/**
 * Carrusel horizontal con paging. Variante `feed`: ancho pantalla, puntos flotantes.
 */
export function PostImageCarousel(props: PostImageCarouselProps) {
  const { onPressImage } = props;
  const urls = (Array.isArray(props.urls) ? props.urls : []).filter((u) => isRenderableUri(u));
  const { width: screenWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);

  const isFeed = props.variant === 'feed';
  const aspectRatio = isFeed ? props.aspectRatio ?? 4 / 5 : undefined;
  const pageHeight = isFeed
    ? screenWidth / (aspectRatio ?? 4 / 5)
    : props.variant === 'fixedHeight'
      ? props.imageHeight
      : 0;

  const fallbackWidth = screenWidth - spacing.lg * 2;
  const [trackWidth, setTrackWidth] = useState(isFeed ? screenWidth : fallbackWidth);

  useEffect(() => {
    setActiveIndex(0);
  }, [urls.join('|')]);

  useEffect(() => {
    if (isFeed) {
      setTrackWidth(screenWidth);
    }
  }, [isFeed, screenWidth]);

  const syncIndexFromOffset = useCallback(
    (offsetX: number) => {
      const w = trackWidth;
      if (w <= 0 || urls.length === 0) return;
      const next = Math.min(urls.length - 1, Math.max(0, Math.round(offsetX / w)));
      setActiveIndex((prev) => (prev !== next ? next : prev));
    },
    [trackWidth, urls.length],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      syncIndexFromOffset(e.nativeEvent.contentOffset.x);
    },
    [syncIndexFromOffset],
  );

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      syncIndexFromOffset(e.nativeEvent.contentOffset.x);
    },
    [syncIndexFromOffset],
  );

  if (urls.length === 0) {
    return null;
  }

  const itemW = isFeed ? screenWidth : trackWidth;
  const itemH = pageHeight;

  return (
    <View
      style={[styles.wrap, isFeed && styles.wrapFeed]}
      onLayout={
        isFeed
          ? undefined
          : (e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 0) {
                setTrackWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
              }
            }
      }
    >
      <FlatList
        data={urls}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        keyExtractor={(item, index) => listKey(`${index}:${item.slice(0, 48)}`, index, 'img')}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => onPressImage?.(item, index)} disabled={!onPressImage}>
            <Image
              source={{ uri: item }}
              style={{ width: itemW, height: itemH }}
              resizeMode="cover"
            />
          </Pressable>
        )}
        getItemLayout={(_, index) => ({
          length: itemW,
          offset: itemW * index,
          index,
        })}
      />
      {urls.length > 1 ? (
        <View style={[styles.dots, isFeed && styles.dotsFloating]} pointerEvents="none">
          {urls.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    width: '100%',
  },
  wrapFeed: {
    alignSelf: 'stretch',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  dotsFloating: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.sm,
    paddingVertical: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
    marginHorizontal: 3,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
