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
        `Offline Mode - 7 Day Access`,
        `SIMPLE OFFLINE RULES:\n\n` + 
        `You have 7 days (168 hours) of offline access\n` +
        `Timer resets when you go online\n` +
        `All features work normally offline\n\n` +
        `TIME MANIPULATION:\n\n` +
        `  Backward time = INSTANT BLOCK\n` +
        `  (Even 2 minutes backwards)\n\n` +
        `  Forward time > 24 hours = INSTANT BLOCK\n` +
        `  (Normal sleep/usage under 24 hours is allowed)\n\n` +
        `  Connect to internet anytime to reset your 7 days.`,
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
      'Offline Mode - 24 Hour Access',
      '24-hour offline access window. Forward time manipulation reduces your remaining time. Backward time manipulation blocks access instantly. Connect to internet to reset.',
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