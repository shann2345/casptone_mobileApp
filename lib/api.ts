import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { detectTimeManipulation, saveAssessmentDetailsToDb } from './localDb';

export const API_BASE_URL = __DEV__ 
  ? 'http://192.168.1.7:8000/api'  // Development
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
        console.log('ðŸ”‘ API Request: Token attached');
      } else {
        console.log('âš ï¸  API Request: No token found');
      }
    } catch (error) {
      console.error('âŒ Error in request interceptor:', error);
      console.log('âš ï¸ Non-critical error in request interceptor, continuing...');
    }
    return config;
  },
  (error) => {
    console.error('âŒ Request interceptor error:', error);
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
      console.log('âŒ 401 Unauthenticated error caught. Clearing token and redirecting to login.');
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
    console.log('ðŸ’¾ Attempting to store auth token...');
    await SecureStore.setItemAsync('user_token', token);
    
    // Set the authorization header in axios defaults
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    
    console.log('âœ… Auth token stored successfully in SecureStore');
    
    // Verify it was stored
    const storedToken = await SecureStore.getItemAsync('user_token');
    if (storedToken === token) {
      console.log('âœ… Token verification: PASSED');
    } else {
      console.log('âŒ Token verification: FAILED');
    }
  } catch (error) {
    console.error('âŒ Failed to store auth token:', error);
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
    console.error('âŒ Failed to get auth token:', error);
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
      console.log('âœ… Authorization header initialized from stored token');
    }
  } catch (error) {
    console.error('âŒ Failed to initialize auth:', error);
  }
};

// Function to store user data
export const storeUserData = async (userData: any) => {
  try {
      console.log('ðŸ’¾ Storing user data...');
      await SecureStore.setItemAsync('user_data', JSON.stringify(userData));
      console.log('âœ… User data stored successfully');
  } catch (error) {
    console.error('âŒ Failed to store user data:', error);
    throw error;
  }
};

// Function to get user data
export const getUserData = async () => {
  try {
    const userDataString = await SecureStore.getItemAsync('user_data');
    return userDataString ? JSON.parse(userDataString) : null;
  } catch (error) {
    console.error('âŒ Failed to get user data:', error);
    return null;
  }
};

// UPDATED: More flexible clear functions
export const clearAuthToken = async () => {
  try {
    console.log('ðŸ—‘ï¸  Clearing auth token...');
    await SecureStore.deleteItemAsync('user_token');
    // Clear from axios defaults
    delete api.defaults.headers.common['Authorization'];
    console.log('âœ… Auth token cleared');
  } catch (error) {
    console.error('âŒ Failed to clear auth token:', error);
  }
};

export const clearUserData = async () => {
  try {
    console.log('ðŸ—‘ï¸  Clearing user data...');
    await SecureStore.deleteItemAsync('user_data');
    console.log('âœ… User data cleared');
  } catch (error) {
    console.error('âŒ Failed to clear user data:', error);
  }
};

// NEW: Clear everything and redirect
export const clearAuthData = async () => {
  console.log('ðŸ—‘ï¸  Clearing ALL authentication data...');
  await clearAuthToken();
  await clearUserData();
  console.log('âœ… All authentication data cleared.');
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
    console.log('âœ… Offline session created');
    return offlineToken;
  } catch (error) {
    console.error('âŒ Failed to create offline session:', error);
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
    console.log('ðŸ“ž Calling API to get server time...');
    
    // Check for time manipulation before making the server time call
    const userData = await getUserData();
    if (userData && userData.email) {
      const timeCheck = await detectTimeManipulation(userData.email);
      if (!timeCheck.isValid) {
        console.log('âŒ Time manipulation detected before server time fetch:', timeCheck.reason);
        throw new Error('Time manipulation detected');
      }
    }
    
    const response = await api.get('/time');
    if (response.status === 200 && response.data.server_time) {
      console.log('âœ… Server time fetched:', response.data.server_time);
      return response.data.server_time;
    }
    console.warn('âš ï¸ Server time endpoint did not return a valid time.');
    return null;
  } catch (error) {
    console.error('âŒ Error fetching server time:', error);
    return null;
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

    console.log(`🔡 Attempting to sync offline submission for assessment ${assessmentId} with original timestamp: ${submittedAt}`);

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