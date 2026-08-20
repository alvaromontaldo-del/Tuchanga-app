import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTextInput } from '../common/AppTextInput';
import { colors, radii, spacing } from '../../constants/theme';
import type { StoreHoursSlot } from '../../utils/storeOpeningHours';

type Props = {
  slots: StoreHoursSlot[];
  onChange: (slots: StoreHoursSlot[]) => void;
};

function patchSlot(slots: StoreHoursSlot[], index: number, patch: Partial<StoreHoursSlot>): StoreHoursSlot[] {
  return slots.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

/**
 * Horarios de atención: corrido (1 tramo) o cortado (2 tramos).
 */
export function StoreOpeningHoursEditor({ slots, onChange }: Props) {
  const split = slots.length > 1;

  const setSplit = (enabled: boolean) => {
    if (enabled) {
      onChange([
        slots[0] ?? { open: '08:00', close: '12:00' },
        slots[1] ?? { open: '15:00', close: '18:00' },
      ]);
    } else {
      onChange([slots[0] ?? { open: '09:00', close: '18:00' }]);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Horarios de atención</Text>
      <Text style={styles.hint}>Ej.: 9 a 18, o 8 a 12 y de 15 a 18 (horario cortado).</Text>

      <View style={styles.modeRow}>
        <Pressable
          onPress={() => setSplit(false)}
          style={[styles.modeBtn, !split && styles.modeBtnOn]}
          accessibilityRole="button"
        >
          <Text style={[styles.modeText, !split && styles.modeTextOn]}>Corrido</Text>
        </Pressable>
        <Pressable
          onPress={() => setSplit(true)}
          style={[styles.modeBtn, split && styles.modeBtnOn]}
          accessibilityRole="button"
        >
          <Text style={[styles.modeText, split && styles.modeTextOn]}>Horario cortado</Text>
        </Pressable>
      </View>

      <View style={styles.slotCard}>
        {split ? <Text style={styles.slotLabel}>Mañana</Text> : null}
        <View style={styles.timeRow}>
          <AppTextInput
            label="Desde"
            value={slots[0]?.open ?? ''}
            onChangeText={(t) => onChange(patchSlot(slots, 0, { open: t }))}
            placeholder="09:00"
            maxLength={5}
            keyboardType="numbers-and-punctuation"
            containerStyle={styles.timeInput}
          />
          <AppTextInput
            label="Hasta"
            value={slots[0]?.close ?? ''}
            onChangeText={(t) => onChange(patchSlot(slots, 0, { close: t }))}
            placeholder="18:00"
            maxLength={5}
            keyboardType="numbers-and-punctuation"
            containerStyle={styles.timeInput}
          />
        </View>
      </View>

      {split ? (
        <View style={styles.slotCard}>
          <Text style={styles.slotLabel}>Tarde</Text>
          <View style={styles.timeRow}>
            <AppTextInput
              label="Desde"
              value={slots[1]?.open ?? ''}
              onChangeText={(t) =>
                onChange(
                  slots.length > 1
                    ? patchSlot(slots, 1, { open: t })
                    : [...slots, { open: t, close: '18:00' }],
                )
              }
              placeholder="15:00"
              maxLength={5}
              keyboardType="numbers-and-punctuation"
              containerStyle={styles.timeInput}
            />
            <AppTextInput
              label="Hasta"
              value={slots[1]?.close ?? ''}
              onChangeText={(t) =>
                onChange(
                  slots.length > 1
                    ? patchSlot(slots, 1, { close: t })
                    : [...slots, { open: '15:00', close: t }],
                )
              }
              placeholder="18:00"
              maxLength={5}
              keyboardType="numbers-and-punctuation"
              containerStyle={styles.timeInput}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.previewRow}>
        <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.preview}>
          {slots.length > 0
            ? `De ${slots.map((s) => `${s.open || '?'} a ${s.close || '?'}`).join(' y de ')}`
            : 'Sin horarios cargados'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  modeBtnOn: {
    borderColor: colors.primary,
    backgroundColor: '#FFF8F8',
  },
  modeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeTextOn: {
    color: colors.primary,
  },
  slotCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  slotLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timeInput: {
    flex: 1,
    marginBottom: 0,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  preview: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },
});
