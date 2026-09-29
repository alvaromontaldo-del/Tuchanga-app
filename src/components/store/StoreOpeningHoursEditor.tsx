import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppTextInput } from '../common/AppTextInput';
import { colors, radii, spacing } from '../../constants/theme';
import {
  copyTuesdayHoursToFriday,
  patchStoreDaySlot,
  setStoreDayClosed,
  STORE_HOURS_TIME_ROW,
  storeOpeningHoursEditorRows,
  type StoreDaySchedule,
} from '../../utils/storeOpeningHours';

type Props = {
  days: StoreDaySchedule[];
  onChange: (days: StoreDaySchedule[]) => void;
};

/**
 * Horario semanal: lun a dom, cada día abierto o cerrado, Desde y Hasta en la misma fila.
 */
export function StoreOpeningHoursEditor({ days, onChange }: Props) {
  const rows = storeOpeningHoursEditorRows(days);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Horarios de atención</Text>
      <Text style={styles.hint}>
        Cada día tiene su horario. Si el local está cerrado, marcalo y no hace falta cargar Desde y
        Hasta.
      </Text>

      <Pressable
        onPress={() => onChange(copyTuesdayHoursToFriday(days))}
        style={styles.copyBtn}
        accessibilityRole="button"
        accessibilityLabel="Copiar horario de martes a viernes"
      >
        <Text style={styles.copyText}>Copiar horario de martes a viernes</Text>
      </Pressable>

      {rows.map((row) => (
        <View key={row.day} style={styles.dayCard}>
          <Text style={styles.dayLabel}>{row.label}</Text>
          <View style={styles.modeRow}>
            <Pressable
              onPress={() => onChange(setStoreDayClosed(days, row.day, false))}
              style={[styles.modeBtn, !row.closed && styles.modeBtnOn]}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}: abierto`}
              accessibilityState={{ selected: !row.closed }}
            >
              <Text style={[styles.modeText, !row.closed && styles.modeTextOn]}>Abierto</Text>
            </Pressable>
            <Pressable
              onPress={() => onChange(setStoreDayClosed(days, row.day, true))}
              style={[styles.modeBtn, row.closed && styles.modeBtnOn]}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}: cerrado`}
              accessibilityState={{ selected: row.closed }}
            >
              <Text style={[styles.modeText, row.closed && styles.modeTextOn]}>Cerrado</Text>
            </Pressable>
          </View>

          {row.closed
            ? null
            : row.slots.map((slot, index) => (
                <View
                  key={`${row.day}-${index}`}
                  style={[styles.timeRow, STORE_HOURS_TIME_ROW]}
                >
                  <AppTextInput
                    label="Desde"
                    value={slot.open}
                    onChangeText={(text) =>
                      onChange(patchStoreDaySlot(days, row.day, index, { open: text }))
                    }
                    placeholder="09:00"
                    maxLength={5}
                    keyboardType="numbers-and-punctuation"
                    containerStyle={styles.timeInput}
                    accessibilityLabel={`${row.label} desde`}
                  />
                  <AppTextInput
                    label="Hasta"
                    value={slot.close}
                    onChangeText={(text) =>
                      onChange(patchStoreDaySlot(days, row.day, index, { close: text }))
                    }
                    placeholder="18:00"
                    maxLength={5}
                    keyboardType="numbers-and-punctuation"
                    containerStyle={styles.timeInput}
                    accessibilityLabel={`${row.label} hasta`}
                  />
                </View>
              ))}
        </View>
      ))}
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
  copyBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#FFF8F8',
  },
  copyText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  dayCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
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
  timeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timeInput: {
    flex: 1,
    minWidth: 0,
    marginBottom: 0,
  },
});
