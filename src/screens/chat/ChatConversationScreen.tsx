import { useRoute, type RouteProp } from '@react-navigation/native';
import { ChatScreen, type ChatScreenParams } from './ChatScreen';

type ChatRoute = RouteProp<{ ChatConversation: ChatScreenParams }, 'ChatConversation'>;

export function ChatConversationScreen() {
  const route = useRoute<ChatRoute>();
  const { conversationId, otherDisplayName, headerSubtitle, workerId } = route.params;
  return (
    <ChatScreen
      conversationId={conversationId}
      otherDisplayName={otherDisplayName}
      headerSubtitle={headerSubtitle}
      workerId={workerId}
    />
  );
}
