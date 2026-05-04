import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors, stackChrome } from '../constants/theme';
import { WorkerProfileScreen } from '../screens/home/WorkerProfileScreen';
import { WorkerPostsScreen } from '../screens/home/WorkerPostsScreen';
import { WorkerReviewsScreen } from '../screens/home/WorkerReviewsScreen';
import { ChatConversationScreen } from '../screens/chat/ChatConversationScreen';
import type { SearchStackParamList } from './mainTypes';

const Stack = createNativeStackNavigator<SearchStackParamList>();

export function SearchStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: stackChrome.headerStyle,
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: stackChrome.contentStyle,
      }}
    >
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
        options={{ title: 'Chat' }}
      />
    </Stack.Navigator>
  );
}
