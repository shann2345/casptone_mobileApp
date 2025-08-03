// lib/auth.ts - Create this new file for authentication functions

import * as SecureStore from 'expo-secure-store';
import api, { clearAuthToken } from './api';
import { clearAllOfflineAccounts as clearUsersTable } from './localDb';

export interface LogoutOptions {
  clearOfflineData?: boolean; // Whether to clear SQLite data for offline access
  clearRemoteSession?: boolean; // Whether to call logout API endpoint
}

// Standard logout - clears everything (current behavior)
export const logout = async (options: LogoutOptions = { clearOfflineData: true, clearRemoteSession: true }) => {
  try {
    console.log('🚪 Starting logout process...');
    
    // Call API logout endpoint if online and requested
    if (options.clearRemoteSession) {
      try {
        console.log('📡 Calling remote logout API...');
        await api.post('/logout'); // This invalidates the token on the server
        console.log('✅ Remote session cleared');
      } catch (error) {
        console.log('⚠️  Remote logout failed (might be offline):', error.message);
        // Continue with local logout even if remote fails
      }
    }
    
    // Clear SecureStore data (token and user data)
    await clearAuthToken();
    console.log('✅ SecureStore cleared');
    
    // Clear SQLite data if requested
    if (options.clearOfflineData) {
      await clearUsersTable();
      console.log('✅ SQLite data cleared');
    } else {
      console.log('ℹ️  SQLite data preserved for offline access');
    }
    
    console.log('✅ Logout completed successfully');
    return true;
  } catch (error) {
    console.error('❌ Logout error:', error);
    return false;
  }
};

// Logout but keep offline data - for users who want offline access
export const logoutKeepOfflineData = async () => {
  return logout({ clearOfflineData: false, clearRemoteSession: true });
};

// Local logout only - doesn't call API (for offline scenarios)
export const logoutLocalOnly = async (keepOfflineData: boolean = false) => {
  return logout({ clearOfflineData: !keepOfflineData, clearRemoteSession: false });
};

// Check if user has offline data available
export const hasOfflineData = async (): Promise<boolean> => {
  try {
    const userData = await SecureStore.getItemAsync('user_data');
    // Note: We check userData instead of token because token gets cleared on logout
    // but we might want to keep user data for offline access
    return !!userData;
  } catch (error) {
    console.error('Error checking offline data:', error);
    return false;
  }
};