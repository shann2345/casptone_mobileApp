import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { establishTimeBaseline, getSavedServerTime, saveAssessmentDetailsToDb, saveServerTime, updateOnlineSync } from './localDb';

export const API_BASE_URL = __DEV__ 
  ? 'http://192.168.1.10:8000/api'  // Development - Updated to match your Laravel server
  : 'https://your-cloud-domain.com/api'; // Production

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

// Request interceptor with proper authorization header setup
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('user_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        // Also set it in defaults for WebView access
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        console.log('🔐 API Request: Token attached');
      } else {
        console.log('⚠️  API Request: No token found');
      }
    } catch (error) {
      console.error('❌ Error in request interceptor:', error);
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

// Function to store the token and set up authorization
export const storeAuthToken = async (token: string) => {
  try {
    console.log('💾 Attempting to store auth token...');
    await SecureStore.setItemAsync('user_token', token);
    
    // Set the authorization header in axios defaults
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    
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
    if (token) {
      // Ensure the header is set when getting token
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    return token;
  } catch (error) {
    console.error('❌ Failed to get auth token:', error);
    return null;
  }
};

// Function to get current authorization header
export const getAuthorizationHeader = () => {
  return api.defaults.headers.common['Authorization'] || '';
};

// Function to initialize auth from stored token (call this on app start)
export const initializeAuth = async () => {
  try {
    const token = await SecureStore.getItemAsync('user_token');
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      console.log('✅ Authorization header initialized from stored token');
    }
  } catch (error) {
    console.error('❌ Failed to initialize auth:', error);
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
    // Clear from axios defaults
    delete api.defaults.headers.common['Authorization'];
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

export const getServerTime = async (isConnected: boolean = true): Promise<string | null> => {
  try {
    const userData = await getUserData();
    if (!userData?.email) {
      return null;
    }

    if (!isConnected) {
      // Offline mode - use calculated time
      const calculatedTime = await getSavedServerTime(userData.email);
      return calculatedTime;
    }

    // Online mode - fetch and update baseline
    const response = await api.get('/time');
    
    if (response.status === 200 && response.data.server_time) {
      const serverTime = response.data.server_time;
      
      // Save time baseline AND update online sync timestamp
      await saveServerTime(userData.email, serverTime, new Date().toISOString());
      await updateOnlineSync(userData.email); // NEW: Track when user was last online
      
      return serverTime;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error in getServerTime:', error);
    return null;
  }
};

export const prepareOfflineMode = async (): Promise<boolean> => {
  try {
    const userData = await getUserData();
    if (!userData?.email) {
      console.log('❌ No user data for offline preparation');
      return false;
    }

    // Establish time baseline if online
    const serverTime = await getServerTime(true);
    if (serverTime) {
      await establishTimeBaseline(userData.email, serverTime);
      console.log('✅ App prepared for offline usage');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Failed to prepare offline mode:', error);
    return false;
  }
};

export const getProfile = async () => {
  try {
    console.log('📋 Fetching user profile...');
    const response = await api.get('/profile');
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ Profile fetched successfully');
      return response.data.profile;
    } else {
      console.error('❌ Failed to fetch profile:', response.data.message);
      return null;
    }
  } catch (error: any) {
    console.error('❌ Error fetching profile:', error.response?.data || error.message);
    throw error; // Re-throw to handle in UI
  }
};

export const updateProfile = async (profileData: any, profileImage?: any) => {
  try {
    console.log('💾 Updating user profile...');
    console.log('Profile data:', profileData);
    console.log('Profile image:', profileImage ? 'Present' : 'None');
    
    // Check if we have an auth token
    const token = await getAuthToken();
    if (!token) {
      throw new Error('No authentication token found. Please log in again.');
    }
    
    const formData = new FormData();
    
    // Add text fields to FormData (only non-empty values)
    Object.keys(profileData).forEach(key => {
      const value = profileData[key];
      if (value !== null && value !== undefined && value !== '') {
        formData.append(key, String(value));
        console.log(`Added field: ${key} = ${value}`);
      }
    });
    
    // Add profile image if provided
    if (profileImage && profileImage.uri) {
      // Get file extension from uri or type
      let extension = 'jpeg';
      let mimeType = 'image/jpeg';
      
      if (profileImage.type && profileImage.type.includes('/')) {
        // Already has proper mime type
        mimeType = profileImage.type;
        extension = profileImage.type.split('/')[1] || 'jpeg';
      } else if (profileImage.uri) {
        // Extract extension from URI
        const uriParts = profileImage.uri.split('.');
        const fileExt = uriParts[uriParts.length - 1]?.toLowerCase();
        if (fileExt && ['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
          extension = fileExt === 'jpg' ? 'jpeg' : fileExt;
          mimeType = `image/${extension}`;
        }
      }
      
      const imageFile = {
        uri: profileImage.uri,
        name: profileImage.fileName || `profile_${Date.now()}.${extension}`,
        type: mimeType,
      } as any;
      
      formData.append('profile_image', imageFile);
      console.log('Added profile image:', {
        name: imageFile.name,
        type: imageFile.type,
        uri: imageFile.uri.substring(0, 50) + '...',
        originalType: profileImage.type,
        detectedExtension: extension
      });
    }
    
    console.log('Making API call to /profile...');
    console.log('API Base URL:', API_BASE_URL);
    
    const response = await api.post('/profile', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Accept': 'application/json',
      },
      timeout: 60000, // Increase timeout to 60 seconds for image uploads
    });
    
    console.log('API Response status:', response.status);
    console.log('API Response data:', response.data);
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ Profile updated successfully');
      return {
        success: true,
        profile: response.data.profile,
        message: response.data.message
      };
    } else {
      console.error('❌ Failed to update profile:', response.data.message);
      return {
        success: false,
        message: response.data.message || 'Failed to update profile',
        errors: response.data.errors
      };
    }
  } catch (error: any) {
    console.error('❌ Error updating profile:', error);
    console.error('Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL,
      }
    });
    
    // Provide more specific error messages
    let errorMessage = 'Network error occurred';
    if (error.code === 'NETWORK_ERROR' || error.message === 'Network Error') {
      errorMessage = 'Cannot connect to server. Please check your internet connection and try again.';
    } else if (error.response?.status === 413) {
      errorMessage = 'Image file is too large. Please select a smaller image.';
    } else if (error.response?.status === 422) {
      errorMessage = 'Validation error. Please check your input.';
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    }
    
    return {
      success: false,
      message: errorMessage,
      errors: error.response?.data?.errors
    };
  }
};

