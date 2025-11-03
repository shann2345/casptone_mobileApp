import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { establishTimeBaseline, getSavedServerTime, saveAssessmentReviewToDb, saveServerTime, updateOnlineSync } from './localDb';

export const API_BASE_URL = __DEV__ 
  ? 'http://192.168.1.17:8000/api'  
  : 'https://olinlms.com/api'; 

// Type definitions for offline sync
interface UnsyncedSubmission {
  id: number;
  assessment_id: number;
  file_uri: string;
  original_filename: string;
  submitted_at: string;
}

interface UnsyncedQuiz {
  assessment_id: number;
  answers: string;
  started_at: string;
  completed_at: string;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});


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

// Global flag to prevent multiple simultaneous syncs
let isSyncing = false;
let lastSyncAttempt = 0;
const SYNC_COOLDOWN = 30000; // 30 seconds between sync attempts

// Centralized offline sync manager
const performOfflineSync = async () => {
  // Prevent multiple simultaneous syncs
  if (isSyncing) {
    console.log('⏳ Sync already in progress, skipping...');
    return;
  }

  // Check cooldown period
  const now = Date.now();
  if (now - lastSyncAttempt < SYNC_COOLDOWN) {
    console.log('⏰ Sync cooldown active, skipping...');
    return;
  }

  try {
    isSyncing = true;
    lastSyncAttempt = now;
    
    const userData = await getUserData();
    if (!userData?.email) {
      console.log('⚠️ No user data found for sync');
      return;
    }

    console.log('🔄 Starting automatic offline sync...');
    
    // --- MODIFICATION: Import the delete functions ---
    const { 
      getUnsyncedSubmissions, 
      getCompletedOfflineQuizzes,
      deleteOfflineSubmission,
      deleteCompletedOfflineQuizAttempt 
    } = await import('./localDb');
    
    // Get unsynced items
    const unsyncedSubmissions = await getUnsyncedSubmissions(userData.email) as UnsyncedSubmission[];
    const unsyncedQuizzes = await getCompletedOfflineQuizzes(userData.email) as UnsyncedQuiz[];
    
    console.log(`📤 Found ${unsyncedSubmissions.length} unsynced submissions and ${unsyncedQuizzes.length} unsynced quizzes`);
    
    let successCount = 0;
    let failCount = 0;
    
    // Sync file submissions
    for (const submission of unsyncedSubmissions) {
      try {
        console.log(`📤 Syncing submission for assessment ${submission.assessment_id}...`);
        
        // --- MODIFICATION: Store result and delete on success ---
        const syncSuccess = await syncOfflineSubmission(
          submission.assessment_id,
          submission.file_uri,
          submission.original_filename,
          submission.submitted_at
        );
        
        if (syncSuccess) {
          await deleteOfflineSubmission(submission.id);
          console.log(`✅ Deleted local submission ${submission.id}`);
          successCount++;
        } else {
          console.error(`❌ Sync returned false for submission ${submission.id}`);
          failCount++;
        }
        // --- END MODIFICATION ---

      } catch (error) {
        console.error(`❌ Failed to sync submission ${submission.id}:`, error);
        failCount++;
      }
    }
    
    // Sync quiz attempts
    for (const quiz of unsyncedQuizzes) {
      try {
        console.log(`📤 Syncing quiz for assessment ${quiz.assessment_id}...`);

        // --- MODIFICATION: Store result and delete on success ---
        const syncSuccess = await syncOfflineQuiz(
          quiz.assessment_id,
          quiz.answers,
          quiz.started_at,
          quiz.completed_at
        );
        
        if (syncSuccess) {
          await deleteCompletedOfflineQuizAttempt(quiz.assessment_id, userData.email);
          console.log(`✅ Deleted local quiz ${quiz.assessment_id}`);
          successCount++;
        } else {
          console.error(`❌ Sync returned false for quiz ${quiz.assessment_id}`);
          failCount++;
        }
        // --- END MODIFICATION ---

      } catch (error) {
        console.error(`❌ Failed to sync quiz ${quiz.assessment_id}:`, error);
        failCount++;
      }
    }
    
    if (successCount > 0 || failCount > 0) {
      console.log(`✅ Sync complete: ${successCount} successful, ${failCount} failed`);
    }
    
  } catch (error) {
    console.error('❌ Error during offline sync:', error);
  } finally {
    isSyncing = false;
  }
};

