import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AppButton } from '../common/AppButton';
import { useAppToast } from '../toast/toast';
import {
  buildMotivoDisputa,
  CONFORMIDAD_NEGATIVA,
  PROBLEMA_MOTIVOS,
  textoVisibleSinSena,
  type ProblemaMotivo,
} from '../../constants/serviceCostCopy';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { clienteResponderConformidad } from '../../services/contratacionesSupabase';

type Props = {
  visible: boolean;
  contratacionId: string;
  onClose: () => void;
  onDone: () => void;
};

/**
 * El cliente indica que el trabajo no quedó conforme.
 * Llama a cliente_responder_conformidad con p_conforme = false.
 * Eso deja el trabajo en disputa y no abre el reclamo de garantía.
 */
export function ReportarProblemaModal({ visible, contratacionId, onClose, onDone }: Props) {
  const toast = useAppToast();
  const [motivo, setMotivo] = useState<ProblemaMotivo | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<typeof CONFORMIDAD_NEGATIVA | null>(null);

  function reset() {
    setMotivo(null);
    setDescripcion('');
    setBusy(false);
    setResultado(null);
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function submit() {
    if (!motivo) {
      toast.warning('Elegí un motivo.', 'Problema');
      return;
    }
    if (descripcion.trim().length < 8) {
      toast.warning('Contanos un poco más qué pasó.', 'Problema');
      return;
    }
    setBusy(true);
    try {
      await clienteResponderConformidad({
        contratacionId,
        conforme: false,
        motivoDisputa: buildMotivoDisputa(motivo, descripcion),
      });
      setResultado(CONFORMIDAD_NEGATIVA);
      onDone();
    } catch (e) {
      toast.error(
        textoVisibleSinSena(e instanceof Error ? e.message : 'No se pudo registrar el problema'),
        'Problema',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Volver" hitSlop={12}>
            <Text style={styles.back}>Volver</Text>
          </Pressable>
          <Text style={styles.title}>Tuve un problema</Text>
        </View>

        {resultado ? (
          <View style={styles.body}>
            <Text style={styles.section}>Estado</Text>
            <Text style={styles.estado}>{resultado.estado}</Text>
            <Text style={styles.section}>Próximo paso</Text>
            <Text style={styles.paso}>{resultado.paso}</Text>
            <AppButton
              title="Entendido"
              onPress={() => {
                reset();
                onClose();
              }}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.lead}>
              Contanos qué pasó. El trabajo pasa a disputa y el chat sigue disponible.
            </Text>
            <Text style={styles.section}>Motivo</Text>
            {PROBLEMA_MOTIVOS.map((item) => {
              const selected = motivo === item;
              return (
                <Pressable
                  key={item}
                  style={[styles.motivo, selected && styles.motivoOn]}
                  onPress={() => setMotivo(item)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.motivoText, selected && styles.motivoTextOn]}>{item}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.section}>Descripción</Text>
            <TextInput
              value={descripcion}
              onChangeText={setDescripcion}
              placeholder="Qué viste y qué esperabas"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              multiline
              maxLength={800}
              textAlignVertical="top"
              accessibilityLabel="Descripción del problema"
            />
            <AppButton title="Enviar problema" onPress={() => void submit()} loading={busy} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  back: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  title: { ...typography.title, fontSize: 22 },
  body: { padding: spacing.lg, gap: spacing.sm },
  lead: { fontSize: 15, lineHeight: 21, color: colors.textSecondary, marginBottom: spacing.sm },
  section: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  motivo: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  motivoOn: { borderColor: colors.primary, backgroundColor: '#FDECEA' },
  motivoText: { fontSize: 15, fontWeight: '700', color: colors.text },
  motivoTextOn: { color: colors.primary },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  estado: { fontSize: 20, fontWeight: '900', color: colors.text },
  paso: { fontSize: 15, lineHeight: 22, color: colors.text, marginBottom: spacing.lg },
});
