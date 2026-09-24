import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  PanResponder,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { isRenderableUri, listKey } from '../../utils/safeAsync';

type Props = {
  photos: string[];
  initialIndex?: number;
  onClose: () => void;
};

/**
 * Visor a pantalla completa con swipe entre fotos.
 * Cierre: tap (fondo o imagen), botón y swipe vertical.
 */
export function ImageLightboxModal({ photos, initialIndex = 0, onClose }: Props) {
  const safePhotos = (Array.isArray(photos) ? photos : []).filter((u) => isRenderableUri(u));
  const visible = safePhotos.length > 0;
  const listRef = useRef<FlatList<string> | null>(null);
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(0)).current;

  const safeIndex = useMemo(() => {
    if (!Number.isFinite(initialIndex)) return 0;
    return Math.max(0, Math.min(safePhotos.length - 1, Math.floor(initialIndex)));
  }, [initialIndex, safePhotos.length]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: safeIndex, animated: false });
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [safeIndex, visible]);

  const pageW = winW;
  const pageH = winH;

  const backdropOpacity = translateY.interpolate({
    inputRange: [-240, 0, 240],
    outputRange: [0.6, 0.92, 0.6],
    extrapolate: 'clamp',
  });

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
              onClose();
            });
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [onClose, translateY],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.shell}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar imagen"
        >
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        </Pressable>

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
          hitSlop={12}
          style={[styles.closeBtn, { top: insets.top + 10, right: 12 }]}
        >
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>

        <Animated.View
          style={[styles.content, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <FlatList
            style={styles.pager}
            ref={(r) => {
              listRef.current = r;
            }}
            data={safePhotos}
            keyExtractor={(u, i) => listKey(`${i}:${u}`, i, 'photo')}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            getItemLayout={(_, index) => ({
              length: pageW,
              offset: pageW * index,
              index,
            })}
            renderItem={({ item: url }) => (
              <Pressable
                style={[styles.page, { width: pageW, height: pageH }]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cerrar imagen"
              >
                <Image
                  source={{ uri: url }}
                  style={[styles.img, { width: pageW, height: pageH }]}
                  resizeMode="contain"
                />
              </Pressable>
            )}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  pager: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute',
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  content: { flex: 1 },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
});
