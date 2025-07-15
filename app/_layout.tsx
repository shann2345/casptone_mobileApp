import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  if (!loaded) {
    // Async font loading only occurs in development.
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
      {/*
        This Stack navigator wraps your entire app.
        The order of `Stack.Screen` components here can define the initial route
        if not explicitly set elsewhere (e.g., via authentication logic).
      */}

      {/* Login Screen - typically the entry point if not authenticated */}
      <Stack.Screen
        name="(auth)/login" // This matches app/login.tsx
        options={{
          headerShown: false, // Hide header for full-screen login
          title: 'Login',
        }}
      />

      {/* Signup Screen */}
      <Stack.Screen
        name="(auth)/signup" // This matches app/signup.tsx
        options={{
          headerShown: false, // Hide header for full-screen signup
          title: 'Sign Up',
        }}
      />
      {/* Verification Screen */}
      <Stack.Screen
        name="(auth)/verify-notice" 
        options={{
          headerShown: false, 
          title: 'Verification Notice',
        }}
      />
      {/*
        (app) Group - This is often where your authenticated content resides,
        like a Tab Navigator. We hide its header because its internal _layout.tsx
        will manage its own navigation/headers.
        A real app would conditionally render this based on authentication state.
      */}
      <Stack.Screen
        name="(app)" // This matches the folder app/(app)/
        options={{
          headerShown: false, // The tabs within (app) will handle their own headers
        }}
      />

      {/*
        You can add other top-level screens here if they don't fit into (app) or auth flow.
        Example:
        <Stack.Screen name="forgot-password" options={{ headerShown: true, title: 'Forgot Password' }} />
      */}
    </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
