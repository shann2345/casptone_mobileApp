// _layout.tsx

import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import NetInfo from '@react-native-community/netinfo';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import CustomSplashScreen from '@/components/SplashScreen';
import { useColorScheme } from '@/hooks/useColorScheme';
import { AppProvider } from '../context/AppContext';
import { NetworkProvider } from '../context/NetworkContext';
import { OAuthProvider } from '../context/OAuthContext';
import api, { clearAuthData, getAuthToken, getUserData, initializeAuth } from '../lib/api';
import { initDb } from '../lib/localDb';

// --- This part remains the same ---
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  const [isInitializing, setIsInitializing] = useState(true);
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        console.log('🚀 Initializing app...');

        await initDb();
        console.log('✅ Database initialized');

        await initializeAuth();
        console.log('✅ Auth initialized');

        const token = await getAuthToken();
        const userData = await getUserData();

        if (token && userData) {
          console.log('✅ Existing authentication found for user:', userData.email);

          try {
            console.log('🛡️ Validating token with a protected endpoint (/my-courses)...');
            await api.get('/my-courses');
            console.log('✅ Token is valid.');

            console.log('Checking user verification status...');
            const verificationResponse = await api.get('/user/verification-status');
            const isVerified = verificationResponse.data.is_verified;

            if (isVerified) {
              console.log('✅ User is verified - Redirecting to app dashboard');
              setInitialRoute('(app)');
            } else {
              console.log('⚠️ User is not verified - Redirecting to verify-notice');
              setInitialRoute('(auth)/verify-notice');
            }
          } catch (error: any) {
            console.error('❌ Error during initial auth check:', error.message);

            if (error.response?.status === 401 || error.response?.status === 403) {
              console.log('🛡️ Auth error detected (401/403). Clearing data.');
              await clearAuthData();
              console.log('🔄 Redirecting to login');
              setInitialRoute('(auth)/login');
            } else if (!error.response) {
              console.log('⚠️ Network error during auth check. Performing direct network check...');
              const netState = await NetInfo.fetch();

              if (netState.isInternetReachable) {
                console.log('...Network IS reachable. Assuming flaky connection or invalid token. Redirecting to login.');
                await clearAuthData();
                setInitialRoute('(auth)/login');
              } else {
                console.log('...Network IS NOT reachable. Proceeding to app in offline mode.');
                setInitialRoute('(app)');
              }
            } else {
              console.log(`Server error (${error.response?.status}) during auth check. Redirecting to login.`);
              await clearAuthData();
              setInitialRoute('(auth)/login');
            }
          }
        } else {
          console.log('❌ No existing authentication found');
          console.log('🔄 Redirecting to login');
          setInitialRoute('(auth)/login');
        }
      } catch (error) {
        console.error('❌ App initialization error:', error);
        setInitialRoute('(auth)/login');
      } finally {
        setIsInitializing(false);
      }
    };

    if (loaded) {
      initializeApp();
    }
  }, [loaded]);

  const onLayoutRootView = useCallback(async () => {
    if (loaded && !isInitializing && initialRoute !== null) {
      console.log('✅ App initialized, hiding splash screen.');
      await SplashScreen.hideAsync();
    }
  }, [loaded, isInitializing, initialRoute]);

  // --- This is the "loading" state ---
  // Show the custom splash screen while we determine the route.
  // The native splash is still covering this.
  if (!loaded || isInitializing || initialRoute === null) {
    return <CustomSplashScreen />;
  }

  // --- This is the "ready" state ---
  // We've finished initializing and have a valid `initialRoute`.
  // Now we render the *actual* app, wrapped in the `onLayoutRootView`
  // to hide the native splash *after* this has rendered.
  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AppNavigator initialRoute={initialRoute} />
    </View>
  );
}

// --- NEW COMPONENT ---
// This component holds all the providers and the Stack navigator.
// It is *only* rendered by RootLayout *after* initialization is complete.
function AppNavigator({ initialRoute }: { initialRoute: string }) {
  const colorScheme = useColorScheme();

  return (
    <NetworkProvider>
      <AppProvider>
        <OAuthProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DefaultTheme : DarkTheme}>
            <Stack
              initialRouteName={initialRoute} // <-- Receives the correct route as a prop
              screenOptions={{ headerShown: false }}
            >
              <Stack.Screen name="(auth)/login" options={{ title: 'Login' }} />
              <Stack.Screen name="(auth)/signup" options={{ title: 'Sign Up' }} />
              <Stack.Screen name="(auth)/verify-notice" options={{ title: 'Verification Notice' }} />
              <Stack.Screen name="(app)" />
            </Stack>
            <StatusBar style="auto" />
          </ThemeProvider>
        </OAuthProvider>
      </AppProvider>
    </NetworkProvider>
  );
}