import { StyleSheet, View } from 'react-native';
import { colors } from '../constants/theme';

/** Pantalla mínima del tab “Publicar” (la acción real abre Publicar desde Inicio). */
export function PublishTabPlaceholder() {
  return <View style={styles.root} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
