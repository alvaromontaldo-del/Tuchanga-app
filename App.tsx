import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import { UnreadMessagesProvider } from './src/context/UnreadMessagesContext';
import { UserModeProvider } from './src/context/UserModeContext';
import { WorkerProfileProvider } from './src/context/WorkerProfileContext';
import { FavoritesProvider } from './src/context/FavoritesContext';
import { ToastProvider } from './src/components/toast/ToastProvider';
import { navigationRef } from './src/navigation/navigationRef';
import { RootNavigator } from './src/navigation/RootNavigator';
import { initNotificationHandlerOnce } from './src/services/notificationsInit';

export default function App() {
  useEffect(() => {
    initNotificationHandlerOnce();
  }, []);

  return (
    <SafeAreaProvider>
      <ToastProvider>
        <AuthProvider>
          <WorkerProfileProvider>
            <FavoritesProvider>
              <UserModeProvider>
                <UnreadMessagesProvider>
                  <NavigationContainer ref={navigationRef}>
                    <SocketProvider>
                      <RootNavigator />
                    </SocketProvider>
                  </NavigationContainer>
                </UnreadMessagesProvider>
                <StatusBar style="dark" />
              </UserModeProvider>
            </FavoritesProvider>
          </WorkerProfileProvider>
        </AuthProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
