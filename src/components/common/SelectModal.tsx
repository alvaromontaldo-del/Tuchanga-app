import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  visible: boolean;
  title: string;
  options: readonly string[];
  initialSelected: string | null;
  onClose: () => void;
  onApply: (selected: string | null) => void;
};

export function SelectModal({
  visible,
  title,
  options,
  initialSelected,
  onClose,
  onApply,
}: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<string | null>(initialSelected);

  useEffect(() => {
    if (visible) setDraft(initialSelected);
  }, [visible, initialSelected]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.sheetHeader}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable
            onPress={() => {
              onApply(draft);
              onClose();
            }}
            hitSlop={12}
          >
            <Text style={styles.applyText}>Listo</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {options.map((opt) => {
            const on = draft === opt;
            return (
              <Pressable
                key={opt}
                onPress={() => setDraft(opt)}
                style={({ pressed }) => [
                  styles.optionRow,
                  pressed && styles.optionPressed,
                ]}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={on ? colors.primary : colors.textSecondary}
                />
                <Text style={styles.optionLabel} numberOfLines={2}>
                  {opt}
                </Text>
              </Pressable>
            );
          })}

          <View style={styles.clearRow}>
            <Pressable
              onPress={() => setDraft(null)}
              style={({ pressed }) => [
                styles.clearBtn,
                pressed && styles.clearBtnPressed,
              ]}
            >
              <Text style={styles.clearText}>Limpiar selección</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.surface },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  cancelText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
  applyText: { fontSize: 16, color: colors.primary, fontWeight: '800' },
  scroll: { flex: 1 },
  scrollContent: { paddingVertical: spacing.sm },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  optionPressed: { backgroundColor: colors.background },
  optionLabel: {
    marginLeft: spacing.md,
    fontSize: 17,
    color: colors.text,
    flex: 1,
  },
  clearRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  clearBtn: {
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  clearBtnPressed: { opacity: 0.92 },
  clearText: { color: colors.textSecondary, fontSize: 15, fontWeight: '700' },
});

