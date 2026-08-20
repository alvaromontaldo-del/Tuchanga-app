import type { BottomTabNavigationProp, BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp, CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import type { ChatScreenParams } from '../screens/chat/ChatScreen';
import type { DetalleServicioParams } from '../screens/servicios/DetalleServicioScreen';
import type { MaterialItemDraft, StoreBoardColumn } from '../types/materials';

/** Flujo lista de materiales (trabajador → desde chat con cliente). */
export type CreateMaterialRequestParams =
  | {
      clientId: string;
      conversationId?: string;
      clientLat?: number;
      clientLng?: number;
      title?: string;
    }
  | undefined;

export type SelectMaterialStoresParams = {
  title: string;
  items: MaterialItemDraft[];
  clientId?: string;
  conversationId?: string;
  clientLat: number;
  clientLng: number;
};

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
  DetalleServicio: DetalleServicioParams;
  CreateMaterialRequest: CreateMaterialRequestParams;
  SelectMaterialStores: SelectMaterialStoresParams;
};

/** Stack de búsqueda de profesionales */
export type SearchStackParamList = {
  SearchWorker: undefined;
  WorkerProfile: { workerId: string; conversationId?: string };
  WorkerPosts: { workerId: string };
  WorkerReviews: { workerId: string };
  ChatConversation: ChatScreenParams;
  CreateMaterialRequest: CreateMaterialRequestParams;
  SelectMaterialStores: SelectMaterialStoresParams;
};

/** Conversaciones y chat (tab Mensajes) */
export type MessagesStackParamList = {
  ConversationsList: undefined;
  ChatConversation: ChatScreenParams;
  WorkerProfile: { workerId: string; conversationId?: string };
  WorkerPosts: { workerId: string };
  WorkerReviews: { workerId: string };
  DetalleServicio: DetalleServicioParams;
  CreateMaterialRequest: CreateMaterialRequestParams;
  SelectMaterialStores: SelectMaterialStoresParams;
  ClientCompareQuotes: { requestId: string; readOnly?: boolean };
  MaterialOrderDetail: { orderId: string };
  MaterialOrderSummary: {
    requestId: string;
    selections: {
      quoteId: string;
      storeLabel: string;
      itemIds: string[];
      items: { id: string; description: string; lineTotal: number }[];
      includeFreight: boolean;
      freightCost: number;
      materialsSubtotal: number;
    }[];
  };
};

/** Tab Agenda (solo trabajador) */
export type AgendaStackParamList = {
  Agenda: { scrollToTopToken?: number; selectedDate?: string } | undefined;
  DetalleServicio: DetalleServicioParams;
  ChatConversation: ChatScreenParams;
  CreateMaterialRequest: CreateMaterialRequestParams;
  SelectMaterialStores: SelectMaterialStoresParams;
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
  ChangePassword: undefined;
};

/**
 * Shell solo-comercio (no se mezcla con Perfil cliente/profesional).
 */
export type CommerceStackParamList = {
  RegisterStore: undefined;
  EditStore: undefined;
  StoreMaterialRequests:
    | {
        initialColumn?: StoreBoardColumn;
        highlightRequestId?: string;
        highlightTargetId?: string;
      }
    | undefined;
  StoreQuoteRequest: {
    requestId: string;
    storeId: string;
  };
  StoreCloseOrder: { orderCode?: string } | undefined;
  CommerceAccount: undefined;
};

export type MainTabParamList = {
  Inicio: NavigatorScreenParams<FeedStackParamList>;
  Agenda: NavigatorScreenParams<AgendaStackParamList>;
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

export type AgendaStackScreenProps<T extends keyof AgendaStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<AgendaStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

/** Navegar desde `MyJobs` (stack Perfil) a otras pestañas. */
export type MyJobsScreenNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<AccountStackParamList, 'MyJobs'>,
  BottomTabNavigationProp<MainTabParamList>
>;