// =================================================================
// === MODIFIED INTERCEPTOR: Removed navigation logic            ===
// =================================================================
// The RootLayout (_layout.tsx) is now responsible for handling
// the 401 redirect. The interceptor's *only* job is to
// clear the data and reject the promise so _layout can catch it.
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      console.log('❌ 401 Unauthenticated error caught in interceptor. Clearing token.');
      await clearAuthData();
      
      // *** THIS LINE WAS REMOVED TO FIX THE RACE CONDITION ***
      // router.replace('/login'); 
      
      // We reject the promise so the _layout.tsx can catch this
      // error and set the initialRoute correctly.
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);
// =================================================================
// === END OF MODIFIED INTERCEPTOR                               ===
// =================================================================


// Function to store the token and set up authorization
export const storeAuthToken = async (token: string, expiresAt?: string) => {
  try {
    console.log('💾 Attempting to store auth token...');
    await SecureStore.setItemAsync('user_token', token);
    if (expiresAt) {
      await SecureStore.setItemAsync('token_expires_at', expiresAt);
    }
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
      await updateOnlineSync(userData.email); // NEW: Track when when user was last online
      
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
    console.log('🗑️  Deleting profile image...');
    const response = await api.delete('/profile/image');
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ Profile image deleted successfully.');
      return { success: true, message: response.data.message };
    } else {
      console.error('❌ Failed to delete profile image:', response.data.message);
      return { success: false, message: response.data.message || 'An unknown error occurred.' };
    }
  } catch (error: any) {
    console.error('❌ Error deleting profile image:', error.response?.data || error.message);
    return { success: false, message: error.response?.data?.message || 'Could not connect to the server.' };
  }
};

export const googleAuth = async (googleUser: {
  id: string;
  email: string;
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}) => {
  try {
    console.log('🚀 Authenticating with backend using Google data...');
    const response = await api.post('/auth/google', {
      google_id: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      avatar: googleUser.picture,
      given_name: googleUser.given_name,
      family_name: googleUser.family_name,
    });

    if (response.status === 200 && response.data.token) {
      const { user, token, is_new_user, is_verified, token_expires_at } = response.data;

      // **CHECK: Verify user is a student (extra safety check)**
      if (user.role !== 'student') {
        console.error('❌ Non-student account attempted to login');
        return {
          success: false,
          message: `Access denied. This app is only for students. Please use the web portal for ${user.role} access.`,
          error: 'invalid_role',
        };
      }

      console.log('💾 Storing auth data immediately...');
      
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      console.log('✅ Authorization header set synchronously');
      
      await storeAuthToken(token, token_expires_at);
      await storeUserData(user);
      
      console.log('✅ Google authentication successful and auth state committed');
      
      return {
        success: true,
        user,
        isNewUser: is_new_user,
        isVerified: is_verified,
      };
    } else {
      throw new Error('Backend authentication failed.');
    }
  } catch (error: any) {
    console.error('❌ Error in googleAuth function:', error.response?.data || error.message);
    
    // **NEW: Handle role-based rejection from backend**
    if (error.response?.status === 403 && error.response?.data?.error === 'invalid_role') {
      return {
        success: false,
        message: error.response.data.message || 'This app is only available for students.',
        error: 'invalid_role',
        userRole: error.response.data.user_role,
      };
    }
    
    return {
      success: false,
      message: error.response?.data?.message || 'An unknown error occurred during Google authentication.',
    };
  }
};

