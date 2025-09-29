import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../context/NetworkContext';
import api, { clearAuthToken, getAuthToken, getServerTime, getUserData, syncOfflineQuiz, syncOfflineSubmission } from '../../lib/api';
import {
  deleteAllAssessmentDetails,
  deleteOfflineQuizAttempt,
  deleteOfflineSubmission,
  downloadAllAssessmentDetails,
  downloadAllQuizQuestions,
  fixQuizQuestionsTable,
  getAssessmentsWithoutDetails,
  getCompletedOfflineQuizzes,
  getDb,
  getEnrolledCoursesFromDb,
  getUnsyncedSubmissions,
  hasAssessmentDetailsSaved,
  hasQuizQuestionsSaved,
  initDb,
  resetTimeCheckData,
  saveCourseDetailsToDb,
  saveCourseToDb,
  saveServerTime,
  updateTimeSync
} from '../../lib/localDb';
import { showOfflineModeWarningIfNeeded } from '../../lib/offlineWarning';
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
  const adHeight = useRef(new Animated.Value(0)).current;
  const {isConnected, netInfo } = useNetworkStatus();
  const enrolledCoursesFlatListRef = useRef<FlatList<EnrolledCourse>>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // NEW: State for enrollment modal
  const [isEnrollModalVisible, setIsEnrollModalVisible] = useState<boolean>(false);
  const [courseToEnroll, setCourseToEnroll] = useState<Course | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState<string>('');
  const [isEnrolling, setIsEnrolling] = useState<boolean>(false);


  useEffect(() => {
  let isMounted = true;
  const initialize = async () => {
    try {
      console.log('🔧 Initializing home screen...');
      
      // Add retry logic for initialization
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries && isMounted) {
        try {
          await initDb();
          console.log('✅ Home screen database initialized');
          if (isMounted) {
            setIsInitialized(true);
            // Start entrance animation
            Animated.parallel([
              Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 1000,
                useNativeDriver: true,
              }),
              Animated.timing(slideAnim, {
                toValue: 0,
                duration: 800,
                useNativeDriver: true,
              }),
            ]).start();
          }
          break; // Success, exit retry loop
        } catch (initError) {
          retryCount++;
          console.error(`❌ Home screen initialization error (attempt ${retryCount}):`, initError);
          
          if (retryCount < maxRetries) {
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          } else {
            throw initError;
          }
        }
      }
    } catch (error) {
      console.error('❌ Final home screen initialization error:', error);
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

  // Auto-download assessment data after courses are loaded
  const autoDownloadAssessmentData = async (userEmail: string) => {
    if (!netInfo?.isInternetReachable) {
      console.log('⚠️ No internet connection for auto-download');
      return;
    }

    try {
      console.log('🔄 Starting automatic assessment data download...');
      
      // Get assessments that need details
      const assessmentIds = await getAssessmentsWithoutDetails(userEmail);
      
      // Get quiz assessments that need questions
      const db = await getDb();
      const quizAssessments = await db.getAllAsync(
        `SELECT id FROM offline_assessments 
         WHERE user_email = ? AND (type = 'quiz' OR type = 'exam');`,
        [userEmail]
      );
      
      // Count how many items actually need downloading
      let assessmentsNeedingDownload = 0;
      let quizzesNeedingDownload = 0;

      for (const id of assessmentIds) {
        const hasDetails = await hasAssessmentDetailsSaved(id, userEmail);
        if (!hasDetails) assessmentsNeedingDownload++;
      }

      for (const quiz of quizAssessments) {
        const hasQuestions = await hasQuizQuestionsSaved(quiz.id, userEmail);
        if (!hasQuestions) quizzesNeedingDownload++;
      }

      const totalItemsToDownload = assessmentsNeedingDownload + quizzesNeedingDownload;
      
      if (totalItemsToDownload === 0) {
        console.log('✅ All assessment data already downloaded');
        return;
      }

      console.log(`📦 Auto-downloading ${totalItemsToDownload} assessment items...`);
      setIsDownloadingData(true);
      setDownloadProgress({ current: 0, total: totalItemsToDownload });

      let assessmentResult = { success: 0, failed: 0, skipped: 0 };
      let quizResult = { success: 0, failed: 0, skipped: 0 };

      // Download assessment details
      if (assessmentIds.length > 0) {
        assessmentResult = await downloadAllAssessmentDetails(
          userEmail,
          api,
          (current, total, skipped = 0) => {
            setDownloadProgress({ current, total: totalItemsToDownload });
          }
        );
      }

      // Download quiz questions
      if (quizAssessments.length > 0) {
        try {
          await fixQuizQuestionsTable();
        } catch (error) {
          console.error('Failed to fix quiz questions table:', error);
        }

        quizResult = await downloadAllQuizQuestions(
          userEmail,
          api,
          (current, total, skipped = 0) => {
            const totalProgress = assessmentIds.length + current;
            setDownloadProgress({ current: totalProgress, total: totalItemsToDownload });
          }
        );
      }

      // Update assessment count
      const remainingAssessments = await getAssessmentsWithoutDetails(userEmail);
      setAssessmentsNeedingDetails(remainingAssessments.length);

      console.log(`✅ Auto-download completed: ${assessmentResult.success + quizResult.success} items downloaded`);
      
    } catch (error) {
      console.error('❌ Auto-download failed:', error);
    } finally {
      setIsDownloadingData(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

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
    console.log('📦 Starting to fetch complete course data for offline access...');

    for (const course of courses) {
      try {
        console.log(`🔄 Fetching detailed data for course: ${course.title} (ID: ${course.id})`);
        
        const courseId = typeof course.id === 'string' ? parseInt(course.id, 10) : course.id;
        
        if (!courseId || isNaN(courseId) || courseId <= 0) {
          console.error('❌ Invalid course ID detected:', {
            originalId: course.id,
            convertedId: courseId,
            courseTitle: course.title
          });
          continue;
        }
        
        console.log(`📋 Processing course with validated ID: ${courseId} (type: ${typeof courseId})`);

        const courseDetailResponse = await api.get(`/courses/${courseId}`);
        
        if (courseDetailResponse.status === 200) {
          const detailedCourse = courseDetailResponse.data.course;
          
          if (!detailedCourse.id) {
            detailedCourse.id = courseId;
          }
          
          console.log(`📊 Fetched detailed data for course ${courseId}:`, {
            topics: detailedCourse.topics?.length || 0,
            assessments: detailedCourse.assessments?.length || 0,
            materials: detailedCourse.materials?.length || 0
          });
          
          await saveCourseDetailsToDb(detailedCourse, userEmail);
          console.log(`✅ Successfully saved detailed data for course: ${detailedCourse.title}`);
        } else {
          console.warn(`⚠️ Failed to fetch detailed data for course ${courseId}: Status ${courseDetailResponse.status}`);
        }
      } catch (saveError: any) {
        console.error(`❌ Failed to fetch/save complete data for course ${course.title}:`, saveError.message || saveError);
      }
    }
    console.log('✅ Completed fetching and saving all course data for offline access');
  };

  const fetchCourses = async () => {
    if (!isInitialized || netInfo === null) return;

    let userEmail = '';
    try {
      const userData = await getUserData();
      if (userData && userData.name && userData.email) {
        setUserName(userData.name);
        userEmail = userData.email;
      } else {
        console.warn('User data or name not found in local storage. Redirecting to login.');
        await clearAuthToken();
        router.replace('/login');
        return;
      }
    } catch (error) {
      console.error('❌ Error getting user data:', error);
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
            console.log('✅ Server time synced and saved locally.');
          }
        } catch (timeError) {
          console.error('❌ Failed to fetch or save server time:', timeError);
          console.log('🔄 Server time sync failed, falling back to offline mode...');
          const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
          setEnrolledCourses(offlineCourses as EnrolledCourse[]);
          setIsLoadingEnrolledCourses(false);
          setIsRefreshing(false);
          return;
        }

        console.log('✅ Online: Fetching courses from API.');
        const response = await api.get('/my-courses');
        const courses = response.data.courses || [];
        setEnrolledCourses(courses);

        // Save basic course info to local DB
        for (const course of courses) {
          try {
            await saveCourseToDb(course, userEmail);
          } catch (saveError) {
            console.error('⚠️ Failed to save basic course to DB:', saveError);
          }
        }
        console.log('📄 Basic course info synced to local DB.');

        // Fetch and save complete course details including materials and assessments
        await fetchAndSaveCompleteCoursesData(courses, userEmail);

        // ✅ NEW: Auto-download assessment data after courses are loaded
        await autoDownloadAssessmentData(userEmail);

      } else {
        console.log('⚠️ Offline or no internet reachability: Fetching courses from local DB.');
        const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
        setEnrolledCourses(offlineCourses as EnrolledCourse[]);
      }
    } catch (error: any) {
      console.error('Error fetching enrolled courses:', error.response?.data || error.message);

      const hasRealInternet = netInfo?.isInternetReachable === true;
      if (hasRealInternet) {
        console.log('🔄 API failed, falling back to local DB...');
        try {
          const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
          setEnrolledCourses(offlineCourses as EnrolledCourse[]);
        } catch (localError) {
          console.error('❌ Local DB fallback also failed:', localError);
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
              console.error('⚠️ Periodic server time sync failed:', timeError);
            }
          }
        }
      } catch (error) {
        console.error('❌ Periodic time sync error:', error);
      }
    }, 60000);

    return () => clearInterval(timeSyncInterval);
  }, [netInfo?.isInternetReachable, isInitialized]);

  const handleRefresh = async () => {
    setIsRefreshing(true);

    if (!netInfo?.isInternetReachable) {
      Alert.alert(
        'Offline',
        'Please check your internet connection to refresh data.',
        [{ text: 'OK' }]
      );
      setIsRefreshing(false);
      return;
    }

    try {
      const userData = await getUserData();
      if (!userData?.email) {
        Alert.alert('Error', 'User data not found. Please log in again.');
        setIsRefreshing(false);
        return;
      }

      console.log('Fetching fresh course data from API...');
      // Remove these lines to prevent deletion of offline data and re-download
      // await deleteAllAssessmentDetails(userData.email);
      // await resetTimeCheckData(userData.email);

      const response = await api.get('/my-courses');
      const courses = response.data.courses || [];

      await deleteAllAssessmentDetails(userData.email);
      await resetTimeCheckData(userData.email);
      await fetchCourses();
      await fetchAndSaveCompleteCoursesData(courses, userData.email);
      setEnrolledCourses(courses);

      for (const course of courses) {
        try {
          await saveCourseToDb(course, userData.email);
        } catch (saveError) {
          console.error('Failed to save basic course to DB:', saveError);
        }
      }

      // Remove the auto-download call from here
      // await autoDownloadAssessmentData(userData.email);

      Alert.alert('Refresh Complete', 'Your course list has been updated!', [{ text: 'OK' }]);

    } catch (error) {
      console.error('Refresh failed:', error);
      Alert.alert('Error', 'Failed to refresh data. Please try again.');
    } finally {
      setIsRefreshing(false);
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
      console.error('❌ Error getting user data:', error);
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
        console.error('⚠️ Failed to save enrolled course to local DB:', saveError);
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
          console.error('❌ Local DB fallback failed:', localError);
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
    >
      <LinearGradient
        colors={['#02135eff', '#7979f1ff']}
        style={styles.courseCardGradient}
      >
        <Ionicons name="book-outline" size={32} color="#fff" />
        <Text style={styles.enrolledCourseCardTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.enrolledCourseCardCode} numberOfLines={1}>{item.course_code}</Text>
        {item.pivot && (
          <View style={styles.statusBadge}>
            <Text style={styles.enrolledCourseCardStatus}>{item.pivot.status}</Text>
          </View>
        )}
      </LinearGradient>
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
    Animated.timing(adHeight, {
      toValue: isAdVisible ? 0 : adContentHeight,
      duration: 300,
      useNativeDriver: false,
    }).start();
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

      const assessmentIds = await getAssessmentsWithoutDetails(userData.email);
      
      const db = await getDb();
      const quizAssessments = await db.getAllAsync(
        `SELECT id FROM offline_assessments 
         WHERE user_email = ? AND (type = 'quiz' OR type = 'exam');`,
        [userData.email]
      );
      
      let assessmentsNeedingDownload = 0;
      let quizzesNeedingDownload = 0;

      for (const id of assessmentIds) {
        const hasDetails = await hasAssessmentDetailsSaved(id, userData.email);
        if (!hasDetails) assessmentsNeedingDownload++;
      }

      for (const quiz of quizAssessments) {
        const hasQuestions = await hasQuizQuestionsSaved(quiz.id, userData.email);
        if (!hasQuestions) quizzesNeedingDownload++;
      }
      
      if (assessmentsNeedingDownload === 0 && quizzesNeedingDownload === 0) {
        Alert.alert(
          'Already Up to Date', 
          'All assessment details and quiz questions are already downloaded for offline use.',
          [{ text: 'OK', onPress: toggleAd }]
        );
        return;
      }

      const totalItems = assessmentIds.length + quizAssessments.length;
      Alert.alert(
        'Download Assessment Data',
        `Found ${assessmentsNeedingDownload} assessments needing details and ${quizzesNeedingDownload} quiz/exam assessments needing questions.\n\nThis will download:\n• Assessment attempts & submissions\n• Quiz/exam questions\n\nAlready downloaded items will be skipped. Proceed?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Download',
            onPress: async () => {
              setIsDownloadingData(true);
              setDownloadProgress({ current: 0, total: totalItems });

              try {
                let currentProgress = 0;
                let assessmentResult = { success: 0, failed: 0, skipped: 0 };
                let quizResult = { success: 0, failed: 0, skipped: 0 };

                if (assessmentIds.length > 0) {
                  assessmentResult = await downloadAllAssessmentDetails(
                    userData.email,
                    api,
                    (current, total, skipped = 0) => {
                      setDownloadProgress({ current: currentProgress + current, total: totalItems });
                    }
                  );
                  currentProgress += assessmentIds.length;
                }

                if (quizAssessments.length > 0) {
                  try {
                    await fixQuizQuestionsTable();
                  } catch (error) {
                    console.error('Failed to fix quiz questions table:', error);
                  }

                  quizResult = await downloadAllQuizQuestions(
                    userData.email,
                    api,
                    (current, total, skipped = 0) => {
                      setDownloadProgress({ current: currentProgress + current, total: totalItems });
                    }
                  );
                }

                let message = 'Download Complete!\n\n';
                
                if (assessmentResult.success > 0 || assessmentResult.skipped > 0) {
                  message += `Assessment details: ${assessmentResult.success} downloaded`;
                  if (assessmentResult.skipped > 0) {
                    message += `, ${assessmentResult.skipped} already saved`;
                  }
                  if (assessmentResult.failed > 0) {
                    message += `, ${assessmentResult.failed} failed`;
                  }
                  message += '\n';
                }
                
                if (quizResult.success > 0 || quizResult.skipped > 0) {
                  message += `Quiz questions: ${quizResult.success} downloaded`;
                  if (quizResult.skipped > 0) {
                    message += `, ${quizResult.skipped} already saved`;
                  }
                  if (quizResult.failed > 0) {
                    message += `, ${quizResult.failed} failed`;
                  }
                  message += '\n';
                }

                message += '\nAll data is now available offline!';

                Alert.alert('Success', message, [{ text: 'OK', onPress: toggleAd }]);

                const remainingAssessments = await getAssessmentsWithoutDetails(userData.email);
                setAssessmentsNeedingDetails(remainingAssessments.length);

              } catch (error) {
                console.error('Download failed:', error);
                Alert.alert(
                  'Download Failed',
                  'Failed to download assessment data. Please check your internet connection and try again.',
                  [{ text: 'OK' }]
                );
              } finally {
                setIsDownloadingData(false);
                setDownloadProgress({ current: 0, total: 0 });
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error in handleAdButtonPress:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
  };

  if (!isInitialized) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <LinearGradient
          colors={['#02135eff', '#7979f1ff']}
          style={styles.loadingGradient}
        >
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>Initializing...</Text>
        </LinearGradient>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
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
        {/* Enhanced Header with Gradient */}
        <LinearGradient
          colors={['#02135eff', '#7979f1ff']}
          style={styles.header}
        >
          <Animated.View style={[styles.headerContent, { transform: [{ translateY: slideAnim }] }]}>
            <Text style={styles.welcomeText}>Welcome back!</Text>
            <Text style={styles.userNameText}>{userName}</Text>
            <Text style={styles.subText}>Ready to continue your learning journey?</Text>
            
            {!netInfo?.isInternetReachable && (
              <View style={styles.offlineNotice}>
                <Ionicons name="cloud-offline-outline" size={18} color="#fff" />
                <Text style={styles.offlineText}>Offline Mode</Text>
              </View>
            )}

          </Animated.View>
        </LinearGradient>

        {/* Enhanced Search Button */}
        <TouchableOpacity
          style={[
            styles.searchButton,
            !netInfo?.isInternetReachable && styles.disabledButton
          ]}
          onPress={handleSearchPress}
          disabled={!netInfo?.isInternetReachable}
        >
          <LinearGradient
            colors={netInfo?.isInternetReachable ? ['#4facfe', '#00f2fe'] : ['#ccc', '#999']}
            style={styles.searchButtonGradient}
          >
            <Ionicons name="search" size={20} color="#fff" style={styles.searchIcon} />
            <Text style={styles.searchButtonText}>Discover new courses</Text>
          </LinearGradient>
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
            <Ionicons name={netInfo?.isInternetReachable ? "wifi" : "wifi-off"} size={24} color={netInfo?.isInternetReachable ? "#10ac84" : "#ff6b6b"} />
            <Text style={styles.statLabel}>{netInfo?.isInternetReachable ? "Online" : "Offline"}</Text>
          </View>
        </View>

        {/* Enhanced Ad Section */}
        <View style={styles.adContainer}>
          <Animated.View style={[styles.adContent, { height: adHeight }]}>
              <View style={styles.adButtonContainer}>
                  {/* The existing Download Button */}
                  <TouchableOpacity 
                      style={[
                          styles.adButton, 
                          isDownloadingData && styles.adButtonDownloading,
                          !netInfo?.isInternetReachable && styles.disabledButton,
                          styles.flex1 // Add a new style to make it take up half the space
                      ]} 
                      onPress={handleAdButtonPress}
                      disabled={isDownloadingData || isRefreshing || !netInfo?.isInternetReachable}
                  >
                      <LinearGradient
                          colors={isDownloadingData ? ['#17a2b8', '#138496'] : ['#28a745', '#20c997']}
                          style={styles.adButtonGradient}
                      >
                          {isDownloadingData ? (
                              <View style={styles.downloadProgressContainer}>
                                  <ActivityIndicator color="#fff" size="small" />
                                  <Text style={styles.adButtonText}>
                                      Downloading... ({downloadProgress.current}/{downloadProgress.total})
                                  </Text>
                              </View>
                          ) : (
                              <View style={styles.adButtonInnerContainer}>
                                  <Ionicons name="cloud-download" size={20} color="#fff" />
                                  <Text style={styles.adButtonText}>
                                      {assessmentsNeedingDetails > 0 
                                          ? `Download (${assessmentsNeedingDetails})`
                                          : 'Download All Data'
                                      }
                                  </Text>
                              </View>
                          )}
                      </LinearGradient>
                  </TouchableOpacity>

                  {/* NEW: The Update Button */}
                  <TouchableOpacity
                      style={[
                          styles.adButton,
                          (isRefreshing || isDownloadingData) && styles.adButtonDownloading,
                          !netInfo?.isInternetReachable && styles.disabledButton,
                          styles.flex1 // Add a new style to make it take up half the space
                      ]}
                      onPress={handleRefresh}
                      disabled={isRefreshing || isDownloadingData || !netInfo?.isInternetReachable}
                  >
                      <LinearGradient
                          colors={isRefreshing ? ['#17a2b8', '#138496'] : ['#667eea', '#764ba2']}
                          style={styles.adButtonGradient}
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
                      </LinearGradient>
                  </TouchableOpacity>
              </View>
          </Animated.View>
          <TouchableOpacity style={styles.adToggle} onPress={toggleAd}>
              <Ionicons
                  name={isAdVisible ? 'chevron-up' : 'chevron-down'}
                  size={24}
                  color="#667eea"
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

        {/* Search Modal - keeping existing implementation */}
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
                editable={netInfo?.isInternetReachable}
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
              {!isLoadingSearch && hasSearched && searchResults.length > 0 && (
                <View style={styles.searchResultsContainer}>
                  <Text style={styles.searchResultsTitle}>Matching Courses:</Text>
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={renderCourseItem}
                    contentContainerStyle={styles.flatListContent}
                  />
                </View>
              )}
              {isLoadingSearch && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#667eea" />
                  <Text style={styles.loadingText}>Searching...</Text>
                </View>
              )}
              {!isLoadingSearch && hasSearched && searchResults.length === 0 && (
                <View style={styles.noResultsContainer}>
                  <Text style={styles.noResultsText}>No courses found for "{searchQuery}".</Text>
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollView: {
    flex: 1,
  },
  // Enhanced Header Styles
  header: {
    paddingTop: 30,
    paddingBottom: 30,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  headerContent: {
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: '300',
    color: '#fff',
    opacity: 0.9,
  },
  userNameText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginVertical: 5,
  },
  subText: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.8,
    textAlign: 'center',
    marginTop: 5,
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 15,
  },
  offlineText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },
  downloadIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  downloadText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 8,
  },
  // Enhanced Search Button
  searchButton: {
    marginHorizontal: 20,
    marginTop: -20,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  searchButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 25,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Enhanced Stats Section
  statsSection: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingVertical: 25,
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    paddingVertical: 20,
    paddingHorizontal: 15,
    alignItems: 'center',
    minWidth: width * 0.25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    textAlign: 'center',
    marginTop: 4,
  },
  // Enhanced Ad Section
  adContainer: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderRadius: 15,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  adContent: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 15,
  },
  adButton: {
    borderRadius: 10,
    overflow: 'hidden',
    width: '100%',
  },
  adButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 8,
    textAlign: 'center',
  },
  adToggle: {
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  downloadProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adButtonDownloading: {
    opacity: 0.8,
  },
  // Enhanced Courses Section
  coursesSection: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  scrollButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  scrollButton: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  // Enhanced Course Cards
  enrolledCourseCard: {
    marginRight: 15,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  courseCardGradient: {
    width: 180,
    height: 200,
    padding: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  enrolledCourseCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 20,
  },
  enrolledCourseCardCode: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  statusBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  enrolledCourseCardStatus: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  // Loading States
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  loadingCoursesContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingCoursesText: {
    marginTop: 15,
    fontSize: 16,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  // No Courses State
  noCoursesContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  noCoursesText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    textAlign: 'center',
    marginTop: 15,
  },
  noCoursesSubText: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  horizontalFlatListContent: {
    paddingVertical: 5,
  },
  // Modal Styles (Enhanced)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  enrollmentModalContent: {
    width: '80%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
    alignItems: 'center',
  },
  enrollmentText: {
    fontSize: 16,
    color: '#495057',
    textAlign: 'center',
    marginBottom: 10,
  },
  enrollmentCodeHint: {
    fontSize: 14,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  cancelButton: {
    marginTop: 15,
    padding: 10,
  },
  cancelButtonText: {
    color: '#dc3545',
    fontWeight: 'bold',
  },
  closeButton: {
    position: 'absolute',
    top: 15,
    right: 15,
    zIndex: 1,
  },
  modalTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 25,
    textAlign: 'center',
  },
  searchInput: {
    borderWidth: 2,
    borderColor: '#e9ecef',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    marginBottom: 20,
    color: '#343a40',
    width: '100%',
  },
  modalSearchButton: {
    backgroundColor: '#667eea',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    width: '100%',
  },
  modalSearchButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  searchResultsContainer: {
    marginTop: 25,
    maxHeight: 350,
  },
  searchResultsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 15,
  },
  courseResultCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  courseResultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  courseResultCode: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 3,
  },
  courseResultDetails: {
    fontSize: 13,
    color: '#7f8c8d',
    marginBottom: 2,
  },
  adButtonInnerContainer: { // New style for the inner content of the button
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex1: {
    flex: 1, // This will make each button take up equal space
  },
  enrollButton: {
    backgroundColor: '#28a745',
    padding: 12,
    borderRadius: 8,
    marginTop: 15,
    alignItems: 'center',
    shadowColor: '#28a745',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  enrollButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  noResultsContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  flatListContent: {
    paddingBottom: 10,
  },
  offlineModalHint: {
    fontSize: 12,
    color: '#dc3545',
    textAlign: 'center',
    marginTop: 15,
    fontStyle: 'italic',
  },
  disabledButton: {
    opacity: 0.5,
  },
});