import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { colors } from '../constants/theme';
import { useCommerceShell } from '../context/CommerceShellContext';
import { RegisterStoreScreen } from '../screens/store/RegisterStoreScreen';
import { EditStoreScreen } from '../screens/store/EditStoreScreen';
import { StoreMaterialRequestsScreen } from '../screens/store/StoreMaterialRequestsScreen';
import { StoreQuoteRequestScreen } from '../screens/store/StoreQuoteRequestScreen';
import { StoreCloseOrderScreen } from '../screens/store/StoreCloseOrderScreen';
import { CommerceAccountScreen } from '../screens/store/CommerceAccountScreen';
import type { CommerceStackParamList } from './mainTypes';
import {
  mergeNativeStackScreenOptions,
  useNativeStackScreenOptions,
} from './useNativeStackScreenOptions';

const Stack = createNativeStackNavigator<CommerceStackParamList>();

/**
 * App solo-comercio: pedidos de materiales + cuenta.
 * No mezcla tabs de cliente/profesional.
 */
export function CommerceStack() {
  const { stores, primaryStore } = useCommerceShell();
  const stackOptions = useNativeStackScreenOptions();
  const header = useMemo(
    () =>
      mergeNativeStackScreenOptions(stackOptions, {
        headerShown: true,
        headerStyle: { backgroundColor: colors.brandLogoMat },
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
      }),
    [stackOptions],
  );

  const needsRegister =
    stores.length === 0 || stores.every((s) => s.status === 'rejected');
  const initialRouteName: keyof CommerceStackParamList = needsRegister
    ? 'RegisterStore'
    : 'StoreMaterialRequests';

  return (
    <Stack.Navigator
      key={needsRegister ? 'commerce-register' : `commerce-${primaryStore?.id ?? 'home'}`}
      initialRouteName={initialRouteName}
      screenOptions={header}
    >
      <Stack.Screen
        name="RegisterStore"
        component={RegisterStoreScreen}
        options={{ title: 'Registrar comercio' }}
      />
      <Stack.Screen
        name="EditStore"
        component={EditStoreScreen}
        options={{ title: 'Editar comercio' }}
      />
      <Stack.Screen
        name="StoreMaterialRequests"
        component={StoreMaterialRequestsScreen}
        options={{ title: 'Pedidos de materiales' }}
      />
      <Stack.Screen
        name="StoreQuoteRequest"
        component={StoreQuoteRequestScreen}
        options={{ title: 'Cotizar pedido' }}
      />
      <Stack.Screen
        name="StoreCloseOrder"
        component={StoreCloseOrderScreen}
        options={{ title: 'Cerrar compra' }}
      />
      <Stack.Screen
        name="CommerceAccount"
        component={CommerceAccountScreen}
        options={{ title: 'Mi comercio' }}
      />
    </Stack.Navigator>
  );
}
