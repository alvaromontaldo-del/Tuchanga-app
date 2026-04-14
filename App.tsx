import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import { UserModeProvider } from './src/context/UserModeContext';
import { WorkerProfileProvider } from './src/context/WorkerProfileContext';
import { navigationRef } from './src/navigation/navigationRef';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <WorkerProfileProvider>
          <UserModeProvider>
            <NavigationContainer ref={navigationRef}>
              <SocketProvider>
                <RootNavigator />
              </SocketProvider>
            </NavigationContainer>
            <StatusBar style="dark" />
          </UserModeProvider>
        </WorkerProfileProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
