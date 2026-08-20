import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNativeStackScreenOptions } from './useNativeStackScreenOptions';
import { AgendaScreen } from '../screens/agenda/AgendaScreen';
import { DetalleServicioScreen } from '../screens/servicios/DetalleServicioScreen';
import { ChatConversationScreen } from '../screens/chat/ChatConversationScreen';
import { CreateMaterialRequestScreen } from '../screens/materials/CreateMaterialRequestScreen';
import { SelectMaterialStoresScreen } from '../screens/materials/SelectMaterialStoresScreen';
import type { AgendaStackParamList } from './mainTypes';

const Stack = createNativeStackNavigator<AgendaStackParamList>();

export function AgendaStack() {
  const screenOptions = useNativeStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Agenda"
        component={AgendaScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DetalleServicio"
        component={DetalleServicioScreen}
        options={{ title: 'Detalle del servicio' }}
      />
      <Stack.Screen
        name="ChatConversation"
        component={ChatConversationScreen}
        options={{ headerShown: false, title: 'Chat' }}
      />
      <Stack.Screen
        name="CreateMaterialRequest"
        component={CreateMaterialRequestScreen}
        options={{ title: 'Pedido de materiales' }}
      />
      <Stack.Screen
        name="SelectMaterialStores"
        component={SelectMaterialStoresScreen}
        options={{ title: 'Seleccionar comercios' }}
      />
    </Stack.Navigator>
  );
}
