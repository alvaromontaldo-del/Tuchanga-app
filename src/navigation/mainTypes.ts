import type { BottomTabNavigationProp, BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp, CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import type { ChatScreenParams } from '../screens/chat/ChatScreen';

/** Stack del feed (inicio) */
export type FeedStackParamList = {
  /** Al re-tocar el tab Inicio: scroll arriba + refresh */
  Home: { scrollToTopToken?: number } | undefined;
  SearchWorker: {
    initialQuery?: string;
    initialCategories?: string[];
    openFilters?: boolean;
  };
  WorkerProfile: { workerId: string; conversationId?: string };
  WorkerPosts: { workerId: string };
  WorkerReviews: { workerId: string };
  PublishPost: undefined;
  PostDetail: { postId: string };
  ChatConversation: ChatScreenParams;
};

/** Stack de búsqueda de profesionales */
export type SearchStackParamList = {
  SearchWorker: undefined;
  WorkerProfile: { workerId: string; conversationId?: string };
  WorkerPosts: { workerId: string };
  WorkerReviews: { workerId: string };
  ChatConversation: ChatScreenParams;
};

/** Conversaciones y chat (tab Mensajes) */
export type MessagesStackParamList = {
  ConversationsList: undefined;
  ChatConversation: ChatScreenParams;
};

/** Perfil, ajustes y flujos de cuenta (tab Perfil) */
export type AccountStackParamList = {
  AccountGuest: undefined;
  MyAccount: undefined;
  UserProfile: undefined;
  EditRegistration: undefined;
  WorkerABM: undefined;
  MyJobs: undefined;
  MyWorkOrders: undefined;
  ContractedWorkOrders: undefined;
  Favorites: undefined;
};

export type MainTabParamList = {
  Inicio: NavigatorScreenParams<FeedStackParamList>;
  Publicar: undefined;
  Mensajes: NavigatorScreenParams<MessagesStackParamList>;
  Perfil: NavigatorScreenParams<AccountStackParamList>;
};

export type FeedStackScreenProps<T extends keyof FeedStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<FeedStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

export type SearchStackScreenProps<T extends keyof SearchStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<SearchStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

export type MessagesStackScreenProps<T extends keyof MessagesStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<MessagesStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

export type AccountStackScreenProps<T extends keyof AccountStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<AccountStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

/** Navegar desde `MyJobs` (stack Perfil) a otras pestañas. */
export type MyJobsScreenNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<AccountStackParamList, 'MyJobs'>,
  BottomTabNavigationProp<MainTabParamList>
>;
