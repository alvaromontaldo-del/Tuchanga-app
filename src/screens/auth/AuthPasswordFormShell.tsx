import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { BrandLogoHorizontal } from '../../components/brand/BrandMark';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppScreen } from '../../components/layout/AppScreen';
import { colors, spacing } from '../../constants/theme';

type Props = {
  children: React.ReactNode;
  onBack?: () => void;
};

/**
 * Contenedor de pantallas de contraseña con logo hero (mismo criterio que Login).
 */
export function AuthPasswordFormShell({ children, onBack }: Props) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 440);

  return (
    <AppScreen style={styles.flex} edges={['top', 'left', 'right', 'bottom']}>
      <AppKeyboardAvoidingView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Volver"
              hitSlop={12}
            >
              <Ionicons name="chevron-back" size={28} color={colors.text} />
            </Pressable>
          ) : null}

          <View style={[styles.card, { width: contentWidth }]}>
            <View style={styles.brandWrap}>
              <BrandLogoHorizontal
                variant="hero"
                maxWidth={contentWidth}
                style={styles.brandLogo}
              />
            </View>
            {children}
          </View>
        </ScrollView>
      </AppKeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    alignSelf: 'center',
  },
  brandWrap: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  brandLogo: {
    alignSelf: 'center',
  },
});
