import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TERMS_UPDATED_LABEL, TERMS_VERSION } from '../../constants/terms';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  visible: boolean;
  /** `read`: solo consulta. `accept`: hay que tocar Acepto para seguir. */
  mode: 'read' | 'accept';
  onClose?: () => void;
  onAccept?: () => void;
  accepting?: boolean;
  acceptError?: string | null;
};

function Section({ title, children }: { title: string; children: string }) {
  return (
    <>
      <Text style={styles.h}>{title}</Text>
      <Text style={styles.p}>{children}</Text>
    </>
  );
}

function TermsBody() {
  return (
    <>
      <Text style={styles.p}>
        Estos Términos y Condiciones (los “Términos”) regulan el acceso y el uso de la aplicación
        YaChanga (la “Plataforma”), operada por [RAZÓN SOCIAL], CUIT [CUIT], con domicilio en
        [DOMICILIO LEGAL]. Al crear una cuenta, o al aceptar una versión nueva, declarás que leíste
        estos Términos y que los aceptás. Esa aceptación queda registrada con la fecha y la versión
        vigente.
      </Text>

      <Section title="1. Quiénes pueden usar YaChanga">
        La Plataforma es para personas mayores de 18 años. Hay tres formas de uso, y una misma
        cuenta puede reunir más de una cuando la app lo permite. Cliente: pedís trabajos y, si hace
        falta, materiales. Profesional o trabajador: ofrecés oficios, cotizás y realizás el trabajo.
        Para aparecer en las búsquedas cargás oficios, una descripción y una zona de cobertura.
        Comercio: un local que cotiza y vende materiales. El alta del local puede quedar pendiente
        de aprobación de un administrador antes de operar.
      </Section>

      <Section title="2. Qué hace YaChanga">
        YaChanga es un intermediario tecnológico. Pone en contacto a clientes, profesionales y
        comercios, muestra cotizaciones y cobra el costo de servicio de la Plataforma. No es el
        empleador de los profesionales, no los dirige como personal propio y no es parte del acuerdo
        de trabajo entre cliente y profesional ni de la compraventa entre cliente y comercio. Cada
        profesional y cada comercio actúa por su cuenta.
      </Section>

      <Section title="3. La cuenta">
        Para registrarte se piden, según el caso, nombre, apellido, documento, fecha de nacimiento,
        correo, teléfono, contraseña, foto y una dirección. Si ofrecés servicios, también una
        descripción, los oficios y un radio de cobertura. Si das de alta un comercio, los datos del
        local (nombre, foto o logo, dirección, rubros y horario) son distintos de los del titular.
        Sos responsable de que los datos sean verdaderos y de cuidar tu contraseña. Podés dar de
        baja el perfil profesional y seguir usando la cuenta como cliente: en ese caso dejás de
        aparecer en las búsquedas como trabajador y tus publicaciones dejan de verse en el inicio.
      </Section>

      <Section title="4. Cotizaciones y precio del trabajo">
        El profesional cotiza el trabajo desde el chat. El precio final que ve el cliente incluye el
        costo de servicio de YaChanga. Ese costo de servicio se paga con Mercado Pago. El importe
        del profesional se arregla entre cliente y profesional; la app permite avisar ese pago y
        confirmarlo. Si la cotización cambia, el costo de servicio que muestra la app puede
        actualizarse, y la diferencia de ese costo también se paga por Mercado Pago. YaChanga no
        guarda los datos de tu tarjeta: el cobro lo procesa Mercado Pago.
      </Section>

      <Section title="5. PIN para iniciar el trabajo">
        Cuando el costo de servicio queda acreditado, el cliente recibe un PIN. El profesional lo
        ingresa para dar por iniciado el trabajo. No lo compartas con terceros. Varios intentos
        incorrectos pueden bloquear la verificación por un tiempo.
      </Section>

      <Section title="6. Cierre del trabajo y del chat">
        El profesional marca el trabajo como terminado y el cliente da su conformidad. El chat entre
        esas dos personas se quita de la app cuando el trabajo está finalizado, las dos partes lo
        confirmaron y el pago figura completo. También se quita cuando un reclamo de garantía se
        cierra con la conformidad del cliente. Si entre las mismas personas queda otro trabajo en
        curso o un reclamo abierto, ese chat sigue disponible. Al cerrarse el chat, su contenido y
        las imágenes asociadas pueden eliminarse.
      </Section>

      <Section title="7. Garantía y reclamos">
        Al cotizar, el profesional puede incluir una garantía de 1 a 60 días, o no incluir ninguna.
        El plazo empieza cuando el trabajo queda finalizado por primera vez. Durante ese plazo el
        cliente puede iniciar un reclamo, que se coordina por un chat de la Plataforma. El
        profesional puede marcar el arreglo como hecho y el cliente lo confirma. Si el cliente no
        responde dentro de las 72 horas desde que el profesional marcó el arreglo, el reclamo puede
        cerrarse de forma automática.
      </Section>

      <Section title="8. Calificaciones">
        Cuando el trabajo está finalizado, el cliente puede calificar y dejar un comentario sobre el
        profesional. Esas reseñas pueden mostrarse en el perfil del profesional, junto con el
        promedio.
      </Section>

      <Section title="9. Chat y moderación">
        El chat es el canal entre cliente y profesional para coordinar el trabajo. No está permitido
        enviar teléfonos ni correos electrónicos en los mensajes: la Plataforma puede rechazarlos.
        También puede limitar la extensión, la frecuencia y las imágenes. Podés bloquear a otra
        persona; mientras el bloqueo esté activo no se envían mensajes entre ustedes. Los avisos de
        sistema (por ejemplo un pago, un PIN o un reclamo) los genera la Plataforma.
      </Section>

      <Section title="10. Materiales y comercios">
        Un cliente o un profesional puede pedir materiales a comercios. El comercio ve el pedido
        para cotizarlo. Si se indicó una dirección de entrega, el comercio la usa para el flete. El
        teléfono, el correo y el documento del cliente no se comparten con el comercio por la app.
        El nombre, el teléfono y la dirección del comercio se muestran al cliente recién cuando está
        pago el costo de servicio YaChanga de ese pedido, que se abona con Mercado Pago. El precio
        de los materiales se paga al comercio, aparte de ese costo de servicio. El comercio puede
        cotizar retiro en el local, envío sin cargo o envío con costo. Si hay un costo de flete,
        quien pide elige si ese envío entra en la orden.
      </Section>

      <Section title="11. PIN de retiro de materiales">
        Al pagar el costo de servicio de materiales, quien pagó ve un código de orden y un PIN de
        retiro. Si el profesional que cargó el pedido es quien pagó, o la app lo identifica como
        cliente de esa orden, también puede verlos. El comercio nunca ve el PIN: lo ingresa para
        cerrar la entrega. No lo publiques ni se lo pases a terceros.
      </Section>

      <Section title="12. Ubicación">
        La dirección de tu perfil se usa para operar la cuenta y, si sos profesional, para la zona
        de cobertura. La dirección del trabajo se comparte con el profesional cuando el costo de
        servicio está pago. La dirección del comercio y, si corresponde, la de entrega de materiales
        se usan para cotizar, retirar o enviar.
      </Section>

      <Section title="13. Notificaciones">
        Si autorizás las notificaciones del dispositivo, guardamos un identificador para avisarte de
        la actividad de tu cuenta, por ejemplo trabajos, mensajes o pedidos. Podés desactivarlas
        desde la configuración del teléfono.
      </Section>

      <Section title="14. Datos personales">
        Tratamos datos personales según la Ley 25.326 de Protección de Datos Personales de la
        República Argentina. Pueden incluir identidad y contacto, documento, fecha de nacimiento,
        foto, dirección y ubicación, oficios, mensajes, reseñas, datos del comercio y el
        identificador de notificaciones. Los usamos para crear y administrar la cuenta, conectar a
        las partes, cobrar el costo de servicio, prevenir abusos y cumplir la ley. Tenés derecho de
        acceso, de rectificación y de supresión de tus datos. Para ejercerlos escribinos a [EMAIL DE
        CONTACTO]. La autoridad de aplicación es la Agencia de Acceso a la Información Pública.
      </Section>

      <Section title="15. Conducta prohibida">
        No uses la Plataforma para fraudes, suplantación de identidad, acoso, discriminación,
        contenido ilícito ni para eludir los pagos o los controles de la app. No cargues datos
        falsos ni interfieras con el funcionamiento del servicio.
      </Section>

      <Section title="16. Suspensión de la cuenta">
        YaChanga puede suspender o dar de baja una cuenta ante un incumplimiento de estos Términos,
        un uso abusivo o un requerimiento legal. Una cuenta dada de baja no puede ingresar hasta que
        se reactive. Para pedir la reactivación escribinos a [EMAIL DE CONTACTO].
      </Section>

      <Section title="17. Límite de responsabilidad">
        En la medida en que la ley lo permita, YaChanga no responde por la ejecución del trabajo, la
        calidad o la entrega de los materiales, los daños personales o materiales, los robos, las
        demoras, los desacuerdos entre usuarios ni por la veracidad de lo que cada persona declara
        en su perfil. Las recomendaciones de la app no reemplazan tu propio criterio.
      </Section>

      <Section title="18. Cambios de estos Términos">
        Podemos actualizar estos Términos. La versión y la fecha de actualización figuran al
        comienzo. Si la versión cambia, la app te pide aceptarla para seguir usándola. Si no
        aceptás, no vas a poder continuar con esa cuenta.
      </Section>

      <Section title="19. Ley y jurisdicción">
        Estos Términos se rigen por las leyes de la República Argentina. Para cualquier controversia
        son competentes los tribunales ordinarios de [JURISDICCIÓN], sin perjuicio de las normas de
        defensa del consumidor que resulten irrenunciables.
      </Section>

      <Section title="20. Contacto">
        [RAZÓN SOCIAL] — [EMAIL DE CONTACTO]
      </Section>
    </>
  );
}

