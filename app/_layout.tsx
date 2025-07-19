// app/_layout.tsx
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

      <Stack.Screen
        name="(auth)/login" // This matches app/login.tsx
        options={{
          headerShown: false, // Hide header for full-screen login
          title: 'Login',
        }}
      />
      <Stack.Screen
        name="(auth)/signup" // This matches app/signup.tsx
        options={{
          headerShown: false, // Hide header for full-screen signup
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
        name="(app)" // This matches the folder app/(app)/
        options={{
          headerShown: false, // The tabs within (app) will handle their own headers
        }}
      />
    </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}