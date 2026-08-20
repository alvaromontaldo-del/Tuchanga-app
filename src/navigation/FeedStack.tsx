import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNativeStackScreenOptions } from './useNativeStackScreenOptions';
import { HomeScreen } from '../screens/home/HomeScreen';
import { PublishPostScreen } from '../screens/home/PublishPostScreen';
import { PostDetailScreen } from '../screens/home/PostDetailScreen';
import { SearchWorkerScreen } from '../screens/search/SearchWorkerScreen';
import { WorkerProfileScreen } from '../screens/home/WorkerProfileScreen';
import { WorkerPostsScreen } from '../screens/home/WorkerPostsScreen';
import { WorkerReviewsScreen } from '../screens/home/WorkerReviewsScreen';
import { ChatConversationScreen } from '../screens/chat/ChatConversationScreen';
import { DetalleServicioScreen } from '../screens/servicios/DetalleServicioScreen';
import { CreateMaterialRequestScreen } from '../screens/materials/CreateMaterialRequestScreen';
import { SelectMaterialStoresScreen } from '../screens/materials/SelectMaterialStoresScreen';
import type { FeedStackParamList } from './mainTypes';

const Stack = createNativeStackNavigator<FeedStackParamList>();

export function FeedStack() {
  const screenOptions = useNativeStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SearchWorker"
        component={SearchWorkerScreen}
        options={{ headerShown: false }}
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
        name="PublishPost"
        component={PublishPostScreen}
        options={{
          title: 'Nueva publicación',
          presentation: Platform.OS === 'ios' ? 'modal' : 'card',
        }}
      />
      <Stack.Screen
        name="PostDetail"
        component={PostDetailScreen}
        options={{ title: 'Publicación' }}
      />
      <Stack.Screen
        name="ChatConversation"
        component={ChatConversationScreen}
        options={{ headerShown: false, title: 'Chat' }}
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
    </Stack.Navigator>
  );
}
