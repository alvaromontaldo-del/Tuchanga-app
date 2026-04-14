import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogoHorizontal } from '../../components/brand/BrandMark';
import { PostCard } from '../../components/feed/PostCard';
import { colors, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useFeed } from '../../context/FeedContext';
import type { FeedStackParamList } from '../../navigation/mainTypes';
import { openAuthModal } from '../../navigation/openAuthModal';

type Nav = NativeStackNavigationProp<FeedStackParamList>;

/**
 * Feed principal: prioriza el contenido; cuenta y modo trabajador viven en Perfil.
 */
export function HomeScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const homeLogoMaxWidth = Math.min(windowWidth - spacing.lg * 2 - 120, 280);
  const { posts, toggleLike } = useFeed();
  const { user, flashMessage, setFlashMessage } = useAuth();

  useEffect(() => {
    if (!flashMessage) return;
    const t = setTimeout(() => {
      Alert.alert('Tu Changa', flashMessage);
      setFlashMessage(null);
    }, 80);
    return () => clearTimeout(t);
  }, [flashMessage, setFlashMessage]);

  return (
    <View style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View
              style={styles.brandLockup}
              accessibilityRole="header"
              accessibilityLabel="Tu Changa"
            >
              <BrandLogoHorizontal
                variant="hero"
                maxWidth={homeLogoMaxWidth}
                style={styles.brandHeroLogo}
              />
            </View>
            {!user ? (
              <Pressable
                onPress={() => openAuthModal('Login')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Entrá o registrate"
                style={styles.guestLinkWrap}
              >
                <Text style={styles.guestLink}>Entrá o registrate</Text>
              </Pressable>
            ) : (
              <View style={styles.headerTopSpacer} />
            )}
          </View>
          <Text style={styles.tagline}>Trabajos y recomendaciones</Text>
        </View>

        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onToggleLike={() => toggleLike(post.id)}
            onOpenProfile={() =>
              navigation.navigate('WorkerProfile', { workerId: post.workerId })
            }
          />
        ))}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  brandLockup: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: 2,
    justifyContent: 'center',
  },
  brandHeroLogo: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  headerTopSpacer: {
    flex: 1,
  },
  tagline: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  guestLinkWrap: {
    paddingVertical: 2,
    maxWidth: '38%',
  },
  guestLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  bottomSpacer: {
    height: spacing.lg,
  },
});
