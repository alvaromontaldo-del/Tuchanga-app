import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onAccept: () => void;
};

function formatTodayEs(): string {
  const d = new Date();
  return d.toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function TermsAndConditionsModal({ visible, onClose, onAccept }: Props) {
  const [checked, setChecked] = useState(false);

  const today = useMemo(() => formatTodayEs(), []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheetSafe} edges={['bottom', 'left', 'right']}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.title}>Términos y Condiciones</Text>
                <Text style={styles.subtitle}>Última actualización: {today}</Text>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cerrar términos y condiciones"
                hitSlop={10}
                style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.p}>
                Este documento (los “Términos”) regula el acceso y uso de la aplicación YaChanga (la
                “Plataforma”). Al registrarte, declarás que leíste y comprendiste estos Términos y
                aceptás quedar vinculado/a por ellos.
              </Text>

              <Text style={styles.h}>1. Rol de la Plataforma (intermediario tecnológico)</Text>
              <Text style={styles.p}>
                La Plataforma actúa exclusivamente como un intermediario tecnológico que facilita el
                contacto entre personas usuarias que solicitan servicios (“Clientes”) y personas usuarias
                que ofrecen servicios (“Trabajadores”). La Plataforma no presta, no supervisa ni garantiza
                la ejecución de los servicios contratados entre Usuarios.
              </Text>

              <Text style={styles.h}>2. Relación entre Usuarios</Text>
              <Text style={styles.p}>
                Cualquier acuerdo, negociación, precio, alcance, condiciones, plazos y forma de pago del
                servicio es celebrado directamente entre Cliente y Trabajador. La Plataforma no es parte
                del contrato de prestación de servicios que pudiera existir entre Usuarios.
              </Text>

              <Text style={styles.h}>3. Exención de responsabilidad (limitación)</Text>
              <Text style={styles.p}>
                En la medida máxima permitida por la normativa aplicable, la Plataforma no será
                responsable, directa ni indirectamente, por:
              </Text>
              <View style={styles.bullets}>
                <Text style={styles.bullet}>
                  • Daños físicos, lesiones, accidentes o cualquier perjuicio personal ocurrido durante o
                  con motivo de la prestación del servicio.
                </Text>
                <Text style={styles.bullet}>
                  • Daños materiales a bienes, inmuebles o herramientas, incluyendo desperfectos,
                  deterioros o pérdidas.
                </Text>
                <Text style={styles.bullet}>
                  • Robos, hurtos, pérdidas de propiedad, extravíos o apropiación indebida de bienes
                  durante o con motivo del servicio.
                </Text>
                <Text style={styles.bullet}>
                  • Incidentes derivados de la prestación del servicio, incluyendo incumplimientos,
                  demoras, resultados insatisfactorios o conflictos entre Usuarios.
                </Text>
                <Text style={styles.bullet}>
                  • La veracidad absoluta, exactitud, actualidad o autenticidad de perfiles, identidad,
                  credenciales, matrículas, antecedentes, habilitaciones, experiencia o referencias
                  declaradas por los Usuarios.
                </Text>
              </View>

              <Text style={styles.h}>4. Recomendaciones de seguridad</Text>
              <Text style={styles.p}>
                Recomendamos verificar referencias, acordar condiciones por escrito dentro del chat de la
                Plataforma cuando sea posible, y tomar precauciones razonables antes, durante y después
                de la prestación del servicio (por ejemplo, requerir presupuestos, comprobantes y
                documentación pertinente).
              </Text>

              <Text style={styles.h}>5. Contenido, conducta y uso</Text>
              <Text style={styles.p}>
                El Usuario se obliga a utilizar la Plataforma de manera lícita, sin publicar contenido
                engañoso, discriminatorio, violento o que infrinja derechos de terceros. La Plataforma
                podrá suspender cuentas ante sospecha razonable de fraude o incumplimiento de estos
                Términos.
              </Text>

              <Text style={styles.h}>6. Tratamiento de datos (resumen)</Text>
              <Text style={styles.p}>
                La Plataforma podrá tratar datos necesarios para operar el servicio (por ejemplo, perfil,
                ubicación base y mensajes). Placeholder: aquí se integrará una Política de Privacidad
                completa (finalidad, base legal, plazos, derechos ARCO, etc.).
              </Text>

              <Text style={styles.h}>7. Modificaciones</Text>
              <Text style={styles.p}>
                La Plataforma puede actualizar estos Términos. Te notificaremos cambios materiales por
                medios razonables. El uso continuado tras la vigencia de cambios implica aceptación.
              </Text>

              <Text style={styles.h}>8. Jurisdicción y ley aplicable</Text>
              <Text style={styles.p}>
                Placeholder: indicar ley aplicable, jurisdicción competente y domicilio legal de la
                Plataforma.
              </Text>
            </ScrollView>

            <View style={styles.footer}>
              <Pressable
                onPress={() => setChecked((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel="He leído y acepto los términos"
                hitSlop={6}
                style={({ pressed }) => [styles.checkRow, pressed && styles.checkRowPressed]}
              >
                <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                  {checked ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                </View>
                <Text style={styles.checkText}>He leído y acepto los términos</Text>
              </Pressable>

              <View style={styles.actions}>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
                >
                  <Text style={styles.secondaryBtnText}>Volver</Text>
                </Pressable>

                <Pressable
                  disabled={!checked}
                  onPress={() => {
                    onAccept();
                    setChecked(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !checked }}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    !checked && styles.primaryBtnDisabled,
                    pressed && checked && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.primaryBtnText}>Continuar</Text>
                </Pressable>
              </View>

              <Text style={styles.disclaimer}>
                Al continuar, confirmás que aceptás estos Términos y que comprendés que YaChanga es un
                intermediario tecnológico.
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetSafe: { width: '100%' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  headerLeft: { flex: 1 },
  title: { fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: -0.2 },
  subtitle: { marginTop: 4, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { opacity: 0.8 },
  body: { paddingHorizontal: spacing.lg },
  bodyContent: { paddingBottom: spacing.md },
  h: { marginTop: spacing.md, fontSize: 13, fontWeight: '900', color: colors.text, lineHeight: 18 },
  p: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: Platform.OS === 'ios' ? '600' : '500',
    color: colors.textSecondary,
    lineHeight: 19,
  },
  bullets: { marginTop: spacing.sm, gap: 8 },
  bullet: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, fontWeight: '600' },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkRowPressed: { opacity: 0.9 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '900', color: colors.text },
  primaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
  btnPressed: { opacity: 0.9 },
  disclaimer: {
    marginTop: spacing.md,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
