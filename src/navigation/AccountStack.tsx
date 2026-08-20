import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { colors } from '../constants/theme';
import {
  mergeNativeStackScreenOptions,
  useNativeStackScreenOptions,
} from './useNativeStackScreenOptions';
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
import { ChangePasswordScreen } from '../screens/account/ChangePasswordScreen';
import { useAuth } from '../context/AuthContext';

const Stack = createNativeStackNavigator<AccountStackParamList>();

export function AccountStack() {
  const { isAuthed } = useAuth();
  const stackOptions = useNativeStackScreenOptions();
  const profileChildHeader = useMemo(
    () =>
      mergeNativeStackScreenOptions(stackOptions, {
        headerShown: true,
        headerStyle: { backgroundColor: colors.brandLogoMat },
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
      }),
    [stackOptions],
  );

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
      screenOptions={mergeNativeStackScreenOptions(stackOptions, { headerShown: false })}
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
      <Stack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{
          ...profileChildHeader,
          title: 'Cambiar contraseña',
        }}
      />
    </Stack.Navigator>
  );
}
