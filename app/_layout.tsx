// Import new packages: SplashScreen, useCallback, and View
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native'; // <--- View is now used

import NetInfo from '@react-native-community/netinfo';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { AppProvider } from '../context/AppContext';
import { NetworkProvider } from '../context/NetworkContext';
import { OAuthProvider } from '../context/OAuthContext';
import api, { clearAuthData, getAuthToken, getUserData, initializeAuth } from '../lib/api';
import { initDb } from '../lib/localDb';

// <--- NEW: Prevent the splash screen from auto-hiding
// This runs before React even mounts
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
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
        // We are now done initializing, regardless of the outcome
        setIsInitializing(false);
      }
    };

    if (loaded) {
      initializeApp();
    }
  }, [loaded]);

  // <--- NEW: Create a callback to hide the splash screen
  // We'll call this once the root view's layout is complete
  const onLayoutRootView = useCallback(async () => {
    // Hide the splash screen ONLY when
    // 1. Fonts are loaded
    // 2. Auth check is complete
    if (loaded && !isInitializing) {
      await SplashScreen.hideAsync();
    }
  }, [loaded, isInitializing]);

  // Your original loading check is still correct.
  // While this is true, the native splash screen is still visible.
  if (!loaded || isInitializing || initialRoute === null) {
    return (
      <NetworkProvider>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f4f7' }}>
          <ActivityIndicator size="large" color="#007bff" />
        </View>
      </NetworkProvider>
    );
  }

  // Once initialization is done and we have a route,
  // we render the main app structure.
  return (
    <NetworkProvider>
      <AppProvider>
        <OAuthProvider>
          {/* <--- NEW: Wrap providers in a View and attach our layout callback */}
          <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <Stack
                initialRouteName={initialRoute} // This now has a guaranteed value
                screenOptions={{ headerShown: false }}
              >
                <Stack.Screen name="(auth)/login" options={{ title: 'Login' }} />
                <Stack.Screen name="(auth)/signup" options={{ title: 'Sign Up' }} />
                <Stack.Screen name="(auth)/verify-notice" options={{ title: 'Verification Notice' }} />
                <Stack.Screen name="(app)" />
              </Stack>
              <StatusBar style="auto" />
            </ThemeProvider>
          </View>
        </OAuthProvider>
      </AppProvider>
    </NetworkProvider>
  );
}