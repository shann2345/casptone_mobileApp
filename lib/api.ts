// lib/api.ts - Updated version to handle unauthenticated errors and time manipulation

import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { detectTimeManipulation } from './localDb';

export const API_BASE_URL = 'http://192.168.1.7:8000/api'; // Or your actual IP/domain

let lastTimeCheckTimestamp = 0;
const TIME_CHECK_THROTTLE = 60000; // Only check time manipulation every 60 seconds

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

// Request interceptor with throttled time checks
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('user_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log('🔑 API Request: Token attached');
      } else {
        console.log('⚠️  API Request: No token found');
      }
      
      // FIXED: Throttle time manipulation checks
      const currentTime = Date.now();
      const shouldCheckTime = (currentTime - lastTimeCheckTimestamp) > TIME_CHECK_THROTTLE;
      
      if (shouldCheckTime) {
        console.log('🕐 Performing throttled time check...');
        const userData = await getUserData();
        if (userData && userData.email) {
          const timeCheck = await detectTimeManipulation(userData.email);
          if (!timeCheck.isValid) {
            console.log('❌ Time manipulation detected:', timeCheck.reason);
            // Clear auth data and redirect to login
            await clearAuthData();
            router.replace('/login');
            throw new Error('Time manipulation detected. Please log in again.');
          } else {
            lastTimeCheckTimestamp = currentTime;
            console.log('✅ Time check passed, updating throttle timestamp');
          }
        }
      } else {
        console.log('⏭️ Skipping time check (throttled)');
      }
    } catch (error) {
      console.error('❌ Error in request interceptor:', error);
      if (error.message === 'Time manipulation detected. Please log in again.') {
        return Promise.reject(error);
      }
      // FIXED: Don't reject other errors, just log them
      console.log('⚠️ Non-critical error in request interceptor, continuing...');
    }
    return config;
  },
  (error) => {
    console.error('❌ Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor to handle 401 Unauthenticated errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      console.log('❌ 401 Unauthenticated error caught. Clearing token and redirecting to login.');
      await clearAuthData();
      router.replace('/login');
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);

// Function to store the token
export const storeAuthToken = async (token: string) => {
  try {
    console.log('💾 Attempting to store auth token...');
    await SecureStore.setItemAsync('user_token', token);
    console.log('✅ Auth token stored successfully in SecureStore');
    
    // Verify it was stored
    const storedToken = await SecureStore.getItemAsync('user_token');
    if (storedToken === token) {
      console.log('✅ Token verification: PASSED');
    } else {
      console.log('❌ Token verification: FAILED');
    }
  } catch (error) {
    console.error('❌ Failed to store auth token:', error);
    throw error;
  }
};

// Function to get the token
export const getAuthToken = async () => {
  try {
    const token = await SecureStore.getItemAsync('user_token');
    return token;
  } catch (error) {
    console.error('❌ Failed to get auth token:', error);
    return null;
  }
};

// Function to store user data
export const storeUserData = async (userData: any) => {
  try {
    console.log('💾 Storing user data...');
    await SecureStore.setItemAsync('user_data', JSON.stringify(userData));
    console.log('✅ User data stored successfully');
  } catch (error) {
    console.error('❌ Failed to store user data:', error);
    throw error;
  }
};

// Function to get user data
export const getUserData = async () => {
  try {
    const userDataString = await SecureStore.getItemAsync('user_data');
    return userDataString ? JSON.parse(userDataString) : null;
  } catch (error) {
    console.error('❌ Failed to get user data:', error);
    return null;
  }
};

// UPDATED: More flexible clear functions
export const clearAuthToken = async () => {
  try {
    console.log('🗑️  Clearing auth token...');
    await SecureStore.deleteItemAsync('user_token');
    console.log('✅ Auth token cleared');
  } catch (error) {
    console.error('❌ Failed to clear auth token:', error);
  }
};

export const clearUserData = async () => {
  try {
    console.log('🗑️  Clearing user data...');
    await SecureStore.deleteItemAsync('user_data');
    console.log('✅ User data cleared');
  } catch (error) {
    console.error('❌ Failed to clear user data:', error);
  }
};

// NEW: Clear everything and redirect
export const clearAuthData = async () => {
  console.log('🗑️  Clearing ALL authentication data...');
  await clearAuthToken();
  await clearUserData();
  console.log('✅ All authentication data cleared.');
};

// NEW: Function to check if user was previously logged in (for offline access)
export const hasPreviousSession = async () => {
  try {
    const userData = await getUserData();
    return !!userData;
  } catch (error) {
    return false;
  }
};

// NEW: Function to create a temporary offline token
export const createOfflineSession = async (email: string) => {
  try {
    // Create a simple offline token (just for local identification)
    const offlineToken = `offline_${email}_${Date.now()}`;
    await SecureStore.setItemAsync('offline_token', offlineToken);
    console.log('✅ Offline session created');
    return offlineToken;
  } catch (error) {
    console.error('❌ Failed to create offline session:', error);
    return null;
  }
};

export const getOfflineToken = async () => {
  try {
    return await SecureStore.getItemAsync('offline_token');
  } catch (error) {
    return null;
  }
};

export const clearOfflineToken = async () => {
  try {
    await SecureStore.deleteItemAsync('offline_token');
  } catch (error) {
    console.error('Failed to clear offline token:', error);
  }
};

// Enhanced getServerTime function with time manipulation check
export const getServerTime = async (): Promise<string | null> => {
  try {
    console.log('📞 Calling API to get server time...');
    
    // Check for time manipulation before making the server time call
    const userData = await getUserData();
    if (userData && userData.email) {
      const timeCheck = await detectTimeManipulation(userData.email);
      if (!timeCheck.isValid) {
        console.log('❌ Time manipulation detected before server time fetch:', timeCheck.reason);
        throw new Error('Time manipulation detected');
      }
    }
    
    const response = await api.get('/time');
    if (response.status === 200 && response.data.server_time) {
      console.log('✅ Server time fetched:', response.data.server_time);
      return response.data.server_time;
    }
    console.warn('⚠️ Server time endpoint did not return a valid time.');
    return null;
  } catch (error) {
    console.error('❌ Error fetching server time:', error);
    return null;
  }
};

export default api;