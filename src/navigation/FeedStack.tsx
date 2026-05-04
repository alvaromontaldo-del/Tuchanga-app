import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors, stackChrome } from '../constants/theme';
import { HomeScreen } from '../screens/home/HomeScreen';
import { PublishPostScreen } from '../screens/home/PublishPostScreen';
import { PostDetailScreen } from '../screens/home/PostDetailScreen';
import { SearchWorkerScreen } from '../screens/search/SearchWorkerScreen';
import { WorkerProfileScreen } from '../screens/home/WorkerProfileScreen';
import { WorkerPostsScreen } from '../screens/home/WorkerPostsScreen';
import { WorkerReviewsScreen } from '../screens/home/WorkerReviewsScreen';
import { ChatConversationScreen } from '../screens/chat/ChatConversationScreen';
import type { FeedStackParamList } from './mainTypes';

const Stack = createNativeStackNavigator<FeedStackParamList>();

export function FeedStack() {
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
          presentation: 'modal',
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
        options={{ title: 'Chat' }}
      />
    </Stack.Navigator>
  );
}
