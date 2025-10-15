// lib/offlineWarning.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

const WARNING_KEY = 'offline_mode_warning_shown';
const WARNING_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours

export const showOfflineModeWarningIfNeeded = async (): Promise<void> => {
  try {
    const lastWarningTime = await AsyncStorage.getItem(WARNING_KEY);
    const currentTime = Date.now();
    
    if (!lastWarningTime || (currentTime - parseInt(lastWarningTime)) > WARNING_COOLDOWN) {
      Alert.alert(
        `📶Offline Mode Instruction`,
        `You can use the app without an internet connection. Here’s what you need to know:\n\n` +
        `✅ **7-Day Access**\n` +
        `You have 168 hours of offline use. All features will work normally.\n\n` +
        `🔄 **Reset Your Timer**\n` +
        `Simply connect to the internet anytime to reset your 7-day offline timer.\n\n` +
        `⚠️ **Important: Device Clock Rules**\n` +
        `To ensure fairness, please do not manually change your device's date and time.\n\n` +
        `  ● **Moving time backward:** Results in an **instant block**.\n` +
        `  ● **Moving time forward > 24 hours:** Also results in an **instant block**.`,
        [
          {
            text: "Don't Show Again Today",
            onPress: async () => {
              await AsyncStorage.setItem(WARNING_KEY, currentTime.toString());
            }
          },
          {
            text: 'I Understand',
            style: 'default'
          }
        ]
      );
    }
  } catch (error) {
    console.error('Error showing offline warning:', error);
    // Fallback alert with consistent and essential information
    Alert.alert(
      'Offline Mode Notice',
      'You have 7 days of offline access. To avoid being locked out, please do not adjust your device\'s clock. Connect to the internet to reset your timer.',
      [{ text: 'Understood' }]
    );
  }
};

export const clearWarningHistory = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(WARNING_KEY);
  } catch (error) {
    console.error('Error clearing warning history:', error);
  }
};

export const resetWarningCooldown = async (): Promise<void> => {
  try {
    // Setting to '0' ensures the warning will show on the next check
    await AsyncStorage.setItem(WARNING_KEY, '0');
  } catch (error) {
    console.error('Error resetting warning cooldown:', error);
  }
};