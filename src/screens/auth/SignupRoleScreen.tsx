import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';
import {
  SIGNUP_ROLE_SCREEN_OPTIONS,
  signupRoleRegisterTarget,
} from '../../navigation/signupRoleEntry';
import type { AuthStackScreenProps } from '../../navigation/types';
import { AuthPasswordFormShell } from './AuthPasswordFormShell';

type Props = AuthStackScreenProps<'SignupRole'>;

/**
 * Alta: el usuario elige Cliente, Profesional o Comercio.
 * Cada botón abre el registro que ya existe para ese perfil.
 */
export function SignupRoleScreen({ navigation, route }: Props) {
  const redirectTo = route.params?.redirectTo;

  return (
    <AuthPasswordFormShell
      onBack={() => {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('Login', redirectTo ? { redirectTo } : undefined);
      }}
    >
      <Text style={styles.title}>Elegí cómo registrarte</Text>
      <Text style={styles.subtitle}>Cada perfil abre su propio registro.</Text>

      <View style={styles.list}>
        {SIGNUP_ROLE_SCREEN_OPTIONS.map((option) => (
          <Pressable
            key={option.id}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            onPress={() => {
              const target = signupRoleRegisterTarget(option.id, redirectTo);
              navigation.navigate(target.screen, target.params);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${option.title}. ${option.description}`}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={option.icon} size={30} color={colors.primary} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionSub}>{option.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
          </Pressable>
        ))}
      </View>
    </AuthPasswordFormShell>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  list: {
    gap: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 92,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDECEA',
  },
  optionText: { flex: 1, gap: 4 },
  optionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  optionSub: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  pressed: { opacity: 0.9 },
});
