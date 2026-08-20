import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { useAppToast } from '../../components/toast/toast';
import { colors, radii, spacing } from '../../constants/theme';
import { completarOrdenMaterialConPin } from '../../services/clientQuotesSupabase';
import type { CommerceStackParamList } from '../../navigation/mainTypes';
import { normalizeOrderCodeInput } from '../../utils/orderCode';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<CommerceStackParamList, 'StoreCloseOrder'>;

/**
 * Comercio cierra la compra con código numérico + PIN del cliente.
 */
export function StoreCloseOrderScreen({ navigation, route }: Props) {
  const toast = useAppToast();
  const [code, setCode] = useState(normalizeOrderCodeInput(route.params?.orderCode ?? ''));
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!code.trim() || !pin.trim()) {
      toast.warning('Ingresá el código de orden y el PIN.', 'Faltan datos');
      return;
    }
    setLoading(true);
    try {
      const result = await completarOrdenMaterialConPin(code.trim(), pin.trim());
      toast.success(`Orden ${result.orderCode} completada.`, 'Cerrada');
      navigation.goBack();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo cerrar la orden.', 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppKeyboardAvoidingView style={styles.flex}>
      <View style={styles.card}>
        <Text style={styles.title}>Cerrar compra</Text>
        <Text style={styles.lead}>
          Pedile al cliente el código numérico de la orden y el PIN que recibió al pagar el costo de servicio.
        </Text>

        <Text style={styles.label}>Código de orden</Text>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(normalizeOrderCodeInput(t))}
          placeholder="4192"
          placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad"
          style={styles.input}
          maxLength={6}
        />

        <Text style={styles.label}>PIN</Text>
        <TextInput
          value={pin}
          onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 4))}
          placeholder="PIN"
          placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad"
          secureTextEntry
          style={styles.input}
          maxLength={4}
        />

        <AppButton title="Confirmar entrega / cierre" onPress={() => void onSubmit()} loading={loading} />
      </View>
    </AppKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: 20, fontWeight: '900', color: colors.text },
  lead: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 6 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
});
