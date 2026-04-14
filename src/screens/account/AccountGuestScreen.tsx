import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../constants/theme';
import { openAuthModal } from '../../navigation/openAuthModal';
import { accountUi } from './accountUi';

/**
 * Tab Perfil sin sesión: solo acceso a login o registro (sin menú de cuenta).
 */
export function AccountGuestScreen() {
  return (
    <SafeAreaView style={accountUi.screenBg} edges={['top']}>
      <View style={styles.pageHeader}>
        <Text style={[accountUi.pageTitle, styles.centerText]}>Perfil</Text>
        <Text style={[accountUi.pageSubtitle, styles.centerText]}>
          Iniciá sesión o creá una cuenta para usar el chat, publicar y guardar tu perfil.
        </Text>
      </View>

      <View style={[accountUi.card, styles.authCard]}>
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={() => openAuthModal('Login')}
          accessibilityRole="button"
          accessibilityLabel="Iniciar sesión"
        >
          <Ionicons name="log-in-outline" size={22} color="#fff" />
          <Text style={styles.primaryBtnText}>Iniciar sesión</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={() => openAuthModal('Register')}
          accessibilityRole="button"
          accessibilityLabel="Crear cuenta"
        >
          <Text style={styles.secondaryBtnText}>Crear cuenta</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    alignItems: 'center',
  },
  centerText: { textAlign: 'center' },
  authCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.button,
  },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radii.button,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  secondaryBtnText: { fontSize: 16, fontWeight: '800', color: colors.primary },
  pressed: { opacity: 0.9 },
});
