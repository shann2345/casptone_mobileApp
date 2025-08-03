// app/_layout.tsx

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { NetworkProvider } from '../context/NetworkContext'; // <-- Make sure this import is correct

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  if (!loaded) {
    return null;
  }

  return (
    // The NetworkProvider must wrap all navigation components and their children.
    <NetworkProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
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