import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { showOfflineModeWarningIfNeeded } from '../../../lib/offlineWarning';

import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useNetworkStatus } from '../../../context/NetworkContext';
import api, { getUserData } from '../../../lib/api';
import { getEnrolledCoursesFromDb, initDb, saveCourseToDb } from '../../../lib/localDb';

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
  ['#667eea', '#764ba2'],
  ['#4facfe', '#00f2fe'],
  ['#43e97b', '#38f9d7'],
  ['#fa709a', '#fee140'],
  ['#a8edea', '#fed6e3'],
  ['#ffecd2', '#fcb69f'],
  ['#667eea', '#764ba2'],
  ['#f093fb', '#f5576c'],
];

export default function CoursesScreen() {
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isConnected, netInfo } = useNetworkStatus(); 
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Ref to prevent repeated deep link navigation
  const hasNavigatedToCourseRef = useRef(false);

  const fetchCourses = useCallback(async () => {
    if (!currentUserEmail) {
      // Don't fetch if no email
      return;
    }
    setIsLoading(true);
    setError(null);
    
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
          setEnrolledCourses([]);
        }
      } else {
        console.log('Network is not reachable. Fetching courses from local DB...');
        await fetchEnrolledCoursesFromDb();
      }
    } catch (error: any) {
      console.error('Failed to fetch courses:', error);
      setError('Failed to load courses. Please try again.');
      // Attempt to load from DB as a fallback
      await fetchEnrolledCoursesFromDb();
    } finally {
      setIsLoading(false);
    }
  }, [currentUserEmail, netInfo?.isInternetReachable]);

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
      }
    };
    initialize();
  }, []);

  // Use useFocusEffect to refetch data when the screen is focused
  useFocusEffect(
    useCallback(() => {
      if (currentUserEmail) {
        console.log('Courses screen focused. Fetching courses.');
        fetchCourses();
      }
    }, [currentUserEmail, fetchCourses])
  );

  // Enhanced deep link navigation logic with fix
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
        // Clear the param so tab doesn't keep auto-navigating
        setTimeout(() => {
          if (router.setParams) {
            router.setParams({ courseId: undefined });
          }
        }, 500);
      } else {
        console.warn(`Deep link to course ID ${courseIdToNavigate} failed: Course not found in user's enrolled list.`);
        // Optionally, show a toast or alert
        // Toast library: Uncomment if you use Toast
        // Toast.show({
        //   type: 'error',
        //   text1: 'Course Not Found',
        //   text2: 'You may not be enrolled in the specified course.',
        // });
      }
    }
    // Reset the flag if params.courseId is removed
    if (!params.courseId) {
      hasNavigatedToCourseRef.current = false;
    }
  }, [params.courseId, isLoading, enrolledCourses]);

  useEffect(() => {
    const fetchCourses = async () => {
      if (!currentUserEmail) {
        // Don't fetch if no email
        return;
      }
      setIsLoading(true);
      setError(null);
      
      if (netInfo?.isInternetReachable) {
        console.log('Network is reachable. Fetching courses from API...');
        try {
          const response = await api.get('/my-courses');
          if (response.data && response.data.courses) {
            setEnrolledCourses(response.data.courses);
            // Save to local DB for offline access
            await Promise.all(response.data.courses.map((course: Course) => 
              saveCourseToDb(course, currentUserEmail)
            ));
          } else {
            setEnrolledCourses([]);
          }
        } catch (error: any) {
          console.error('Failed to fetch courses:', error);
          setError('Failed to load courses. Please try again.');
          // Attempt to load from DB as a fallback
          await fetchEnrolledCoursesFromDb();
        } finally {
          setIsLoading(false);
        }
      } else {
        console.log('Network is not reachable. Fetching courses from local DB...');
        await fetchEnrolledCoursesFromDb();
      }
    };
    
    if (currentUserEmail) {
      // Initial fetch is now handled by useFocusEffect
      // fetchCourses();
    }
  }, [netInfo?.isInternetReachable, currentUserEmail]);

  // Helper function to fetch courses from the local database
  const fetchEnrolledCoursesFromDb = async () => {
    if (!currentUserEmail) {
      setError('Cannot load courses. No user email found.');
      setIsLoading(false);
      return;
    }
    try {
      const courses = await getEnrolledCoursesFromDb(currentUserEmail);
      setEnrolledCourses(courses);
      if (courses.length === 0) {
        setError('You are not enrolled in any courses yet.');
      }
    } catch (e) {
      console.error('Failed to get enrolled courses from local DB:', e);
      setError('Failed to load courses from local storage.');
    }
  };

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    if (!netInfo?.isInternetReachable) {
      // Toast library: Uncomment if you use Toast
      // Toast.show({
      //   type: 'info',
      //   text1: 'Offline Mode',
      //   text2: 'Cannot refresh while offline. Showing cached data.',
      // });
      setIsRefreshing(false);
      return;
    }
    try {
      await fetchCourses();
    } catch (error) {
      console.error('Error on refresh:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchCourses, netInfo?.isInternetReachable]);

  useEffect(() => {
    const checkOfflineWarning = async () => {
      if (!netInfo?.isInternetReachable) {
        await showOfflineModeWarningIfNeeded();
      }
    };
    checkOfflineWarning();
  }, [netInfo?.isInternetReachable]);

  const renderCourseCard = ({ item, index }: { item: EnrolledCourse; index: number }) => (
    <TouchableOpacity
      style={styles.courseCard}
      onPress={() => {
        console.log('Navigating to course:', item.title);
        router.push({ pathname: `/courses/${item.id}`, params: { course: JSON.stringify(item) } });
      }}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={courseColors[index % courseColors.length]}
        style={styles.courseCardGradient}
      >
        <View style={styles.courseCardHeader}>
          <Ionicons name="book" size={24} color="#fff" />
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>Enrolled</Text>
          </View>
        </View>
        <View style={styles.courseCardContent}>
          <Text style={styles.courseCardTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.courseCardCode} numberOfLines={1}>
            {item.course_code}
          </Text>
        </View>
        <View style={styles.courseCardFooter}>
          <View style={styles.instructorInfo}>
            <Ionicons name="person" size={14} color="rgba(255,255,255,0.8)" />
            <Text style={styles.instructorName} numberOfLines={1}>
              {item.instructor?.name || 'N/A'}
            </Text>
          </View>
          <View style={styles.creditsInfo}>
            <Text style={styles.creditsText}>{item.credits} credits</Text>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#667eea', '#764ba2']}
          style={styles.loadingContainer}
        >
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>Loading your courses...</Text>
        </LinearGradient>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#f093fb', '#f5576c']}
          style={styles.centeredContainer}
        >
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={60} color="#fff" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => {
              setError(null);
              setIsLoading(true);
              if (currentUserEmail) {
                fetchEnrolledCoursesFromDb();
              }
            }}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>
    );
  }

  if (enrolledCourses.length === 0) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#a8edea', '#fed6e3']}
          style={styles.centeredContainer}
        >
          <View style={styles.emptyStateContainer}>
            <Ionicons name="school-outline" size={80} color="#fff" />
            <Text style={styles.emptyStateTitle}>No Courses Enrolled</Text>
            <Text style={styles.emptyStateText}>
              It looks like you haven't enrolled in any courses yet.
            </Text>
            <Text style={styles.emptyStateText}>
              Head back to the home screen to find courses to join!
            </Text>
          </View>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Beautiful Header */}
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        style={styles.headerContainer}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Courses</Text>
          <Text style={styles.headerSubtitle}>
            {enrolledCourses.length} {enrolledCourses.length === 1 ? 'course' : 'courses'} enrolled
          </Text>
          {!netInfo?.isInternetReachable && (
            <View style={styles.offlineNotice}>
              <Ionicons name="wifi-outline" size={14} color="#d93025" />
              <Text style={styles.offlineText}>Offline mode</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* Courses Grid */}
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
            colors={['#667eea']}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  headerContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    paddingTop: 40,
    paddingBottom: 30,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '400',
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  offlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 18,
    color: '#fff',
    fontWeight: '500',
  },
  errorContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    padding: 30,
  },
  errorText: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 20,
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyStateContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    padding: 40,
  },
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 5,
  },
  flatListContent: {
    padding: 20,
    paddingTop: 30,
  },
  row: {
    justifyContent: 'space-between',
  },
  courseCard: {
    width: (width - 60) / 2,
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  courseCardGradient: {
    padding: 20,
    height: 180,
    justifyContent: 'space-between',
  },
  courseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  statusText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  courseCardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  courseCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    lineHeight: 20,
    marginBottom: 4,
  },
  courseCardCode: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  courseCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  instructorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  instructorName: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    marginLeft: 4,
  },
  creditsInfo: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  creditsText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '500',
  },
});