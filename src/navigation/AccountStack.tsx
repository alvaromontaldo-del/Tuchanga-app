import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../constants/theme';
import type { AccountStackParamList } from './mainTypes';
import { AccountGuestScreen } from '../screens/account/AccountGuestScreen';
import { MyAccountScreen } from '../screens/account/MyAccountScreen';
import { MyJobsScreen } from '../screens/jobs/MyJobsScreen';
import { MyWorkOrdersScreen } from '../screens/jobs/MyWorkOrdersScreen';
import { ContractedWorkOrdersScreen } from '../screens/jobs/ContractedWorkOrdersScreen';
import { EditRegistrationScreen } from '../screens/account/EditRegistrationScreen';
import { UserProfileScreen } from '../screens/account/UserProfileScreen';
import { WorkerABMScreen } from '../screens/account/WorkerABMScreen';
import { FavoritesScreen } from '../screens/account/FavoritesScreen';
import { useAuth } from '../context/AuthContext';

const Stack = createNativeStackNavigator<AccountStackParamList>();

const profileChildHeader = {
  headerShown: true as const,
  headerStyle: { backgroundColor: colors.brandLogoMat },
  headerShadowVisible: false,
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' as const, fontSize: 17 },
  headerBackTitleVisible: false,
};

export function AccountStack() {
  const { isAuthed } = useAuth();

  /** Stack separado: si mezclamos invitado + cuenta en un solo stack, al loguear puede quedar la ruta invitada activa. */
  if (!isAuthed) {
    return (
      <Stack.Navigator key="account-guest" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="AccountGuest" component={AccountGuestScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      key="account-authed"
      initialRouteName="MyAccount"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="MyAccount" component={MyAccountScreen} />
      <Stack.Screen
        name="UserProfile"
        component={UserProfileScreen}
        options={{
          ...profileChildHeader,
          title: 'Perfil',
        }}
      />
      <Stack.Screen
        name="EditRegistration"
        component={EditRegistrationScreen}
        options={{
          ...profileChildHeader,
          title: 'Mis datos',
        }}
      />
      <Stack.Screen name="WorkerABM" component={WorkerABMScreen} />
      <Stack.Screen
        name="MyJobs"
        component={MyJobsScreen}
        options={{
          ...profileChildHeader,
          title: 'Mis publicaciones',
        }}
      />
      <Stack.Screen
        name="MyWorkOrders"
        component={MyWorkOrdersScreen}
        options={{
          ...profileChildHeader,
          title: 'Mis trabajos',
        }}
      />
      <Stack.Screen
        name="ContractedWorkOrders"
        component={ContractedWorkOrdersScreen}
        options={{
          ...profileChildHeader,
          title: 'Trabajos contratados',
        }}
      />
      <Stack.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{
          ...profileChildHeader,
          title: 'Mis favoritos',
        }}
      />
    </Stack.Navigator>
  );
}