export function TermsAndConditionsModal({
  visible,
  mode,
  onClose,
  onAccept,
  accepting = false,
  acceptError = null,
}: Props) {
  const readOnly = mode === 'read';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (readOnly) onClose?.();
      }}
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheetSafe} edges={['bottom', 'left', 'right']}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.title}>Términos y Condiciones</Text>
                <Text style={styles.subtitle}>
                  Última actualización: {TERMS_UPDATED_LABEL} · Versión {TERMS_VERSION}
                </Text>
              </View>
              {readOnly ? (
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar términos y condiciones"
                  hitSlop={10}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                >
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
            >
              <TermsBody />
            </ScrollView>

            <View style={styles.footer}>
              {readOnly ? (
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
                >
                  <Text style={styles.secondaryBtnText}>Cerrar</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    disabled={accepting}
                    onPress={onAccept}
                    accessibilityRole="button"
                    accessibilityLabel="Acepto los términos y condiciones"
                    accessibilityState={{ disabled: accepting }}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      accepting && styles.primaryBtnDisabled,
                      pressed && !accepting && styles.btnPressed,
                    ]}
                  >
                    {accepting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Acepto</Text>
                    )}
                  </Pressable>
                  {acceptError ? <Text style={styles.error}>{acceptError}</Text> : null}
                  <Text style={styles.disclaimer}>
                    Tenés que aceptar para seguir usando YaChanga. Al tocar Acepto confirmás esta
                    versión ({TERMS_VERSION}).
                  </Text>
                </>
              )}
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
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  secondaryBtn: {
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
    height: 48,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
  btnPressed: { opacity: 0.9 },
  error: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: '700',
    color: colors.error,
    lineHeight: 16,
  },
  disclaimer: {
    marginTop: spacing.md,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
