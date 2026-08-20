import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  CHAT_REPORT_REASONS,
  type ChatReportReasonCode,
} from '../../services/chatSecuritySupabase';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  visible: boolean;
  displayName: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reasonCode: ChatReportReasonCode) => void;
};

export function ChatReportUserModal({
  visible,
  displayName,
  submitting,
  onClose,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<ChatReportReasonCode | null>(null);

  useEffect(() => {
    if (!visible) setSelected(null);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Reportar usuario</Text>
          <Text style={styles.subtitle}>
            Contanos qué pasó con {displayName}. Revisaremos el caso.
          </Text>
          {CHAT_REPORT_REASONS.map((item) => {
            const active = selected === item.code;
            return (
              <Pressable
                key={item.code}
                style={({ pressed }) => [
                  styles.reasonRow,
                  active ? styles.reasonRowActive : null,
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelected(item.code)}
                disabled={submitting}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={active ? colors.primary : colors.textSecondary}
                />
                <Text style={[styles.reasonText, active ? styles.reasonTextActive : null]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              onPress={onClose}
              disabled={submitting}
            >
              <Text style={styles.btnGhostText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                (!selected || submitting) && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
              onPress={() => selected && onConfirm(selected)}
              disabled={!selected || submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnPrimaryText}>Enviar reporte</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  subtitle: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
    marginBottom: spacing.xs,
  },
  reasonRowActive: {
    backgroundColor: '#F5F5F5',
  },
  reasonText: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' },
  reasonTextActive: { fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.input,
    minWidth: 110,
    alignItems: 'center',
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { fontWeight: '700', color: colors.text },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { fontWeight: '800', color: '#fff' },
  btnDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.9 },
});
