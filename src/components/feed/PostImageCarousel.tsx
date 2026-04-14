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

type Props = {
  urls: string[];
  imageHeight: number;
  onPressImage?: (url: string, index: number) => void;
};

/**
 * Carrusel horizontal con desliz (hasta 3 fotos). Los puntos siguen la foto visible.
 */
export function PostImageCarousel({ urls, imageHeight, onPressImage }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const fallbackWidth = screenWidth - spacing.lg * 2;
  /** Ancho real del carrusel (onLayout); debe coincidir con cada ítem para que paging e índice cuadren */
  const [trackWidth, setTrackWidth] = useState(fallbackWidth);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [urls.join('|')]);

  const syncIndexFromOffset = useCallback(
    (offsetX: number) => {
      const w = trackWidth;
      if (w <= 0 || urls.length === 0) return;
      const next = Math.min(
        urls.length - 1,
        Math.max(0, Math.round(offsetX / w)),
      );
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

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0) {
          setTrackWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
        }
      }}
    >
      <FlatList
        data={urls}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        keyExtractor={(item, index) => `${index}-${item}`}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => onPressImage?.(item, index)}
            disabled={!onPressImage}
          >
            <Image
              source={{ uri: item }}
              style={{ width: trackWidth, height: imageHeight }}
              resizeMode="cover"
            />
          </Pressable>
        )}
        getItemLayout={(_, index) => ({
          length: trackWidth,
          offset: trackWidth * index,
          index,
        })}
      />
      {urls.length > 1 ? (
        <View style={styles.dots}>
          {urls.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === activeIndex && styles.dotActive]}
            />
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
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4B5563',
    marginHorizontal: 3,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
