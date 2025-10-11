import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { NetworkProvider } from '../context/NetworkContext';
import api, { getAuthToken, getUserData, initializeAuth } from '../lib/api';
import { initDb } from '../lib/localDb';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  
  const [isInitializing, setIsInitializing] = useState(true);
  const [initialRoute, setInitialRoute] = useState<string>('(auth)/login');

  useEffect(() => {
    const initializeApp = async () => {
      try {
        console.log('ðŸš€ Initializing app...');
        
        // Initialize database first
        await initDb();
        console.log('âœ… Database initialized');
        
        // Initialize authentication
        await initializeAuth();
        console.log('âœ… Auth initialized');
        
        // Check if user is already authenticated
        const token = await getAuthToken();
        const userData = await getUserData();
        
        if (token && userData) {
          console.log('âœ… Existing authentication found for user:', userData.email);
          
          // Check verification status before deciding where to redirect
          try {
            const verificationResponse = await api.get('/user/verification-status');
            const isVerified = verificationResponse.data.is_verified;
            
            if (isVerified) {
              console.log('ðŸŽ¯ User is verified - Redirecting to app dashboard');
              setInitialRoute('(app)');
            } else {
              console.log('âš ï¸ User is not verified - Redirecting to verify-notice');
              setInitialRoute('(auth)/verify-notice');
            }
          } catch (error) {
            console.error('âŒ Error checking verification status:', error);
            // If we can't check verification (e.g., offline), redirect to verify-notice to be safe
            console.log('ðŸŽ¯ Cannot verify status - Redirecting to verify-notice');
            setInitialRoute('(auth)/verify-notice');
          }
        } else {
          console.log('âŒ No existing authentication found');
          console.log('ðŸŽ¯ Redirecting to login');
          setInitialRoute('(auth)/login');
        }
      } catch (error) {
        console.error('âŒ App initialization error:', error);
        // On error, default to login
        setInitialRoute('(auth)/login');
      } finally {
        setIsInitializing(false);
      }
    };

    // Only initialize if fonts are loaded
    if (loaded) {
      initializeApp();
    }
  }, [loaded]);

  // Show loading screen while fonts are loading or app is initializing
  if (!loaded || isInitializing) {
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
    <NetworkProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack initialRouteName={initialRoute}>
          <Stack.Screen
            name="(auth)/login"
            options={{
              headerShown: false,
              title: 'Login',
            }}
          />
          <Stack.Screen
            name="(auth)/signup"
            options={{
              headerShown: false,
              title: 'Sign Up',
            }}
          />
          <Stack.Screen
            name="(auth)/verify-notice"
            options={{
              headerShown: false,
              title: 'Verification Notice',
            }}
          />
          <Stack.Screen
            name="(app)"
            options={{
              headerShown: false,
            }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </NetworkProvider>
  );
}