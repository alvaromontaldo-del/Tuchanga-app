import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  visible: boolean;
  iBlockedThem: boolean;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
  onUnblock: () => void;
};

export function ChatSafetyOptionsModal({
  visible,
  iBlockedThem,
  onClose,
  onReport,
  onBlock,
  onUnblock,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Opciones</Text>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => {
              onClose();
              onReport();
            }}
          >
            <Ionicons name="flag-outline" size={22} color={colors.text} />
            <Text style={styles.rowText}>Reportar</Text>
          </Pressable>
          {iBlockedThem ? (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => {
                onClose();
                onUnblock();
              }}
            >
              <Ionicons name="person-add-outline" size={22} color={colors.primary} />
              <Text style={[styles.rowText, styles.rowTextPrimary]}>Desbloquear</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => {
                onClose();
                onBlock();
              }}
            >
              <Ionicons name="ban-outline" size={22} color={colors.error} />
              <Text style={[styles.rowText, styles.rowTextDanger]}>Bloquear</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
            onPress={onClose}
          >
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  rowTextDanger: { color: colors.error, fontWeight: '700' },
  rowTextPrimary: { color: colors.primary, fontWeight: '700' },
  cancelBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  pressed: { opacity: 0.88 },
});
