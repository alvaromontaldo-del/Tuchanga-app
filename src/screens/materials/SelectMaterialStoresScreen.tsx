import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton } from '../../components/common/AppButton';
import { colors, spacing } from '../../constants/theme';
import type {
  AgendaStackParamList,
  FeedStackParamList,
  MessagesStackParamList,
  SearchStackParamList,
} from '../../navigation/mainTypes';

type MaterialNavParamList =
  | MessagesStackParamList
  | FeedStackParamList
  | AgendaStackParamList
  | SearchStackParamList;

type Props = {
  navigation: NativeStackNavigationProp<MaterialNavParamList, 'SelectMaterialStores'>;
  route: RouteProp<MaterialNavParamList, 'SelectMaterialStores'>;
};

/**
 * Legacy: el envío ahora se hace desde CreateMaterialRequest (todos los comercios del rubro).
 * Se mantiene en el stack por compatibilidad de rutas.
 */
export function SelectMaterialStoresScreen({ navigation }: Props) {
  useEffect(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.centered}>
      <Text style={styles.warn}>
        La selección manual por distancia ya no se usa. Volvé y enviá la lista desde el paso
        anterior (todos los comercios del rubro).
      </Text>
      <AppButton title="Volver" onPress={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  warn: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
});
