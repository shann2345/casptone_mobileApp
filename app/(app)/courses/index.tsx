import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
import { syncAllOfflineData } from '@/lib/offlineSync';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useNetworkStatus } from '../../../context/NetworkContext';
import api, { getUserData } from '../../../lib/api';
import {
  deleteCourseAndRelatedDataFromDb,
  getCompletedOfflineQuizzes,
  getEnrolledCoursesFromDb, // Keep this import
  getUnsyncedSubmissions,
  initDb,
  saveCourseToDb
} from '../../../lib/localDb';
import { showOfflineModeWarningIfNeeded } from '../../../lib/offlineWarning';

const { width } = Dimensions.get('window');

// Interface for course data
interface Course {
  id: number;
  title: string;
  course_code: string;
  description: string;
  credits: number;
  program: {
    id: number;
    name: string;
  };
  instructor: {
    id: number;
    name: string;
  };
  status: string;
}

// Interface for enrolled course including pivot data
interface EnrolledCourse extends Course {
  pivot?: {
    status: string;
    enrollment_date: string;
  };
}

const courseColors = [
  '#1967d2',
  '#d93025',
  '#137333',
  '#e37400',
  '#8e24aa',
  '#0d652d',
  '#c5221f',
  '#1a73e8',
];

export default function CoursesScreen() {
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null); // State for actual errors
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isConnected, netInfo } = useNetworkStatus();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<EnrolledCourse | null>(null);
  const [isSettingsModalVisible, setIsSettingsModalVisible] = useState(false);
  const [isUnenrolling, setIsUnenrolling] = useState(false);

  // 🔔 Pending sync notification (automatic detection)
  usePendingSyncNotification(netInfo?.isInternetReachable ?? null, 'courses');

  // Ref to prevent repeated deep link navigation
  const hasNavigatedToCourseRef = useRef(false);

  // Helper function to fetch courses from the local database
  const fetchEnrolledCoursesFromDb = async () => {
    if (!currentUserEmail) {
      setError('Cannot load courses. No user email found.'); // Keep error for missing email
      setIsLoading(false);
      return;
    }
    try {
      const courses = await getEnrolledCoursesFromDb(currentUserEmail);
      setEnrolledCourses(courses);
      // --- FIX: Remove setError when courses are empty ---
      // if (courses.length === 0) {
      //   setError('You are not enrolled in any courses yet.'); // REMOVED THIS LINE
      // }
      // --- END FIX ---
    } catch (e) {
      console.error('Failed to get enrolled courses from local DB:', e);
      setError('Failed to load courses from local storage.'); // Keep error for actual DB issues
    } finally {
        setIsLoading(false); // Make sure loading stops even if offline & empty
    }
  };


  const fetchCourses = useCallback(async () => {
    if (!currentUserEmail) {
      // Don't fetch if no email
      setIsLoading(false); // Stop loading if no user
      return;
    }
    // Only set loading true if not already refreshing
    if (!isRefreshing) setIsLoading(true);
    setError(null); // Clear previous errors on fetch start

    try {
      if (netInfo?.isInternetReachable) {
        console.log('Network is reachable. Fetching courses from API...');
        const response = await api.get('/my-courses');
        if (response.data && response.data.courses) {
          setEnrolledCourses(response.data.courses);
          // Save to local DB for offline access
          await Promise.all(response.data.courses.map((course: Course) =>
            saveCourseToDb(course, currentUserEmail)
          ));
        } else {
          setEnrolledCourses([]); // API returned no courses
        }
      } else {
        console.log('Network is not reachable. Fetching courses from local DB...');
        await fetchEnrolledCoursesFromDb(); // fetchEnrolledCoursesFromDb handles setIsLoading(false)
        return; // Return early as fetchEnrolledCoursesFromDb handles loading state
      }
    } catch (error: any) {
      console.error('Failed to fetch courses:', error);
      setError('Failed to load courses. Please try again.');
      // Attempt to load from DB as a fallback only if online fetch failed
      if (netInfo?.isInternetReachable) {
         await fetchEnrolledCoursesFromDb();
      }
    } finally {
        // Only set loading false here if it wasn't an offline fetch
        if (netInfo?.isInternetReachable) {
            setIsLoading(false);
            setIsRefreshing(false); // Also stop refreshing indicator
        }
    }
  }, [currentUserEmail, netInfo?.isInternetReachable, isRefreshing]); // Added isRefreshing dependency

  useEffect(() => {
    const initialize = async () => {
      try {
        await initDb();
        const userData = await getUserData();
        if (userData && userData.email) {
          setCurrentUserEmail(userData.email);
        } else {
          console.error('User email not found. Redirecting to login.');
          router.replace('/login');
        }
      } catch (e) {
        console.error('Failed to initialize database or get user data:', e);
        setError('Failed to initialize app. Please restart.');
        setIsLoading(false); // Stop loading on init error
      }
    };
    initialize();
  }, []);

  // Sync effect remains the same
  useEffect(() => {
    const submitOfflineAssessments = async () => {
      if (netInfo?.isInternetReachable) {
        console.log('🌐 Network detected, checking for offline assessments to submit...');
        try {
          const userData = await getUserData();
          if (userData?.email) {
            const unsyncedSubmissions = await getUnsyncedSubmissions(userData.email);
            const completedOfflineQuizzes = await getCompletedOfflineQuizzes(userData.email);

            if (unsyncedSubmissions.length > 0 || completedOfflineQuizzes.length > 0) {
              console.log(`📤 Found ${unsyncedSubmissions.length} file submissions and ${completedOfflineQuizzes.length} quizzes to sync`);
              await syncAllOfflineData();
              console.log('✅ Offline assessments synced successfully');
              // Refresh data after sync (using fetchCourses which now handles online/offline)
              setTimeout(() => {
                fetchCourses();
              }, 1000);
            }
          }
        } catch (error) {
          console.error('❌ Error submitting offline assessments:', error);
        }
      }
    };

    submitOfflineAssessments();
  }, [netInfo?.isInternetReachable, fetchCourses]); // Added fetchCourses dependency

  // Focus effect remains the same
  useFocusEffect(
    useCallback(() => {
      if (currentUserEmail) {
        console.log('Courses screen focused. Fetching courses.');
        fetchCourses();
      }
    }, [currentUserEmail, fetchCourses])
  );

  // Deep link effect remains the same
  useEffect(() => {
    if (
      params.courseId &&
      !isLoading &&
      enrolledCourses.length > 0 &&
      !hasNavigatedToCourseRef.current
    ) {
      const courseIdToNavigate = params.courseId;
      const targetCourse = enrolledCourses.find(course =>
        course.id.toString() === courseIdToNavigate.toString()
      );

      if (targetCourse) {
        hasNavigatedToCourseRef.current = true;
        console.log(`Navigating to course ${courseIdToNavigate} from deep link.`);
        router.push({
          pathname: `/courses/${courseIdToNavigate}`,
          params: { course: JSON.stringify(targetCourse) },
        });
        setTimeout(() => {
          if (router.setParams) {
            router.setParams({ courseId: undefined });
          }
        }, 500);
      } else {
        console.warn(`Deep link to course ID ${courseIdToNavigate} failed: Course not found in user's enrolled list.`);
      }
    }
    if (!params.courseId) {
      hasNavigatedToCourseRef.current = false;
    }
  }, [params.courseId, isLoading, enrolledCourses]);

  // Initial fetch trigger (now relies on currentUserEmail)
  useEffect(() => {
    if (currentUserEmail) {
      // Initial fetch is now handled by useFocusEffect primarily,
      // but we might need one here if focus effect doesn't run immediately
       fetchCourses();
    } else {
      setIsLoading(false); // Stop loading if no user email yet
    }
  }, [currentUserEmail, fetchCourses]); // Added fetchCourses


  // handleRefresh remains the same
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    if (!netInfo?.isInternetReachable) {
      Alert.alert(
        'Offline',
        'Cannot refresh while offline. Showing cached data.',
        [{ text: 'OK' }]
      );
      setIsRefreshing(false);
      return;
    }
    try {
      await fetchCourses(); // fetchCourses now handles setIsRefreshing(false)
    } catch (error) {
      console.error('Error on refresh:', error);
      setIsRefreshing(false); // Ensure it stops on error too
    }
    // Removed finally block as fetchCourses handles it
  }, [fetchCourses, netInfo?.isInternetReachable]);

  // Offline warning effect remains the same
  useEffect(() => {
    const checkOfflineWarning = async () => {
      if (!netInfo?.isInternetReachable) {
        await showOfflineModeWarningIfNeeded();
      }
    };
    checkOfflineWarning();
  }, [netInfo?.isInternetReachable]);

  // handleCourseSettings remains the same
  const handleCourseSettings = (course: EnrolledCourse) => {
    setSelectedCourse(course);
    setIsSettingsModalVisible(true);
  };

  // handleUnenroll remains the same (uses the correct DB delete function)
  const handleUnenroll = async () => {
    if (!selectedCourse || !currentUserEmail) return;

    Alert.alert(
      'Unenroll from Course',
      `Are you sure you want to unenroll from "${selectedCourse.title}"?\n\nThis will:\n• Remove you from the course\n• Delete ALL offline course data\n• Remove your access to course materials\n\nNote: Your submissions and grades will be preserved on the server.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unenroll',
          style: 'destructive',
          onPress: async () => {
            setIsUnenrolling(true);
            try {
              console.log(`🔄 Unenrolling from course: ${selectedCourse.title} (ID: ${selectedCourse.id})`);
              const response = await api.post('/unenroll', { course_id: selectedCourse.id });
              if (response.status === 200) {
                console.log('✅ Successfully unenrolled from course on server');
                try {
                  await deleteCourseAndRelatedDataFromDb(selectedCourse.id, currentUserEmail);
                  console.log('✅ Successfully deleted all associated offline course data.');
                } catch (dbError) {
                  console.error('❌ Failed to delete offline data after unenroll, but server unenrollment succeeded:', dbError);
                  Alert.alert('Cleanup Error', 'Unenrolled successfully, but failed to remove all local data. Please restart the app or clear cache if issues persist.');
                }
                setIsSettingsModalVisible(false);
                setSelectedCourse(null);
                await fetchCourses(); // Refresh list
                Alert.alert('Success', `You have been unenrolled from "${selectedCourse.title}".`);
              } else {
                throw new Error(response.data?.message || 'Failed to unenroll on server');
              }
            } catch (error: any) {
              console.error('❌ Error unenrolling from course:', error);
              const errorMessage = error.response?.data?.message || 'Failed to unenroll from course. Please try again.';
              Alert.alert('Error', errorMessage);
            } finally {
              setIsUnenrolling(false);
            }
          }
        }
      ]
    );
  };

  // handleDeleteCourse - adjusted to use the comprehensive delete function
  const handleDeleteCourse = async (course: EnrolledCourse) => {
    Alert.alert(
      'Delete Course Data',
      `Are you sure you want to delete all offline data for "${course.title}"?\n\nThis will remove:\n• Course details\n• Materials\n• Assessments\n• Quiz questions\n\nYou can re-download this data when online.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!currentUserEmail) {
                Alert.alert('Error', 'User email not found.');
                return;
              }

              console.log(`🗑️ Deleting offline data for course: ${course.title} (ID: ${course.id})`);

              // --- FIX: Use the comprehensive delete function ---
              await deleteCourseAndRelatedDataFromDb(course.id, currentUserEmail);
              console.log(`✅ Successfully deleted all offline data for course: ${course.title}`);
              // --- END OF FIX ---

              // Refresh the course list directly from DB as we are offline
              await fetchEnrolledCoursesFromDb();

              Alert.alert(
                'Success',
                `Offline data for "${course.title}" has been deleted. You can re-download it when online.`
              );
            } catch (error) {
              console.error('❌ Error deleting course data:', error);
              Alert.alert('Error', 'Failed to delete course data. Please try again.');
            }
          }
        }
      ]
    );
  };

  // renderCourseCard remains the same
  const renderCourseCard = ({ item, index }: { item: EnrolledCourse; index: number }) => {
    const color = courseColors[index % courseColors.length];
    const isOffline = !netInfo?.isInternetReachable;

    return (
      <View style={styles.courseCardWrapper}>
        <TouchableOpacity
          style={styles.courseCard}
          onPress={() => {
            console.log('Navigating to course:', item.title);
            router.push({ pathname: `/courses/${item.id}`, params: { course: JSON.stringify(item) } });
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.courseCardHeader, { backgroundColor: color }]}>
            <View style={styles.courseIconContainer}>
              <Ionicons name="book-outline" size={28} color="#fff" />
            </View>
          </View>

          <View style={styles.courseCardBody}>
            <Text style={styles.courseCardTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.courseCardCode} numberOfLines={1}>
              {item.course_code}
            </Text>

            <View style={styles.courseCardDivider} />

            <View style={styles.courseCardFooter}>
              <View style={styles.instructorRow}>
                <Ionicons name="person-outline" size={14} color="#5f6368" />
                <Text style={styles.instructorName} numberOfLines={1}>
                  {item.instructor?.name || 'N/A'}
                </Text>
              </View>
              {/* Credits Row removed as it's not in DB */}
            </View>
          </View>
        </TouchableOpacity>

        {!isOffline && (
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => handleCourseSettings(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#5f6368" />
          </TouchableOpacity>
        )}

        {isOffline && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteCourse(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={20} color="#d93025" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // --- Main Render Logic ---

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1967d2" />
          <Text style={styles.loadingText}>Loading your courses...</Text>
        </View>
      </View>
    );
  }

  // --- FIX: Prioritize showing error only if it's a real loading error ---
  // Don't show error screen just because courses are empty
  if (error && enrolledCourses.length === 0) { // Only show error if list is also empty
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#d93025" />
          <Text style={styles.errorTitle}>Oops!</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={fetchCourses} // Use fetchCourses for retry
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  // --- END FIX ---


  // --- FIX: Show empty state if not loading, no errors preventing load, AND list is empty ---
  if (!isLoading && !error && enrolledCourses.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Courses</Text>
           {!netInfo?.isInternetReachable && (
            <View style={styles.offlineNotice}>
              <Ionicons name="cloud-offline-outline" size={16} color="#5f6368" />
              <Text style={styles.offlineText}>Offline</Text>
            </View>
          )}
        </View>
        <View style={styles.emptyStateContainer}>
          <Ionicons name="school-outline" size={80} color="#dadce0" />
          <Text style={styles.emptyStateTitle}>No courses yet</Text>
          <Text style={styles.emptyStateText}>
            You haven't enrolled in any courses.
          </Text>
          <Text style={styles.emptyStateText}>
            Visit the home screen to search and enroll!
          </Text>
           <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#1967d2"
            colors={['#1967d2']}
          />
        </View>
      </View>
    );
  }
 // --- END FIX ---

  // Default rendering if courses exist
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Courses</Text>
        <Text style={styles.headerSubtitle}>
          {enrolledCourses.length} {enrolledCourses.length === 1 ? 'course' : 'courses'}
        </Text>
        {!netInfo?.isInternetReachable && (
          <View style={styles.offlineNotice}>
            <Ionicons name="cloud-offline-outline" size={16} color="#5f6368" />
            <Text style={styles.offlineText}>Offline</Text>
          </View>
        )}
      </View>

      <FlatList
        data={enrolledCourses}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderCourseCard}
        numColumns={2}
        contentContainerStyle={styles.flatListContent}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#1967d2"
            colors={['#1967d2']}
          />
        }
      />

      {/* Course Settings Modal (remains unchanged) */}
      <Modal
        visible={isSettingsModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => { setIsSettingsModalVisible(false); setSelectedCourse(null); }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { setIsSettingsModalVisible(false); setSelectedCourse(null); }}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Ionicons name="settings-outline" size={24} color="#202124" />
              <Text style={styles.modalTitle}>Course Settings</Text>
            </View>
            {selectedCourse && (
              <>
                <View style={styles.courseInfoSection}>
                  <Text style={styles.modalCourseTitle}>{selectedCourse.title}</Text>
                  <Text style={styles.modalCourseCode}>{selectedCourse.course_code}</Text>
                </View>
                <View style={styles.modalDivider} />
                <TouchableOpacity
                  style={[styles.unenrollButton, isUnenrolling && styles.disabledButton]}
                  onPress={handleUnenroll}
                  disabled={isUnenrolling}
                  activeOpacity={0.7}
                >
                  {isUnenrolling ? (<ActivityIndicator size="small" color="#d93025" />) : (<Ionicons name="exit-outline" size={20} color="#d93025" />)}
                  <Text style={styles.unenrollButtonText}>{isUnenrolling ? 'Unenrolling...' : 'Unenroll from Course'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => { setIsSettingsModalVisible(false); setSelectedCourse(null); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// Styles remain unchanged
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#fff',
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '500',
    color: '#202124',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#5f6368',
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#5f6368',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#f8f9fa',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '500',
    color: '#202124',
    marginTop: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#5f6368',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#1967d2',
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '400',
    color: '#5f6368',
    marginTop: 24,
    marginBottom: 12,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#80868b',
    textAlign: 'center',
    marginTop: 4,
  },
  flatListContent: {
    padding: 12,
    paddingBottom: 24,
  },
  row: {
    justifyContent: 'space-between',
  },
  courseCardWrapper: {
    width: (width - 36) / 2,
    marginBottom: 12,
    position: 'relative',
  },
  courseCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  deleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d93025',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
    zIndex: 10,
  },
  settingsButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5f6368',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
    zIndex: 10,
  },
  courseCardHeader: {
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  courseIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  courseCardBody: {
    padding: 12,
  },
  courseCardTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#202124',
    marginBottom: 4,
    minHeight: 40,
  },
  courseCardCode: {
    fontSize: 12,
    color: '#5f6368',
    marginBottom: 8,
  },
  courseCardDivider: {
    height: 1,
    backgroundColor: '#f1f3f4',
    marginVertical: 8,
  },
  courseCardFooter: {
    gap: 6,
  },
  instructorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  instructorName: {
    fontSize: 12,
    color: '#5f6368',
    marginLeft: 6,
    flex: 1,
  },
  creditsRow: { // Kept for consistency if data becomes available
    flexDirection: 'row',
    alignItems: 'center',
  },
  creditsText: { // Kept for consistency
    fontSize: 12,
    color: '#5f6368',
    marginLeft: 6,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#202124',
    marginLeft: 12,
  },
  courseInfoSection: {
    marginBottom: 20,
  },
  modalCourseTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: '#202124',
    marginBottom: 4,
  },
  modalCourseCode: {
    fontSize: 14,
    color: '#5f6368',
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginBottom: 20,
  },
  unenrollButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef7f7',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d93025',
    marginBottom: 12,
  },
  unenrollButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d93025',
    marginLeft: 8,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#5f6368',
  },
  disabledButton: {
    opacity: 0.5,
  },
});