import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../../constants/theme';
import { registerAuthTarget } from '../../navigation/registerEntry';
import type { AuthStackScreenProps } from '../../navigation/types';

type Props = AuthStackScreenProps<'RegisterCommerce'>;

/**
 * Ruta vieja del alta de comercio. El formulario completo vive en Register.
 * Si algo todavía abre esta pantalla, no muestra el ingreso: sigue al alta.
 */
export function RegisterCommerceScreen({ navigation }: Props) {
  useEffect(() => {
    const target = registerAuthTarget('commerce');
    navigation.replace(target.screen, target.params);
  }, [navigation]);

  return (
    <View style={styles.flex}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
