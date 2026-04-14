import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors, stackChrome } from '../constants/theme';
import { ConversationsListScreen } from '../screens/chat/ConversationsListScreen';
import { ChatConversationScreen } from '../screens/chat/ChatConversationScreen';
import type { MessagesStackParamList } from './mainTypes';

const Stack = createNativeStackNavigator<MessagesStackParamList>();

export function MessagesStack() {
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
        name="ConversationsList"
        component={ConversationsListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ChatConversation"
        component={ChatConversationScreen}
        options={{ title: 'Chat' }}
      />
    </Stack.Navigator>
  );
}
