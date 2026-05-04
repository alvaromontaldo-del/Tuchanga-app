let activeConversationId: string | null = null;

export function setActiveConversationForNotifications(conversationId: string | null) {
  activeConversationId = conversationId ? String(conversationId) : null;
}

export function getActiveConversationForNotifications(): string | null {
  return activeConversationId;
}