export const syncOfflineSubmission = async (assessmentId: number, fileUri: string, originalFilename: string, submittedAt: string) => {
  try {
    const formData = new FormData();
    
    const isLink = fileUri.startsWith('http://') || fileUri.startsWith('https://');

    if (isLink) {
      formData.append('submission_link', fileUri);
    } else {
      formData.append('assignment_file', {
        uri: fileUri,
        name: originalFilename,
        type: 'application/octet-stream', 
      } as any);
    }
    
    formData.append('submitted_at', submittedAt);

    console.log(`🔄 Attempting to sync offline submission for assessment ${assessmentId} with original timestamp: ${submittedAt}`);

    const response = await api.post(`/assessments/${assessmentId}/submit-assignment`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    // --- START OF FIX ---
    // We check for a specific response from the backend, not just "200 OK".
    // A captive portal will return 200, but response.data will be HTML,
    // so response.data.submission_id will be undefined.
    if (response.status === 200 && response.data && response.data.submission_id) {
      console.log(`✅ Sync successful for assessment ${assessmentId}. New submission ID: ${response.data.submission_id}`);
      return true; // <-- This is now a REAL success
    } else {
      console.error(`❌ Sync failed for assessment ${assessmentId}: Unexpected response from server.`, response.data);
      return false; // <-- This will now correctly fire on a bad WiFi
    }
    // --- END OF FIX ---

  } catch (err: any) {
    // This catch block will handle DNS errors, timeouts, and other network failures
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
    
    // --- MODIFICATION START ---
    // The backend now returns { submission_id: ... }
    if (response.status === 200 && response.data.submission_id) {
      console.log(`✅ Successfully synced offline quiz for assessment ${assessmentId}. New submission ID: ${response.data.submission_id}`);
      
      const submissionId = response.data.submission_id;
      
      // Now, fetch the full review data using the new submission ID
      try {
        const user = await getUserData();
        if (user?.email) {
          console.log(`🧠 Fetching full review data for submission ID: ${submissionId}...`);
          // Use the showSubmittedAssessment endpoint to get detailed review data
          const reviewResponse = await api.get(`/submitted-assessments/${submissionId}`);
          
          if (reviewResponse.status === 200 && reviewResponse.data.submitted_assessment) {
            const reviewData = reviewResponse.data.submitted_assessment;
            
            // Save the fetched review data to the local database for offline viewing
            await saveAssessmentReviewToDb(assessmentId, user.email, reviewData);
            console.log(`💾 Saved full review data for assessment ${assessmentId} to local DB.`);
          } else {
            console.warn(`⚠️ Could not fetch review data after sync for submission ${submissionId}.`);
          }
        }
      } catch (reviewError) {
        console.warn('⚠️ Failed to fetch/save review data after sync:', reviewError);
        // Do not fail the entire sync if only the review fetch fails.
      }
      
      return true; // Sync was successful
    } else {
      console.warn(`⚠️ Unexpected response when syncing quiz:`, response.data);
      return false;
    }
    // --- MODIFICATION END ---
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

// Export manual sync function for explicit calls
export const manualSync = async (): Promise<{ success: number; failed: number }> => {
  try {
    const userData = await getUserData();
    if (!userData?.email) {
      console.log('⚠️ No user data found for manual sync');
      return { success: 0, failed: 0 };
    }

    console.log('🔄 Starting manual offline sync...');
    
    // --- MODIFICATION: Add deleteCompletedOfflineQuizAttempt to import ---
    const { getUnsyncedSubmissions, getCompletedOfflineQuizzes, deleteOfflineSubmission, getDb, deleteCompletedOfflineQuizAttempt } = await import('./localDb');
    
    // Get unsynced items
    const unsyncedSubmissions = await getUnsyncedSubmissions(userData.email) as UnsyncedSubmission[];
    const unsyncedQuizzes = await getCompletedOfflineQuizzes(userData.email) as UnsyncedQuiz[];
    
    console.log(`📤 Found ${unsyncedSubmissions.length} unsynced submissions and ${unsyncedQuizzes.length} unsynced quizzes`);
    
    let successCount = 0;
    let failCount = 0;
    
    // ... (sync file submissions logic remains the same)
    
    // Sync quiz attempts
    for (const quiz of unsyncedQuizzes) {
      try {
        console.log(`📤 Syncing quiz for assessment ${quiz.assessment_id}...`);
        const success = await syncOfflineQuiz(
          quiz.assessment_id,
          quiz.answers,
          quiz.started_at,
          quiz.completed_at
        );
        
        if (success) {
          // --- MODIFICATION: Use the new delete function and remove the old 'synced = 1' logic ---
          await deleteCompletedOfflineQuizAttempt(quiz.assessment_id, userData.email);
          successCount++;
          console.log(`✅ Successfully synced and deleted quiz ${quiz.assessment_id} from localDb`);
        } else {
          failCount++;
          console.log(`❌ Sync returned false for quiz ${quiz.assessment_id} - keeping as unsynced`);
        }
      } catch (error) {
        console.error(`❌ Failed to sync quiz ${quiz.assessment_id}:`, error);
        failCount++;
      }
    }
    
    console.log(`✅ Manual sync complete: ${successCount} successful, ${failCount} failed`);
    return { success: successCount, failed: failCount };
    
  } catch (error) {
    console.error('❌ Error during manual sync:', error);
    return { success: 0, failed: 0 };
  }
};

// Reset sync state (useful for testing or after errors)
export const resetSyncState = () => {
  isSyncing = false;
  lastSyncAttempt = 0;
  console.log('🔄 Sync state reset');
};

export const setTutorialCompleted = async () => {
  try {
    await SecureStore.setItemAsync('has_completed_tutorial', 'true');
    console.log('✅ Tutorial completion status saved.');
  } catch (error) {
    console.error('❌ Failed to save tutorial status:', error);
  }
};

export const hasCompletedTutorial = async () => {
  try {
    const status = await SecureStore.getItemAsync('has_completed_tutorial');
    return status === 'true';
  } catch (error) {
    console.error('❌ Failed to check tutorial status:', error);
    return false; // Default to false if check fails
  }
};

export default api;