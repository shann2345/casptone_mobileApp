import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../context/NetworkContext';
import api, { clearAuthToken, getAuthToken, getServerTime, getUserData, syncOfflineQuiz, syncOfflineSubmission } from '../../lib/api';
import {
  deleteOfflineQuizAttempt,
  deleteOfflineSubmission,
  downloadAllQuizQuestions,
  getAssessmentsNeedingSync,
  getAssessmentsWithoutDetails,
  getCompletedOfflineQuizzes,
  getDb,
  getEnrolledCoursesFromDb,
  getOfflineTimeStatus,
  getUnsyncedSubmissions,
  initDb,
  resetTimeCheckData,
  saveCourseDetailsToDb,
  saveCourseToDb,
  saveServerTime,
  syncAllAssessmentDetails,
  updateTimeSync
} from '../../lib/localDb';
import { showOfflineModeGuide, showOfflineModeWarningIfNeeded } from '../../lib/offlineWarning';
const { width, height } = Dimensions.get('window');

interface Course {
  id: number;
  title: string;
  course_code: string;
  description: string;
  credits: number;
  status: string; // Added status field
  program: {
    id: number;
    name: string;
  };
  instructor: {
    id: number;
    name: string;
    given_name: string;
  };
}

interface EnrolledCourse extends Course {
  pivot?: {
    status: string;
    enrollment_date: string;
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const [userName, setUserName] = useState<string>('Guest');
  const [isSearchModalVisible, setSearchModalVisible] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Course[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState<boolean>(false);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [isLoadingEnrolledCourses, setIsLoadingEnrolledCourses] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [isDownloadingData, setIsDownloadingData] = useState(false);
  const [assessmentsNeedingDetails, setAssessmentsNeedingDetails] = useState<number>(0);
  const [isAdVisible, setIsAdVisible] = useState<boolean>(false);
  const adContentHeight = 80;
  const {isConnected, netInfo } = useNetworkStatus();
  const enrolledCoursesFlatListRef = useRef<FlatList<EnrolledCourse>>(null);
  const [offlineStatus, setOfflineStatus] = useState<{ remainingHours: number; totalHours: number } | null>(null);

  // NEW: State for enrollment modal
  const [isEnrollModalVisible, setIsEnrollModalVisible] = useState<boolean>(false);
  const [courseToEnroll, setCourseToEnroll] = useState<Course | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState<string>('');
  const [isEnrolling, setIsEnrolling] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Utility function for retry logic with exponential backoff
  const retryWithBackoff = async (fn: Function, maxRetries = 3, baseDelay = 1000) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        const delay = baseDelay * Math.pow(2, i);
        console.log(`Retry attempt ${i + 1}/${maxRetries} in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };

  // Check if data is stale
  const isDataStale = (lastSync: string | null, maxAge: number = 3600000) => { // 1 hour default
    if (!lastSync) return true;
    return Date.now() - new Date(lastSync).getTime() > maxAge;
  };

  useEffect(() => {
  let isMounted = true;
  const initialize = async () => {
    try {
      console.log('ðŸ”§ Initializing home screen...');
      
      // Add retry logic for initialization
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries && isMounted) {
        try {
          await initDb();
          console.log('âœ… Home screen database initialized');
          if (isMounted) {
            setIsInitialized(true);
          }
          break; // Success, exit retry loop
        } catch (initError) {
          retryCount++;
          console.error(`Home screen initialization error (attempt ${retryCount}):`, initError);
          
          if (retryCount < maxRetries) {
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          } else {
            throw initError;
          }
        }
      }
    } catch (error) {
      console.error('â Œ Final home screen initialization error:', error);
      if (isMounted) {
        Alert.alert(
          'Initialization Error',
          'Failed to initialize the app. Please restart the application.',
          [{ text: 'OK' }]
        );
      }
    }
  };
  initialize();
  return () => { 
    isMounted = false;
  };
}, []);

  useEffect(() => {
    const updateOfflineStatus = async () => {
      if (netInfo?.isInternetReachable === false && isInitialized) {
        try {
          const userData = await getUserData();
          if (userData?.email) {
            const status = await getOfflineTimeStatus(userData.email);
            if (status && !status.isBlocked) {
              setOfflineStatus({
                remainingHours: status.remainingHours,
                totalHours: status.totalHours,
              });
            } else {
              setOfflineStatus({ remainingHours: 0, totalHours: 168 }); // Show 0 if blocked
            }
          }
        } catch (e) {
          console.error('Failed to update offline status', e);
          setOfflineStatus(null);
        }
      } else {
        // Clear status when online
        setOfflineStatus(null);
      }
    };

    updateOfflineStatus();
  }, [netInfo?.isInternetReachable, isInitialized, isRefreshing]);

  // Enhanced smart sync assessment data with retry logic and better status tracking
  const autoDownloadAssessmentData = async (userEmail: string, forceRefresh: boolean = false) => {
    if (!netInfo?.isInternetReachable) {
      console.log('ðŸ“¡ No internet connection - skipping smart sync');
      setSyncStatus('Offline - sync skipped');
      return { success: true, downloaded: 0, failed: 0 };
    }

    // Check data freshness
    if (!forceRefresh && !isDataStale(lastSyncTime)) {
      console.log('ï¿½ Data is fresh, skipping sync');
      setSyncStatus('Data is up to date');
      return { success: true, downloaded: 0, failed: 0 };
    }

    try {
      console.log('ï¿½ðŸ”„ Starting enhanced smart assessment data sync...');
      setIsDownloadingData(true);
      setDownloadProgress({ current: 0, total: 0 });
      setSyncStatus('Initializing sync...');

      // Use retry logic for critical operations
      const syncResult = await retryWithBackoff(async () => {
        setSyncStatus('Syncing assessment details...');
        return await syncAllAssessmentDetails(
          userEmail,
          api,
          (current, total, type) => {
            setDownloadProgress({ current, total });
            setSyncStatus(`Processing ${type}: ${current}/${total} assessments`);
            console.log(`${type}: ${current}/${total} assessments processed`);
          }
        );
      }, 3, 2000);

      console.log(`Smart Sync Complete: ${syncResult.success} successful, ${syncResult.failed} failed, ${syncResult.updated} updated`);

      // Download quiz questions with chunked processing
      setSyncStatus('Downloading quiz questions...');
      const quizResult = await retryWithBackoff(async () => {
        return await downloadAllQuizQuestions(
          userEmail,
          api,
          (current, total, skipped = 0) => {
            const baseProgress = syncResult.success;
            setDownloadProgress({ current: current + baseProgress, total: total + baseProgress });
            setSyncStatus(`Quiz questions: ${current}/${total} (${skipped} skipped)`);
            console.log(`Downloaded ${current}/${total} quiz questions (${skipped} skipped)`);
          }
        );
      }, 2, 1500);

      console.log(`Quiz Questions: ${quizResult.success} successful, ${quizResult.failed} failed, ${quizResult.skipped} skipped`);

      const totalSuccessful = syncResult.success + quizResult.success;
      const totalFailed = syncResult.failed + quizResult.failed;

      // Update sync timestamp on success
      if (totalSuccessful > 0) {
        const now = new Date().toISOString();
        setLastSyncTime(now);
        setSyncStatus(`Synced ${totalSuccessful} items successfully`);
        console.log(`Successfully synced ${totalSuccessful} items for offline access`);
      }

      if (totalFailed > 0) {
        console.warn(`Some downloads failed: ${totalFailed} items - offline data preserved`);
        setSyncStatus(`${totalFailed} items failed, offline data preserved`);
      }

      // Update assessment count
      const remainingAssessments = await getAssessmentsWithoutDetails(userEmail);
      setAssessmentsNeedingDetails(remainingAssessments.length);

      return { success: true, downloaded: totalSuccessful, failed: totalFailed };

    } catch (error) {
      console.error('Enhanced sync failed:', error);
      setSyncStatus('Sync failed - offline data preserved');
      // Don't throw - preserve existing data
      return { success: false, downloaded: 0, failed: 1 };
    } finally {
      setIsDownloadingData(false);
      setDownloadProgress({ current: 0, total: 0 });
      // Clear status after a delay
      setTimeout(() => setSyncStatus(''), 3000);
    }
  };

  function formatRemainingTime(remainingHours: number): string {
    const totalMinutes = Math.floor(remainingHours * 60);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    let parts = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    return parts.join(', ');
  }

  useEffect(() => {
    const syncSubmissions = async () => {
      if (!isInitialized) return;

      const hasRealInternet = netInfo?.isInternetReachable === true;
      if (hasRealInternet) {
        console.log('Network is back online. Checking for unsynced submissions...');
        const user = await getUserData();
        if (!user || !user.email) {
          console.log('User not found. Cannot sync submissions.');
          return;
        }

        // Check and sync for assignment submissions
        const unsyncedAssignments = await getUnsyncedSubmissions(user.email);
        if (unsyncedAssignments.length > 0) {
          Alert.alert(
            'Synchronization',
            `Found ${unsyncedAssignments.length} offline assignment submission(s) to sync.`,
            [{ text: 'OK' }]
          );
          for (const submission of unsyncedAssignments) {
            console.log(`Attempting to sync assignment for assessment ID: ${submission.assessment_id}`);
            const success = await syncOfflineSubmission(
              submission.assessment_id,
              submission.file_uri,
              submission.original_filename,
              submission.submitted_at
            );
            if (success) {
              await deleteOfflineSubmission(submission.id);
              console.log(`Successfully synced and deleted local record for assignment ${submission.assessment_id}`);
            } else {
              console.warn(`Failed to sync assignment for assessment ${submission.assessment_id}`);
            }
          }
        }
        
        // Check and sync for quiz attempts
        const completedOfflineQuizzes = await getCompletedOfflineQuizzes(user.email);
        if (completedOfflineQuizzes.length > 0) {
          Alert.alert(
            'Synchronization',
            `Found ${completedOfflineQuizzes.length} offline quiz attempt(s) to sync.`,
            [{ text: 'OK' }]
          );

          for (const quizAttempt of completedOfflineQuizzes) {
            console.log(`Attempting to sync quiz for assessment ID: ${quizAttempt.assessment_id}`);
            
            if (!quizAttempt.answers || !quizAttempt.start_time || !quizAttempt.end_time) {
              console.warn(`Skipping sync for quiz ${quizAttempt.assessment_id} - missing required data`);
              continue;
            }

            const success = await syncOfflineQuiz(
              quizAttempt.assessment_id,
              quizAttempt.answers,
              quizAttempt.start_time,
              quizAttempt.end_time
            );
            if (success) {
              await deleteOfflineQuizAttempt(quizAttempt.assessment_id, user.email);
              console.log(`Successfully synced and deleted local record for quiz attempt ${quizAttempt.assessment_id}`);
            } else {
              console.warn(`Failed to sync quiz attempt ${quizAttempt.assessment_id}`);
            }
          }
        }
        
        // After attempting to sync, refresh the course list to get updated submission statuses
        fetchCourses();
      }
    };
    syncSubmissions();
  }, [netInfo?.isInternetReachable, isInitialized]);

  useEffect(() => {
    const checkAssessmentsNeedingDetails = async () => {
      if (!isInitialized) return;
      
      try {
        const userData = await getUserData();
        if (userData?.email) {
          const assessmentIds = await getAssessmentsWithoutDetails(userData.email);
          setAssessmentsNeedingDetails(assessmentIds.length);
        }
      } catch (error) {
        console.error('Error checking assessments needing details:', error);
      }
    };
    
    checkAssessmentsNeedingDetails();
  }, [enrolledCourses, isInitialized]);

  useEffect(() => {
    const checkOfflineWarning = async () => {
      if (!netInfo?.isInternetReachable) {
        await showOfflineModeWarningIfNeeded();
      }
    };
    
    checkOfflineWarning();
  }, [netInfo?.isInternetReachable]);

  const fetchAndSaveCompleteCoursesData = async (courses: EnrolledCourse[], userEmail: string) => {
    console.log('Starting to fetch complete course data for offline access...');

    for (const course of courses) {
      try {
        console.log(`Fetching detailed data for course: ${course.title} (ID: ${course.id})`);
        
        const courseId = typeof course.id === 'string' ? parseInt(course.id, 10) : course.id;
        
        if (!courseId || isNaN(courseId) || courseId <= 0) {
          console.error('â Œ Invalid course ID detected:', {
            originalId: course.id,
            convertedId: courseId,
            courseTitle: course.title
          });
          continue;
        }
        
        console.log(`Processing course with validated ID: ${courseId} (type: ${typeof courseId})`);

        const courseDetailResponse = await api.get(`/courses/${courseId}`);
        
        if (courseDetailResponse.status === 200) {
          const detailedCourse = courseDetailResponse.data.course;
          
          if (!detailedCourse.id) {
            detailedCourse.id = courseId;
          }
          
          console.log(`Fetched detailed data for course ${courseId}:`, {
            topics: detailedCourse.topics?.length || 0,
            assessments: detailedCourse.assessments?.length || 0,
            materials: detailedCourse.materials?.length || 0
          });
          
          await saveCourseDetailsToDb(detailedCourse, userEmail);
          console.log(`Successfully saved detailed data for course: ${detailedCourse.title}`);
        } else {
          console.warn(`Failed to fetch detailed data for course ${courseId}: Status ${courseDetailResponse.status}`);
        }
      } catch (saveError: any) {
        console.error(`Failed to fetch/save complete data for course ${course.title}:`, saveError.message || saveError);
      }
    }
    console.log('Completed fetching and saving all course data for offline access');
  };

  const fetchCourses = async () => {
    if (!isInitialized || netInfo === null) return;

    let userEmail = '';
    try {
      const userData = await getUserData();
      if (userData && userData.name && userData.email) {
        setUserName(userData.given_name || userData.name || 'Guest');
        userEmail = userData.email;
      } else {
        console.warn('User data or name not found in local storage. Redirecting to login.');
        await clearAuthToken();
        router.replace('/login');
        return;
      }
    } catch (error) {
      console.error('â Œ Error getting user data:', error);
      router.replace('/login');
      return;
    }

    setIsLoadingEnrolledCourses(true);

    try {
      const hasRealInternet = netInfo?.isInternetReachable === true;
      
      if (hasRealInternet) {
        const token = await getAuthToken();
        if (!token) {
          Alert.alert(
            "Session Expired",
            "You were logged in offline. Please log in again to sync your data.",
            [{ text: "OK", onPress: () => router.replace('/login') }]
          );
          setIsLoadingEnrolledCourses(false);
          return;
        }
        
        await resetTimeCheckData(userEmail);
        
        try {
          const apiServerTime = await getServerTime();
          if (apiServerTime) {
            const currentDeviceTime = new Date().toISOString();
            await saveServerTime(userEmail, apiServerTime, currentDeviceTime);
            console.log('âœ… Server time synced and saved locally.');
          }
        } catch (timeError) {
          console.error('â Œ Failed to fetch or save server time:', timeError);
          console.log('ðŸ”„ Server time sync failed, falling back to offline mode...');
          const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
          setEnrolledCourses(offlineCourses as EnrolledCourse[]);
          setIsLoadingEnrolledCourses(false);
          setIsRefreshing(false);
          return;
        }

        console.log('âœ… Online: Fetching courses from API.');
        const response = await api.get('/my-courses');
        const courses = response.data.courses || [];
        setEnrolledCourses(courses);

        // Save basic course info to local DB
        for (const course of courses) {
          try {
            await saveCourseToDb(course, userEmail);
          } catch (saveError) {
            console.error('âš ï¸  Failed to save basic course to DB:', saveError);
          }
        }
        console.log('ðŸ“„ Basic course info synced to local DB.');

        // Fetch and save complete course details including materials and assessments
        await fetchAndSaveCompleteCoursesData(courses, userEmail);

        // âœ… Enhanced: Auto-download assessment data with smart logic
        if (courses.length > 0) {
          setSyncStatus('Auto-syncing assessment data...');
          await autoDownloadAssessmentData(userEmail);
        }

      } else {
        console.log('âš ï¸  Offline or no internet reachability: Fetching courses from local DB.');
        const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
        setEnrolledCourses(offlineCourses as EnrolledCourse[]);
      }
    } catch (error: any) {
      console.error('Error fetching enrolled courses:', error.response?.data || error.message);

      const hasRealInternet = netInfo?.isInternetReachable === true;
      if (hasRealInternet) {
        console.log('ðŸ”„ API failed, falling back to local DB...');
        try {
          const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
          setEnrolledCourses(offlineCourses as EnrolledCourse[]);
        } catch (localError) {
          console.error('â Œ Local DB fallback also failed:', localError);
          Alert.alert('Error', 'Failed to load your enrolled courses.');
        }
      } else {
        Alert.alert('Error', 'Failed to load your enrolled courses from local storage.');
      }
    } finally {
      setIsLoadingEnrolledCourses(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, [netInfo?.isInternetReachable, netInfo, isInitialized]);

  useEffect(() => {
    const hasRealInternet = netInfo?.isInternetReachable === true;
    
    if (!hasRealInternet || !isInitialized) return;

    const timeSyncInterval = setInterval(async () => {
      try {
        const userData = await getUserData();
        if (userData && userData.email) {
          await updateTimeSync(userData.email);
          
          const now = Date.now();
          
          const db = await getDb();
          const result = await db.getFirstAsync(
            `SELECT last_time_check FROM app_state WHERE user_email = ?;`,
            [userData.email]
          ) as any;
          
          const lastSync = result?.last_time_check;
          if (!lastSync || (now - lastSync) > 600000) {
            try {
              const apiServerTime = await getServerTime();
              if (apiServerTime) {
                await saveServerTime(userData.email, apiServerTime, new Date().toISOString());
              }
            } catch (timeError) {
              console.error('âš ï¸  Periodic server time sync failed:', timeError);
            }
          }
        }
      } catch (error) {
        console.error('â Œ Periodic time sync error:', error);
      }
    }, 60000);

    return () => clearInterval(timeSyncInterval);
  }, [netInfo?.isInternetReachable, isInitialized]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setSyncStatus('Starting refresh...');

    if (!netInfo?.isInternetReachable) {
      Alert.alert(
        'Offline',
        'Please check your internet connection to refresh data.',
        [{ text: 'OK' }]
      );
      setIsRefreshing(false);
      setSyncStatus('');
      return;
    }

    try {
      const userData = await getUserData();
      if (!userData?.email) {
        Alert.alert('Error', 'User data not found. Please log in again.');
        setIsRefreshing(false);
        setSyncStatus('');
        return;
      }

      console.log('ðŸ”„ Starting enhanced refresh with incremental updates...');
      setSyncStatus('Fetching course updates...');
      
      let refreshSuccessful = false;
      try {
        // Use retry logic for API calls
        const response = await retryWithBackoff(async () => {
          setSyncStatus('Connecting to server...');
          return await api.get('/my-courses');
        }, 3, 1000);
        
        const courses = response.data.courses || [];
        
        // Check if course data has actually changed
        const hasChanges = JSON.stringify(courses) !== JSON.stringify(enrolledCourses);
        
        if (hasChanges) {
          setSyncStatus('Updating course data...');
          setEnrolledCourses(courses);
          
          // Chunked processing for better performance
          const chunkSize = 3;
          for (let i = 0; i < courses.length; i += chunkSize) {
            const chunk = courses.slice(i, i + chunkSize);
            setSyncStatus(`Saving courses ${i + 1}-${Math.min(i + chunkSize, courses.length)} of ${courses.length}`);
            
            await Promise.all(chunk.map(async (course) => {
              try {
                await saveCourseToDb(course, userData.email);
              } catch (saveError) {
                console.error('Failed to save course to DB:', saveError);
              }
            }));
            
            // Small delay to prevent overwhelming the system
            if (i + chunkSize < courses.length) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          
          setSyncStatus('Updating course details...');
          await fetchAndSaveCompleteCoursesData(courses, userData.email);
        } else {
          setSyncStatus('No course changes detected');
        }
        
        // Force refresh assessment data
        setSyncStatus('Syncing assessment data...');
        const syncResult = await autoDownloadAssessmentData(userData.email, true);
        refreshSuccessful = syncResult.success;
        
        if (refreshSuccessful) {
          setSyncStatus('âœ… Refresh completed successfully');
          console.log('âœ… Enhanced refresh completed successfully');
        }
        
      } catch (downloadError) {
        console.warn('âš ï¸  Refresh failed, keeping existing offline data:', downloadError);
        setSyncStatus('âš ï¸  Refresh failed, using offline data');
        // Fallback to existing data
        try {
          await fetchCourses();
        } catch (fallbackError) {
          console.error('â Œ Fallback fetch also failed:', fallbackError);
        }
      }

      const message = refreshSuccessful 
        ? 'Your course list has been updated successfully!' 
        : 'Refresh completed with some limitations. Offline data preserved.';
        
      Alert.alert('Refresh Complete', message, [{ text: 'OK' }]);

    } catch (error) {
      console.error('â Œ Enhanced refresh failed:', error);
      setSyncStatus('â Œ Refresh failed');
      Alert.alert('Error', 'Failed to refresh data. Please try again.');
    } finally {
      setIsRefreshing(false);
      // Clear status after delay
      setTimeout(() => setSyncStatus(''), 3000);
    }
  };

  const handleSearchPress = () => {
    setSearchModalVisible(true);
    setSearchResults([]);
    setSearchQuery('');
    setHasSearched(false);
  };

  const handleSearchSubmit = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline', 'You must be connected to the internet to search for courses.');
      return;
    }

    setIsLoadingSearch(true);
    setHasSearched(true);
    try {
      const response = await api.get(`/courses/search?query=${encodeURIComponent(searchQuery)}`);
      setSearchResults(response.data.courses || []);
      console.log('Search Results:', response.data.courses);
    } catch (error: any) {
      console.error('Error searching courses:', error);
      Alert.alert('Search Error', 'Failed to fetch search results. Please try again.');
      setSearchResults([]);
    } finally {
      setIsLoadingSearch(false);
    }
  };

  // NEW: Function to initiate enrollment process
  const startEnrollment = (course: Course) => {
    setCourseToEnroll(course);
    setEnrollmentCode('');
    setIsEnrollModalVisible(true);
  };
  
  // NEW: Function to handle the final enrollment submission
  const confirmEnrollment = async () => {
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline', 'You must be connected to the internet to enroll in a course.');
      return;
    }

    if (!courseToEnroll || !enrollmentCode.trim()) {
      Alert.alert('Error', 'Enrollment key is required.');
      return;
    }
    
    setIsEnrolling(true);

    let userEmail = '';
    try {
      const userData = await getUserData();
      if (userData && userData.email) {
        userEmail = userData.email;
      } else {
        Alert.alert('Error', 'User data not found. Please log in again.');
        router.replace('/login');
        setIsEnrolling(false);
        return;
      }
    } catch (error) {
      console.error('â Œ Error getting user data:', error);
      Alert.alert('Error', 'User data not found. Please log in again.');
      router.replace('/login');
      setIsEnrolling(false);
      return;
    }

    try {
      // Pass both course_id and course_code to the API
      const response = await api.post('/enroll', { 
        course_id: courseToEnroll.id, 
        course_code: enrollmentCode.trim() 
      });
      Alert.alert('Success', response.data.message || `Successfully enrolled in ${courseToEnroll.title}`);

      try {
        await saveCourseToDb(courseToEnroll, userEmail);
        const courseDetailResponse = await api.get(`/courses/${courseToEnroll.id}`);
        if (courseDetailResponse.status === 200) {
          await saveCourseDetailsToDb(courseDetailResponse.data.course, userEmail);
        }
      } catch (saveError) {
        console.error('âš ï¸  Failed to save enrolled course to local DB:', saveError);
      }

      setIsEnrollModalVisible(false);
      setSearchModalVisible(false);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);

      try {
        setIsLoadingEnrolledCourses(true);
        const updatedEnrolledCoursesResponse = await api.get('/my-courses');
        const updatedCourses = updatedEnrolledCoursesResponse.data.courses || [];
        setEnrolledCourses(updatedCourses);

        await fetchAndSaveCompleteCoursesData(updatedCourses, userEmail);
        // Auto-download assessment data for newly enrolled course
        await autoDownloadAssessmentData(userEmail);

      } catch (refreshError) {
        console.error('Error refreshing enrolled courses after enrollment:', refreshError);
        try {
          const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
          setEnrolledCourses(offlineCourses as EnrolledCourse[]);
        } catch (localError) {
          console.error('â Œ Local DB fallback failed:', localError);
        }
      } finally {
        setIsLoadingEnrolledCourses(false);
      }
    } catch (error: any) {
      console.error('Enrollment error:', error.response?.data || error.message);
      Alert.alert('Enrollment Failed', 'Invalid enrollment key');
    } finally {
      setIsEnrolling(false);
    }
  };

  const renderCourseItem = ({ item }: { item: Course }) => (
    <View style={styles.courseResultCard}>
      <Text style={styles.courseResultTitle}>{item.title}</Text>
      <Text style={styles.courseResultCode}>Description: {item.description}</Text>
      <Text style={styles.courseResultDetails}>Program: {item.program?.name || 'N/A'}</Text>
      <Text style={styles.courseResultDetails}>Instructor: {item.instructor?.name || 'N/A'}</Text>

      <TouchableOpacity
        style={[
          styles.enrollButton,
          !netInfo?.isInternetReachable && styles.disabledButton
        ]}
        onPress={() => startEnrollment(item)}
        disabled={!netInfo?.isInternetReachable}
      >
        <Text style={styles.enrollButtonText}>Enroll Course</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEnrolledCourseCard = ({ item }: { item: EnrolledCourse }) => (
    <TouchableOpacity
      style={styles.enrolledCourseCard}
      onPress={() => {
        console.log('Viewing enrolled course:', item.title);
        router.navigate({
          pathname: '/courses',
          params: { courseId: item.id.toString() },
        });
      }}
      activeOpacity={0.7}
    >
      <View style={styles.enrolledCourseCardHeader}>
        <Ionicons name="book-outline" size={28} color="#1967d2" />
      </View>
      <View style={styles.enrolledCourseCardBody}>
        <Text style={styles.enrolledCourseCardTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.enrolledCourseCardCode} numberOfLines={1}>{item.course_code}</Text>
        {item.pivot && (
          <View style={styles.statusBadge}>
            <Text style={styles.enrolledCourseCardStatus}>{item.pivot.status}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const scrollEnrolledCoursesRight = () => {
    if (enrolledCoursesFlatListRef.current) {
      enrolledCoursesFlatListRef.current.scrollToEnd({ animated: true });
    }
  };

  const scrollEnrolledCoursesLeft = () => {
    if (enrolledCoursesFlatListRef.current) {
      enrolledCoursesFlatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  };

  const toggleAd = () => {
    setIsAdVisible(!isAdVisible);
  };

  const handleAdButtonPress = async () => {
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline Mode', 'You must be online to download assessment details.');
      return;
    }

    try {
      const userData = await getUserData();
      if (!userData?.email) {
        Alert.alert('Error', 'User data not found. Please log in again.');
        return;
      }

      setSyncStatus('Checking assessment data...');

      // Enhanced: Use retry logic for initial checks
      const syncNeeded = await retryWithBackoff(async () => {
        return await getAssessmentsNeedingSync(userData.email, api);
      }, 2, 1000);

      const totalToSync = syncNeeded.missing.length + syncNeeded.outdated.length;
      
      if (totalToSync === 0) {
        setSyncStatus('All data is up to date');
        Alert.alert('Information', 
          `All assessment data is current!\n\nðŸ“Š Last sync: ${lastSyncTime ? new Date(lastSyncTime).toLocaleString() : 'Never'}\n\nðŸ”’ Your offline data is ready for use.`, 
          [{ text: 'OK', onPress: toggleAd }]
        );
        setTimeout(() => setSyncStatus(''), 2000);
        return;
      }
      
      // Enhanced dialog with data freshness info
      Alert.alert(
        'Enhanced Smart Download',
        `Analysis Complete:\nâ€¢ ${syncNeeded.missing.length} new assessments\nâ€¢ ${syncNeeded.outdated.length} updates available\n\nðŸ’¡ Features:\nâœ… Preserves existing offline data\nâœ… Chunked download for performance\nâœ… Automatic retry on failures\n\nProceed with smart download?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setSyncStatus('') },
          {
            text: 'Smart Download',
            onPress: async () => {
              setIsDownloadingData(true);
              setDownloadProgress({ current: 0, total: totalToSync });
              setSyncStatus('Starting enhanced download...');

              try {
                // Enhanced: Use the improved autoDownloadAssessmentData function
                const result = await autoDownloadAssessmentData(userData.email, true);

                if (result.success) {
                  const now = new Date().toISOString();
                  setLastSyncTime(now);
                  
                  let message = 'ðŸŽ‰ Enhanced Download Complete!\n\n';
                  
                  if (result.downloaded > 0) {
                    message += `Successfully processed ${result.downloaded} items\n`;
                  }
                  
                  if (result.failed > 0) {
                    message += `${result.failed} items failed (data preserved)\n`;
                  }

                  message += `\nLast sync: ${new Date(now).toLocaleString()}`;
                  message += '\nAll offline data preserved and optimized!';

                  Alert.alert('Success', message, [{ text: 'OK', onPress: toggleAd }]);

                  // Update assessment count
                  const remainingAssessments = await getAssessmentsWithoutDetails(userData.email);
                  setAssessmentsNeedingDetails(remainingAssessments.length);
                } else {
                  throw new Error('Download operation failed');
                }

              } catch (error) {
                console.error('Enhanced download failed:', error);
                setSyncStatus('Download failed - data preserved');
                Alert.alert(
                  'Download Error',
                  'â Œ Enhanced download encountered issues.\n\nðŸ”’ Your existing offline data is preserved and safe.\n\nðŸ’¡ Try again when network is stable.',
                  [{ text: 'OK' }]
                );
              } finally {
                setIsDownloadingData(false);
                setDownloadProgress({ current: 0, total: 0 });
                setTimeout(() => setSyncStatus(''), 3000);
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error in enhanced handleAdButtonPress:', error);
      setSyncStatus('Error occurred');
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
      setTimeout(() => setSyncStatus(''), 3000);
    }
  };

  if (!isInitialized) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#1967d2" />
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#667eea"
            colors={['#667eea', '#764ba2']}
            enabled={netInfo?.isInternetReachable ?? false}
          />
        }
      >
        {/* LMS-Style Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Text style={styles.welcomeText}>Welcome</Text>
            <Text style={styles.userNameText}>{userName}</Text>
            <Text style={styles.subText}>Ready to continue your learning journey?</Text>
            
            {!netInfo?.isInternetReachable && (
              <View style={styles.offlineNotice}>
                <Ionicons name="cloud-offline-outline" size={16} color="#5f6368" />
                <Text style={styles.offlineText}>Offline Mode</Text>
              </View>
            )}

            {!netInfo?.isInternetReachable && (
              <TouchableOpacity 
                style={styles.offlineGuideButton} 
                onPress={() => showOfflineModeGuide()}
                activeOpacity={0.7}
              >
                <Ionicons name="information-circle" size={20} color="#1967d2" />
                <Text style={styles.offlineGuideButtonText}>View Offline Mode Guide</Text>
              </TouchableOpacity>
            )}

            {offlineStatus && !netInfo?.isInternetReachable && (
              <View style={styles.offlineTimerContainer}>
                <Text style={styles.offlineTimerText}>
                  Offline Time: {formatRemainingTime(offlineStatus.remainingHours)} left
                </Text>
                <View style={styles.progressBarBackground}>
                  <View
                    style={[
                      styles.progressBarForeground,
                      { width: `${(offlineStatus.remainingHours / offlineStatus.totalHours) * 100}%` },
                    ]}
                  />
                </View>
              </View>
            )}
            
            {syncStatus && (
              <View style={styles.downloadIndicator}>
                <ActivityIndicator size="small" color="#1967d2" />
                <Text style={styles.downloadText}>{syncStatus}</Text>
              </View>
            )}

          </View>
        </View>

        {/* LMS-Style Search Button */}
        <TouchableOpacity
          style={[
            styles.searchButton,
            !netInfo?.isInternetReachable && styles.disabledButton
          ]}
          onPress={handleSearchPress}
          disabled={!netInfo?.isInternetReachable}
        >
          <Ionicons name="search" size={20} color="#fff" style={styles.searchIcon} />
          <Text style={styles.searchButtonText}>Discover new courses</Text>
        </TouchableOpacity>

        {/* Enhanced Stats Section */}
        <View style={styles.statsSection}>
          <View style={styles.statCard}>
            <Ionicons name="book" size={24} color="#667eea" />
            <Text style={styles.statNumber}>{enrolledCourses.length}</Text>
            <Text style={styles.statLabel}>Enrolled Courses</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="download" size={24} color="#4facfe" />
            <Text style={styles.statNumber}>{assessmentsNeedingDetails}</Text>
            <Text style={styles.statLabel}>Pending Downloads</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name={netInfo?.isInternetReachable ? "wifi" : "wifi-outline"} size={24} color={netInfo?.isInternetReachable ? "#10ac84" : "#ff6b6b"} />
            <Text style={styles.statLabel}>{netInfo?.isInternetReachable ? "Online" : "Offline"}</Text>
          </View>
        </View>

        {/* LMS-Style Download Section */}
        <View style={styles.adContainer}>
          {isAdVisible && (
            <View style={styles.adContent}>
              <View style={styles.adButtonContainer}>
                {/* The Update Button */}
                <TouchableOpacity
                  style={[
                    styles.adButton,
                    (isRefreshing || isDownloadingData) && styles.adButtonDownloading,
                    !netInfo?.isInternetReachable && styles.disabledButton,
                    styles.flex1
                  ]}
                  onPress={handleRefresh}
                  disabled={isRefreshing || isDownloadingData || !netInfo?.isInternetReachable}
                >
                  {isRefreshing ? (
                    <View style={styles.downloadProgressContainer}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.adButtonText}>Updating...</Text>
                    </View>
                  ) : (
                    <View style={styles.adButtonInnerContainer}>
                      <Ionicons name="sync-circle" size={20} color="#fff" />
                      <Text style={styles.adButtonText}>Update All</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
          <TouchableOpacity style={styles.adToggle} onPress={toggleAd}>
            <Ionicons
              name={isAdVisible ? 'chevron-up' : 'chevron-down'}
              size={24}
              color="#1967d2"
            />
          </TouchableOpacity>
        </View>

        {/* Enhanced Courses Section */}
        <View style={styles.coursesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Courses</Text>
          </View>
          
          {isLoadingEnrolledCourses ? (
            <View style={styles.loadingCoursesContainer}>
              <ActivityIndicator size="large" color="#667eea" />
              <Text style={styles.loadingCoursesText}>Loading your courses...</Text>
            </View>
          ) : enrolledCourses.length > 0 ? (
            <FlatList
              ref={enrolledCoursesFlatListRef}
              data={enrolledCourses}
              keyExtractor={(item) => item.id.toString()}
              renderItem={renderEnrolledCourseCard}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalFlatListContent}
            />
          ) : (
            <View style={styles.noCoursesContainer}>
              <Ionicons name="school-outline" size={64} color="#ccc" />
              <Text style={styles.noCoursesText}>No courses enrolled yet</Text>
              <Text style={styles.noCoursesSubText}>
                {netInfo?.isInternetReachable
                  ? 'Search for courses above to get started!'
                  : 'Connect to the internet to enroll in new courses.'
                }
              </Text>
            </View>
          )}
        </View>

        <Modal
          animationType="slide"
          transparent={true}
          visible={isSearchModalVisible}
          onRequestClose={() => {
            setSearchModalVisible(false);
            setHasSearched(false);
            setSearchQuery('');
            setSearchResults([]);
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <TouchableOpacity onPress={() => {
                setSearchModalVisible(false);
                setHasSearched(false);
                setSearchQuery('');
                setSearchResults([]);
              }} style={styles.closeButton}>
                <Ionicons name="close-circle-outline" size={30} color="#6c757d" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Search Courses</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Enter course title"
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearchSubmit}
                returnKeyType="search"
                editable={netInfo?.isInternetReachable ?? false}
              />
              <TouchableOpacity
                style={[
                  styles.modalSearchButton,
                  !netInfo?.isInternetReachable && styles.disabledButton
                ]}
                onPress={handleSearchSubmit}
                disabled={isLoadingSearch || !netInfo?.isInternetReachable}
              >
                {isLoadingSearch ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalSearchButtonText}>Search</Text>
                )}
              </TouchableOpacity>
              {!netInfo?.isInternetReachable && (
                <Text style={styles.offlineModalHint}>
                  You must be online to search for new courses.
                </Text>
              )}

              {/* Loading State */}
              {isLoadingSearch && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#667eea" />
                  <Text style={styles.loadingText}>Searching...</Text>
                </View>
              )}

              {/* Search Results - Only show after search is complete */}
              {!isLoadingSearch && hasSearched && (
                <View style={styles.searchResultsContainer}>
                  {searchResults.length > 0 ? (
                    <ScrollView style={{maxHeight: height * 0.45}} contentContainerStyle={styles.flatListContent}>
                      <Text style={styles.searchResultsTitle}>Matching Courses ({searchResults.length}):</Text>
                      {searchResults.map((item) => (
                        <View key={item.id.toString()}>{renderCourseItem({item})}</View>
                      ))}
                    </ScrollView>
                  ) : (
                    <View style={styles.noResultsContainer}>
                      <Ionicons name="search-outline" size={48} color="#ccc" />
                      <Text style={styles.noResultsText}>No courses found for "{searchQuery}"</Text>
                      <Text style={[styles.noResultsText, { fontSize: 12, marginTop: 8 }]}>
                        Try searching with a different course title or code
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* NEW: Enrollment Confirmation Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={isEnrollModalVisible}
          onRequestClose={() => setIsEnrollModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.enrollmentModalContent}>
              <Text style={styles.modalTitle}>Confirm Enrollment</Text>
              {courseToEnroll && (
                <>
                  <Text style={styles.enrollmentText}>
                    To enroll in **{courseToEnroll.title}**, please enter the Enrollment Key.
                  </Text>
                </>
              )}
              <TextInput
                style={styles.searchInput}
                placeholder="Enter enrollment key"
                value={enrollmentCode}
                onChangeText={setEnrollmentCode}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[
                  styles.modalSearchButton,
                  isEnrolling && styles.disabledButton
                ]}
                onPress={confirmEnrollment}
                disabled={isEnrolling}
              >
                {isEnrolling ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalSearchButtonText}>Confirm</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setIsEnrollModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#5f6368',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: '#fff',
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerContent: {
    gap: 8,
  },
  welcomeText: {
    fontSize: 14,
    color: '#5f6368',
  },
  userNameText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#202124',
  },
  subText: {
    fontSize: 14,
    color: '#5f6368',
    marginTop: 4,
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f1f3f4',
    borderRadius: 16,
    marginTop: 12,
  },
  offlineText: {
    fontSize: 12,
    color: '#5f6368',
    marginLeft: 6,
    fontWeight: '500',
  },
  offlineGuideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#e8f0fe',
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#1967d2',
  },
  offlineGuideButtonText: {
    fontSize: 13,
    color: '#1967d2',
    marginLeft: 6,
    fontWeight: '600',
  },
  offlineTimerContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#fef7e0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fce8b2',
  },
  offlineTimerText: {
    fontSize: 13,
    color: '#b7791f',
    marginBottom: 8,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: '#fce8b2',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarForeground: {
    height: '100%',
    backgroundColor: '#e37400',
    borderRadius: 3,
  },
  downloadIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 12,
    backgroundColor: '#e8f0fe',
    borderRadius: 8,
  },
  downloadText: {
    fontSize: 13,
    color: '#1967d2',
    marginLeft: 8,
  },
  searchButton: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: '#1967d2',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  disabledButton: {
    opacity: 0.5,
    backgroundColor: '#dadce0',
  },
  statsSection: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '600',
    color: '#202124',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#5f6368',
    marginTop: 4,
    textAlign: 'center',
  },
  adContainer: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  adContent: {
    padding: 12,
  },
  adButtonContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  adButton: {
    flex: 1,
    backgroundColor: '#137333',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adButtonDownloading: {
    backgroundColor: '#5f6368',
  },
  flex1: {
    flex: 1,
  },
  downloadProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adButtonInnerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  adToggle: {
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  coursesSection: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: '#202124',
  },
  loadingCoursesContainer: {
    padding: 32,
    alignItems: 'center',
  },
  loadingCoursesText: {
    marginTop: 16,
    fontSize: 14,
    color: '#5f6368',
  },
  horizontalFlatListContent: {
    paddingRight: 16,
  },
  enrolledCourseCard: {
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  enrolledCourseCardHeader: {
    height: 100,
    backgroundColor: '#1967d2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  enrolledCourseCardBody: {
    padding: 12,
  },
  enrolledCourseCardTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#202124',
    marginBottom: 4,
    minHeight: 40,
  },
  enrolledCourseCardCode: {
    fontSize: 12,
    color: '#5f6368',
    marginBottom: 8,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginTop: 4,
  },
  enrolledCourseCardStatus: {
    fontSize: 11,
    color: '#1967d2',
    fontWeight: '500',
  },
  noCoursesContainer: {
    padding: 48,
    alignItems: 'center',
  },
  noCoursesText: {
    fontSize: 18,
    fontWeight: '400',
    color: '#5f6368',
    marginTop: 16,
  },
  noCoursesSubText: {
    fontSize: 14,
    color: '#80868b',
    textAlign: 'center',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: width * 0.9,
    maxHeight: height * 0.8,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 20,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: '#f8f9fa',
  },
  modalSearchButton: {
    backgroundColor: '#1967d2',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  modalSearchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  offlineModalHint: {
    fontSize: 13,
    color: '#d93025',
    textAlign: 'center',
    marginTop: 8,
  },
  searchResultsContainer: {
    marginTop: 16,
    minHeight: 100,
  },
  searchResultsTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#202124',
    marginBottom: 12,
  },
  flatListContent: {
    paddingBottom: 16,
  },
  courseResultCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  courseResultTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: '#202124',
    marginBottom: 8,
  },
  courseResultCode: {
    fontSize: 14,
    color: '#5f6368',
    marginBottom: 4,
  },
  courseResultDetails: {
    fontSize: 13,
    color: '#5f6368',
    marginTop: 4,
  },
  enrollButton: {
    backgroundColor: '#1967d2',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  enrollButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  noResultsContainer: {
    padding: 32,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    color: '#5f6368',
    textAlign: 'center',
  },
  enrollmentModalContent: {
    width: width * 0.85,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  enrollmentText: {
    fontSize: 14,
    color: '#5f6368',
    marginBottom: 16,
    lineHeight: 20,
  },
  cancelButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    color: '#5f6368',
    fontSize: 14,
    fontWeight: '500',
  },
});