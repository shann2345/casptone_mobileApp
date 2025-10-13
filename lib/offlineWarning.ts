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
        '📱 Offline Usage Guidelines',
        '🔒 STRICT OFFLINE RULES:\n\n' +
        '• Must open app every 12 hours to maintain access\n' +
        '• Time changes over 1 hour accumulate (5 hour weekly limit)\n' +
        '• Any single time jump over 20 hours = immediate lock\n' +
        '• Backward time changes (even 2 minutes) = instant block\n' +
        '• Connect to internet to restore access after violations\n\n' +
        '✅ Normal usage:\n' +
        '   - Open app every 11 hours = Perfect!\n' +
        '   - Time changes under 1 hour = Not counted\n\n' +
        '❌ Will block access:\n' +
        '   - Skip 12+ hours without opening app\n' +
        '   - Move time backward by 2+ minutes\n' +
        '   - Accumulate 5+ hours of forward jumps per week',
        [
          {
            text: "Don't Show Again Today",
            onPress: async () => {
              await AsyncStorage.setItem(WARNING_KEY, currentTime.toString());
            }
          },
          {
            text: 'Understood',
            style: 'default'
          }
        ]
      );
    }
  } catch (error) {
    console.error('Error showing offline warning:', error);
    // Fallback to showing the warning without storage
    Alert.alert(
      '📱 Offline Mode Guidelines',
      'Time monitoring is enabled. Use app every 12 hours and avoid time manipulation to maintain access.',
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
    await AsyncStorage.setItem(WARNING_KEY, '0');
  } catch (error) {
    console.error('Error resetting warning cooldown:', error);
  }
};