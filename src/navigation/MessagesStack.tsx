import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNativeStackScreenOptions } from './useNativeStackScreenOptions';
import { ConversationsListScreen } from '../screens/chat/ConversationsListScreen';
import { ChatConversationScreen } from '../screens/chat/ChatConversationScreen';
import { WorkerProfileScreen } from '../screens/home/WorkerProfileScreen';
import { WorkerPostsScreen } from '../screens/home/WorkerPostsScreen';
import { WorkerReviewsScreen } from '../screens/home/WorkerReviewsScreen';
import { DetalleServicioScreen } from '../screens/servicios/DetalleServicioScreen';
import { CreateMaterialRequestScreen } from '../screens/materials/CreateMaterialRequestScreen';
import { SelectMaterialStoresScreen } from '../screens/materials/SelectMaterialStoresScreen';
import { ClientCompareQuotesScreen } from '../screens/client/ClientCompareQuotesScreen';
import { MaterialOrderDetailScreen } from '../screens/client/MaterialOrderDetailScreen';
import { MaterialOrderSummaryScreen } from '../screens/client/MaterialOrderSummaryScreen';
import type { MessagesStackParamList } from './mainTypes';

const Stack = createNativeStackNavigator<MessagesStackParamList>();

export function MessagesStack() {
  const screenOptions = useNativeStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="ConversationsList"
        component={ConversationsListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ChatConversation"
        component={ChatConversationScreen}
        options={{ headerShown: false, title: 'Chat' }}
      />
      <Stack.Screen
        name="WorkerProfile"
        component={WorkerProfileScreen}
        options={{ title: 'Perfil' }}
      />
      <Stack.Screen
        name="WorkerPosts"
        component={WorkerPostsScreen}
        options={{ title: 'Publicaciones' }}
      />
      <Stack.Screen
        name="WorkerReviews"
        component={WorkerReviewsScreen}
        options={{ title: 'Reseñas' }}
      />
      <Stack.Screen
        name="DetalleServicio"
        component={DetalleServicioScreen}
        options={{ title: 'Detalle del servicio' }}
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
      <Stack.Screen
        name="ClientCompareQuotes"
        component={ClientCompareQuotesScreen}
        options={{ title: 'Cotizaciones de materiales' }}
      />
      <Stack.Screen
        name="MaterialOrderDetail"
        component={MaterialOrderDetailScreen}
        options={{ title: 'Orden / costo de servicio' }}
      />
      <Stack.Screen
        name="MaterialOrderSummary"
        component={MaterialOrderSummaryScreen}
        options={{ title: 'Resumen de Pedido' }}
      />
    </Stack.Navigator>
  );
}
