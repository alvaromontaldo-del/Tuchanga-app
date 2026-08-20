import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';
import type { DisponibilidadOpcion } from '../../types/contrataciones';

function formatOpcionLabel(o: DisponibilidadOpcion): string {
  const f = o.fecha_trabajo.split('-').reverse().join('/');
  const hi = String(o.hora_inicio).slice(0, 5);
  const hf = String(o.hora_fin).slice(0, 5);
  return `${f} · ${hi} – ${hf}`;
}

type Props = {
  opciones: DisponibilidadOpcion[];
  busy?: boolean;
  embedded?: boolean;
  /** `select` = cliente elige; `readonly` = trabajador ve lo enviado. */
  mode?: 'select' | 'readonly';
  onConfirm?: (opcionId: string) => void | Promise<void>;
  onReject?: () => void | Promise<void>;
  /** Solo en modo readonly: reabrir el formulario de agenda. */
  onEdit?: () => void;
};

export function AgendaOpcionesCliente({
  opciones,
  busy = false,
  embedded = false,
  mode = 'select',
  onConfirm,
  onReject,
  onEdit,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const readonly = mode === 'readonly';

  useEffect(() => {
    setSelectedId(opciones.length === 1 ? (opciones[0]?.id ?? null) : null);
  }, [opciones]);

  if (opciones.length === 0) return null;

  return (
    <View style={[styles.card, embedded && styles.cardEmbedded]}>
      <Text style={styles.title}>
        {readonly ? 'Disponibilidad enviada' : 'Elegí el horario que mejor te quede'}
      </Text>
      <Text style={styles.subtitle}>
        {readonly
          ? 'Estas son las opciones que le mandaste al cliente. Esperá su confirmación o editá para enviar otras.'
          : 'El profesional te envió estas alternativas. Seleccioná una y confirmá para coordinar la visita.'}
      </Text>

      <View style={styles.optionsList}>
        {opciones.map((op, index) => {
          if (readonly) {
            return (
              <View key={op.id} style={styles.optionRow}>
                <Ionicons name="calendar-outline" size={22} color={colors.primary} />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Opción {index + 1}</Text>
                  <Text style={styles.optionValue}>{formatOpcionLabel(op)}</Text>
                </View>
              </View>
            );
          }

          const selected = selectedId === op.id;
          return (
            <Pressable
              key={op.id}
              style={({ pressed }) => [
                styles.optionRow,
                selected && styles.optionRowSelected,
                pressed && !busy && styles.pressed,
              ]}
              disabled={busy}
              onPress={() => setSelectedId(op.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Opción ${index + 1}: ${formatOpcionLabel(op)}`}
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={selected ? colors.primary : colors.textSecondary}
              />
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Opción {index + 1}</Text>
                <Text style={styles.optionValue}>{formatOpcionLabel(op)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {readonly ? (
        <Pressable
          style={({ pressed }) => [styles.btnGhost, pressed && styles.pressed]}
          onPress={() => onEdit?.()}
          accessibilityRole="button"
          accessibilityLabel="Editar o reenviar disponibilidad"
        >
          <Text style={styles.btnGhostText}>Editar / reenviar</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            style={({ pressed }) => [
              styles.btnPrimary,
              (!selectedId || busy) && styles.btnDisabled,
              pressed && selectedId && !busy && styles.pressed,
            ]}
            disabled={!selectedId || busy}
            onPress={() => {
              if (!selectedId) return;
              void onConfirm?.(selectedId);
            }}
            accessibilityRole="button"
            accessibilityLabel="Confirmar horario seleccionado"
          >
            <Text style={styles.btnPrimaryText}>{busy ? 'Confirmando…' : 'Confirmar horario'}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.btnGhost,
              busy && styles.btnDisabled,
              pressed && !busy && styles.pressed,
            ]}
            disabled={busy}
            onPress={() => void onReject?.()}
            accessibilityRole="button"
            accessibilityLabel="Pedir otras fechas"
          >
            <Text style={styles.btnGhostText}>Prefiero otras fechas</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardEmbedded: { marginHorizontal: 0, marginTop: 0 },
  title: { fontSize: 15, fontWeight: '900', color: colors.text },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 18,
  },
  optionsList: { marginTop: spacing.md, gap: spacing.sm },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.background,
  },
  optionRowSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FEF2F2',
  },
  optionText: { flex: 1 },
  optionTitle: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },
  optionValue: { marginTop: 2, fontSize: 15, fontWeight: '800', color: colors.text },
  btnPrimary: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnGhost: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnGhostText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.55 },
  pressed: { opacity: 0.9 },
});
