import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppTextInput } from '../common/AppTextInput';
import { colors, radii, spacing } from '../../constants/theme';
import {
  copyTuesdayHoursToFriday,
  patchStoreDaySlot,
  setStoreDayClosed,
  setStoreDaySplit,
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
        Cada día tiene su horario, corrido o cortado. Si el local está cerrado, marcalo y no hace
        falta cargar Desde y Hasta.
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

          {row.closed ? null : (
            <>
              <View style={styles.modeRow}>
                <Pressable
                  onPress={() => onChange(setStoreDaySplit(days, row.day, false))}
                  style={[styles.modeBtn, row.slots.length < 2 && styles.modeBtnOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.label}: corrido`}
                  accessibilityState={{ selected: row.slots.length < 2 }}
                >
                  <Text style={[styles.modeText, row.slots.length < 2 && styles.modeTextOn]}>
                    Corrido
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onChange(setStoreDaySplit(days, row.day, true))}
                  style={[styles.modeBtn, row.slots.length > 1 && styles.modeBtnOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.label}: cortado`}
                  accessibilityState={{ selected: row.slots.length > 1 }}
                >
                  <Text style={[styles.modeText, row.slots.length > 1 && styles.modeTextOn]}>
                    Cortado
                  </Text>
                </Pressable>
              </View>
              {row.slots.map((slot, index) => {
                const slotLabel = row.slots.length > 1 ? (index === 0 ? 'Mañana' : 'Tarde') : null;
                return (
                  <View key={`${row.day}-${index}`}>
                    {slotLabel ? <Text style={styles.slotLabel}>{slotLabel}</Text> : null}
                    <View style={[styles.timeRow, STORE_HOURS_TIME_ROW]}>
                      <AppTextInput
                        label="Desde"
                        value={slot.open}
                        onChangeText={(text) =>
                          onChange(patchStoreDaySlot(days, row.day, index, { open: text }))
                        }
                        placeholder={index === 0 ? '09:00' : '15:00'}
                        maxLength={5}
                        keyboardType="numbers-and-punctuation"
                        containerStyle={styles.timeInput}
                        accessibilityLabel={
                          slotLabel
                            ? `${row.label} ${slotLabel.toLowerCase()} desde`
                            : `${row.label} desde`
                        }
                      />
                      <AppTextInput
                        label="Hasta"
                        value={slot.close}
                        onChangeText={(text) =>
                          onChange(patchStoreDaySlot(days, row.day, index, { close: text }))
                        }
                        placeholder={index === 0 ? '18:00' : '19:00'}
                        maxLength={5}
                        keyboardType="numbers-and-punctuation"
                        containerStyle={styles.timeInput}
                        accessibilityLabel={
                          slotLabel
                            ? `${row.label} ${slotLabel.toLowerCase()} hasta`
                            : `${row.label} hasta`
                        }
                      />
                    </View>
                  </View>
                );
              })}
            </>
          )}
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
    minWidth: 0,
    marginBottom: 0,
  },
});