export const deleteProfileImage = async () => {
  try {
    console.log('🗑️ Deleting profile image...');
    const response = await api.delete('/profile/image');
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ Profile image deleted successfully');
      return {
        success: true,
        message: response.data.message
      };
    } else {
      return {
        success: false,
        message: response.data.message || 'Failed to delete profile image'
      };
    }
  } catch (error: any) {
    console.error('❌ Error deleting profile image:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.message || 'Network error occurred'
    };
  }
};

// Add this function to your api.ts file

export const googleAuth = async (googleUser: {
  id: string;
  email: string;
  name: string;
  picture?: string;
}) => {
  try {
    console.log('🔐 Authenticating with Google...');
    
    const response = await api.post('/auth/google', {
      google_id: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      avatar: googleUser.picture,
    });

    const { user, token, is_new_user } = response.data;

    // Store auth data
    await storeAuthToken(token);
    await storeUserData(user);

    console.log('✅ Google authentication successful');
    
    return {
      success: true,
      user,
      token,
      isNewUser: is_new_user,
      message: response.data.message
    };

  } catch (error: any) {
    console.error('❌ Google authentication failed:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Google authentication failed',
      error: error.response?.data?.error
    };
  }
};

export const syncOfflineSubmission = async (assessmentId: number, fileUri: string, originalFilename: string, submittedAt: string) => {
  try {
    const formData = new FormData();
    formData.append('assignment_file', {
      uri: fileUri,
      name: originalFilename,
      type: 'application/octet-stream',
    } as any);
    
    // Add the original submission timestamp to preserve offline submission time
    formData.append('submitted_at', submittedAt);

    console.log(`🔄 Attempting to sync offline submission for assessment ${assessmentId} with original timestamp: ${submittedAt}`);

    const response = await api.post(`/assessments/${assessmentId}/submit-assignment`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    if (response.status === 200) {
      console.log(`✅ Sync successful for assessment ${assessmentId}`);
      return true;
    } else {
      console.error(`❌ Sync failed for assessment ${assessmentId}:`, response.data.message);
      return false;
    }
  } catch (err: any) {
    console.error(`❌ Error syncing offline submission for assessment ${assessmentId}:`, err.response?.data || err.message);
    return false;
  }
};

export const syncOfflineQuiz = async (
  assessmentId: number,
  answers: string,
  startTime: string,
  endTime: string,
): Promise<boolean> => {
  try {
    console.log(`🔄 Attempting to sync offline quiz for assessment ID: ${assessmentId}`);
    
    const formattedAnswers = formatAnswersForSync(answers);
    
    const response = await api.post(`/assessments/${assessmentId}/sync-offline-quiz`, {
      answers: formattedAnswers,
      started_at: startTime,
      completed_at: endTime,
      submitted_at: endTime,
    });
    
    if (response.status === 200) {
      console.log(`✅ Successfully synced offline quiz for assessment ${assessmentId}`);
      
      // After successful sync, fetch and save the updated attempt status
      try {
        const attemptStatusResponse = await api.get(`/assessments/${assessmentId}/attempt-status`);
        if (attemptStatusResponse.status === 200) {
          const user = await getUserData();
          if (user?.email) {
            await saveAssessmentDetailsToDb(
              assessmentId,
              user.email,
              attemptStatusResponse.data,
              null
            );
            console.log('✅ Updated local attempt status after sync');
          }
        }
      } catch (error) {
        console.error('Failed to update local attempt status after sync:', error);
      }
      
      return true;
    } else {
      console.warn(`⚠️ Unexpected response when syncing quiz: ${response.status}`);
      return false;
    }
  } catch (error: any) {
    console.error(`❌ Error syncing offline quiz:`, error.response?.data || error.message);
    return false;
  }
};

const formatAnswersForSync = (answersJson: string): any[] => {
  try {
    const answers = typeof answersJson === 'string' 
      ? JSON.parse(answersJson) 
      : answersJson;
    
    const formattedAnswers = Object.keys(answers).map(questionId => {
      const questionData = answers[questionId];

      let selectedOptions: number[] = [];
      if (questionData.type === 'multiple_choice' || questionData.type === 'true_false') {
        if (Array.isArray(questionData.answer)) {
          selectedOptions = questionData.answer.map(optId => 
            typeof optId === 'string' ? parseInt(optId) : optId
          );
        } else if (questionData.answer !== undefined && questionData.answer !== null) {
          selectedOptions = [typeof questionData.answer === 'string' 
            ? parseInt(questionData.answer) 
            : questionData.answer];
        }
      }

      return {
        question_id: parseInt(questionId),
        question_type: questionData.type,
        submitted_answer: questionData.submitted_answer, // Use the pre-formatted text
        selected_options: selectedOptions,
        is_correct: questionData.is_correct,
        score_earned: questionData.score_earned
      };
    });
    
    return formattedAnswers;
  } catch (e) {
    console.error('Error formatting answers for sync:', e);
    return [];
  }
};

export default api;