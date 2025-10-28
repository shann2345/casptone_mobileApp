import NetInfo from '@react-native-community/netinfo'; // Import remains
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { AppProvider } from '../context/AppContext';
import { NetworkProvider } from '../context/NetworkContext';
import { OAuthProvider } from '../context/OAuthContext';
import api, { clearAuthData, getAuthToken, getUserData, initializeAuth } from '../lib/api';
import { initDb } from '../lib/localDb';

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

        // This check was not being used, so it's removed for clarity.
        // const currentAuthHeader = api.defaults.headers.common['Authorization'];
        // ...

        await initDb();
        console.log('✅ Database initialized');

        await initializeAuth();
        console.log('✅ Auth initialized');

        const token = await getAuthToken();
        const userData = await getUserData();

        if (token && userData) {
          console.log('✅ Existing authentication found for user:', userData.email);

          // ==========================================================
          // === MODIFICATION: Robust Auth Check                      ===
          // ==========================================================
          try {
            // STEP 1: Ping a real protected route to validate the token.
            // /my-courses is a good choice since the dashboard uses it.
            // If this fails (e.g., 401), it will be caught by the
            // catch block, which correctly routes to login.
            console.log('🛡️ Validating token with a protected endpoint (/my-courses)...');
            await api.get('/my-courses');
            console.log('✅ Token is valid.');

            // STEP 2: Since the token is valid, NOW we check verification.
            // This prevents the "false positive" from verification status alone.
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
            // This catch block is already robust and handles 401s,
            // network errors (offline), and flaky connections correctly.
            console.error('❌ Error during initial auth check:', error.message);

            // Check if it's a 401 or 403 auth error
            if (error.response?.status === 401 || error.response?.status === 403) {
              // This is an AUTHENTICATION error. The token is bad.
              console.log('🛡️ Auth error detected (401/403). Clearing data.');
              await clearAuthData();
              console.log('🔄 Redirecting to login');
              setInitialRoute('(auth)/login');
            } else if (!error.response) {
              // THIS IS THE AMBIGUOUS CASE: A NETWORK ERROR
              // (Truly offline OR online but flaky).
              console.log(
                '⚠️ Network error during auth check. Performing direct network check...'
              );
              const netState = await NetInfo.fetch();

              if (netState.isInternetReachable) {
                // The network is ON, but the API call failed (flaky, DNS, server down).
                // We can't trust the token. Log the user out to be safe.
                console.log(
                  '...Network IS reachable. Assuming flaky connection or invalid token. Redirecting to login.'
                );
                await clearAuthData();
                setInitialRoute('(auth)/login');
              } else {
                // The network is truly OFF. Proceed to offline mode.
                console.log(
                  '...Network IS NOT reachable. Proceeding to app in offline mode.'
                );
                setInitialRoute('(app)');
              }
            } else {
              // Some other server error (e.g., 500)
              console.log(
                `Server error (${error.response?.status}) during auth check. Redirecting to login.`
              );
              await clearAuthData();
              setInitialRoute('(auth)/login');
            }
          }
          // ==========================================================
          // === END OF MODIFICATION                                ===
          // ==========================================================
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

  // Show loading screen until both fonts are loaded AND initialization is complete
  if (!loaded || isInitializing || initialRoute === null) {
    return (
      <NetworkProvider>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#f0f4f7',
          }}>
          <ActivityIndicator size="large" color="#007bff" />
        </View>
      </NetworkProvider>
    );
  }

  return (
    <AppProvider>
      <NetworkProvider>
        <OAuthProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack
              initialRouteName={initialRoute}
              screenOptions={{
                headerShown: false,
              }}>
              <Stack.Screen
                name="(auth)/login"
                options={{
                  title: 'Login',
                }}
              />
              <Stack.Screen
                name="(auth)/signup"
                options={{
                  title: 'Sign Up',
                }}
              />
              <Stack.Screen
                name="(auth)/verify-notice"
                options={{
                  title: 'Verification Notice',
                }}
              />
              <Stack.Screen name="(app)" />
            </Stack>
            <StatusBar style="auto" />
          </ThemeProvider>
        </OAuthProvider>
      </NetworkProvider>
    </AppProvider>
  );
}