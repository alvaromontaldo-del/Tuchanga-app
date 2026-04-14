import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from './mainTypes';
import { AccountStack } from './AccountStack';
import { FeedStack } from './FeedStack';
import { MainTabBar } from './MainTabBar';
import { MessagesStack } from './MessagesStack';
import { PublishTabPlaceholder } from './PublishTabPlaceholder';
import { SearchStack } from './SearchStack';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Inicio"
        component={FeedStack}
        options={{
          title: 'Inicio',
        }}
      />
      <Tab.Screen
        name="Buscar"
        component={SearchStack}
        options={{
          title: 'Buscar',
        }}
      />
      <Tab.Screen
        name="Publicar"
        component={PublishTabPlaceholder}
        options={{
          title: 'Publicar',
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
          },
        }}
      />
      <Tab.Screen
        name="Mensajes"
        component={MessagesStack}
        options={{
          title: 'Mensajes',
        }}
      />
      <Tab.Screen
        name="Perfil"
        component={AccountStack}
        options={{
          title: 'Perfil',
        }}
      />
    </Tab.Navigator>
  );
}
