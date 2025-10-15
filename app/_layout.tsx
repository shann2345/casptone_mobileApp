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
import api, { getAuthToken, getUserData, initializeAuth } from '../lib/api';
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
        
        const currentAuthHeader = api.defaults.headers.common['Authorization'];
        if (currentAuthHeader && currentAuthHeader.toString().startsWith('Bearer ')) {
          console.log('🛡️ Active session detected in header, skipping initialization checks');
          setInitialRoute('(auth)/login');
          setIsInitializing(false);
          return;
        }

        await initDb();
        console.log('✅ Database initialized');
        
        await initializeAuth();
        console.log('✅ Auth initialized');
        
        const token = await getAuthToken();
        const userData = await getUserData();
        
        if (token && userData) {
          console.log('✅ Existing authentication found for user:', userData.email);
          
          try {
            const verificationResponse = await api.get('/user/verification-status');
            const isVerified = verificationResponse.data.is_verified;
            
            if (isVerified) {
              console.log('✅ User is verified - Redirecting to app dashboard');
              setInitialRoute('(app)');
            } else {
              console.log('⚠️ User is not verified - Redirecting to verify-notice');
              setInitialRoute('(auth)/verify-notice');
            }
          } catch (error) {
            console.error('❌ Error checking verification status:', error);
            console.log('🔄 Cannot verify status - Redirecting to verify-notice');
            setInitialRoute('(auth)/verify-notice');
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

  // Show loading screen until both fonts are loaded AND initialization is complete
  if (!loaded || isInitializing || initialRoute === null) {
    return (
      <NetworkProvider>
        <View style={{ 
          flex: 1, 
          justifyContent: 'center', 
          alignItems: 'center', 
          backgroundColor: '#f0f4f7' 
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
              }}
            >
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
              <Stack.Screen
                name="(app)"
              />
            </Stack>
            <StatusBar style="auto" />
          </ThemeProvider>
        </OAuthProvider>
      </NetworkProvider>
    </AppProvider>
  );
}