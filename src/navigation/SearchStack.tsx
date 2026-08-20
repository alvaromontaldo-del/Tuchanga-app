import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNativeStackScreenOptions } from './useNativeStackScreenOptions';
import { WorkerProfileScreen } from '../screens/home/WorkerProfileScreen';
import { WorkerPostsScreen } from '../screens/home/WorkerPostsScreen';
import { WorkerReviewsScreen } from '../screens/home/WorkerReviewsScreen';
import { ChatConversationScreen } from '../screens/chat/ChatConversationScreen';
import { CreateMaterialRequestScreen } from '../screens/materials/CreateMaterialRequestScreen';
import { SelectMaterialStoresScreen } from '../screens/materials/SelectMaterialStoresScreen';
import type { SearchStackParamList } from './mainTypes';

const Stack = createNativeStackNavigator<SearchStackParamList>();

export function SearchStack() {
  const screenOptions = useNativeStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {/* Deprecated: el buscador se movió al stack de Inicio (FeedStack). */}
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
