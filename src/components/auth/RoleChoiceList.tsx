import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SIGNUP_ROLE_OPTIONS, type SignupRoleId } from '../../constants/sessionRoles';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  onPick: (role: SignupRoleId) => void;
};

/** Cliente, Profesional y Comercio, cada uno con una línea de descripción. */
export function RoleChoiceList({ onPick }: Props) {
  return (
    <View style={styles.list}>
      {SIGNUP_ROLE_OPTIONS.map((option) => (
        <Pressable
          key={option.id}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          onPress={() => onPick(option.id)}
          accessibilityRole="button"
          accessibilityLabel={`${option.title}. ${option.description}`}
        >
          <Ionicons name={option.icon} size={26} color={colors.primary} />
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>{option.title}</Text>
            <Text style={styles.optionSub}>{option.description}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  optionSub: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  pressed: { opacity: 0.9 },
});
