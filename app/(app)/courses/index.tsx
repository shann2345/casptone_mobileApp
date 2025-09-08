import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNetworkStatus } from '../../../context/NetworkContext';
import api, { getUserData } from '../../../lib/api';
import { getEnrolledCoursesFromDb, initDb, saveCourseToDb } from '../../../lib/localDb';

// Interface for course data (re-used from index.tsx)
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

export default function CoursesScreen() {
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isConnected, netInfo } = useNetworkStatus(); 
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

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

  // UPDATED: Enhanced deep link navigation logic
  useEffect(() => {
    // Deep Link Navigation Logic for courseId from to-do
    if (params.courseId && !isLoading && enrolledCourses.length > 0) {
      const courseIdToNavigate = params.courseId;
      
      // Find the course to ensure it exists
      const targetCourse = enrolledCourses.find(course => 
        course.id.toString() === courseIdToNavigate.toString()
      );
      
      if (targetCourse) {
        console.log('Navigating to course from to-do:', {
          courseId: courseIdToNavigate,
          courseName: targetCourse.title
        });
        
        // Clear the parameter to prevent repeated navigation
        router.setParams({ courseId: undefined });
        
        // Navigate to the specific course
        router.push(`/courses/${courseIdToNavigate}`);
      } else {
        console.warn('Course not found in enrolled courses:', courseIdToNavigate);
        Alert.alert(
          'Course Not Found',
          'The course you\'re trying to access is not in your enrolled courses.',
          [{ text: 'OK' }]
        );
      }
    }
  }, [params.courseId, isLoading, enrolledCourses]);

  useEffect(() => {
    const fetchCourses = async () => {
      if (!currentUserEmail) {
        return;
      }
      setIsLoading(true);
      setError(null);
      
      if (isConnected) {
        console.log('You are online. Fetching from API...');
        try {
          const response = await api.get('/my-courses');
          const courses = response.data.courses;
          setEnrolledCourses(courses);

          if (currentUserEmail) {
            for (const course of courses) {
              await saveCourseToDb(course, currentUserEmail);
            }
            console.log('Courses saved to local DB successfully.');
          }
        } catch (err: any) {
          console.error('Failed to fetch enrolled courses from API:', err.response?.data || err.message);
          setError('Failed to load courses from the network. Displaying offline data.');
          await fetchEnrolledCoursesFromDb();
        } finally {
          setIsLoading(false);
        }
      } else {
        console.log('You are offline. Fetching from local DB...');
        await fetchEnrolledCoursesFromDb();
        setIsLoading(false);
      }
    };
    
    if (currentUserEmail) {
      fetchCourses();
    }
  }, [isConnected, currentUserEmail]);

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
        setError('No courses found in local database.');
      }
    } catch (e) {
      console.error('Failed to get enrolled courses from local DB:', e);
      setError('Failed to load courses from local storage.');
    }
  };

  const handleRefresh = useCallback(async () => {
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
      await fetchEnrolledCoursesFromDb();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchEnrolledCoursesFromDb]);

  const renderCourseCard = ({ item }: { item: EnrolledCourse }) => (
    <TouchableOpacity
      style={styles.courseCard}
      onPress={() => {
        console.log('Navigating to course:', item.title);
        router.push(`/courses/${item.id}`);
      }}
    >
      <View style={styles.cardHeader}>
        <Ionicons name="book-outline" size={24} color="#007bff" style={styles.cardIcon} />
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
      </View>
      <Text style={styles.cardInstructor}>{item.instructor?.name || 'N/A'}</Text>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading your courses...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centeredContainer}>
        <Ionicons name="alert-circle-outline" size={50} color="#dc3545" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => { /* re-fetch logic could go here */ }}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (enrolledCourses.length === 0) {
    return (
      <View style={styles.centeredContainer}>
        <Ionicons name="school-outline" size={60} color="#6c757d" />
        <Text style={styles.noCoursesText}>No Courses Enrolled</Text>
        <Text style={styles.noCoursesSubText}>
          It looks like you haven't enrolled in any courses yet.
        </Text>
        <Text style={styles.noCoursesSubText}>
          Head back to the home screen to find courses to join!
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Enrolled Courses</Text>
      <FlatList
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
          />
        }
        data={enrolledCourses}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderCourseCard}
        contentContainerStyle={styles.flatListContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f2f5',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 25,
    textAlign: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#555',
  },
  errorText: {
    fontSize: 16,
    color: '#dc3545',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 15,
  },
  retryButton: {
    backgroundColor: '#007bff',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  noCoursesText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#6c757d',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  noCoursesSubText: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 24,
  },
  flatListContent: {
    paddingBottom: 20,
  },
  courseCard: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardIcon: {
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#007bff',
    flexShrink: 1,
  },
  cardCode: {
    fontSize: 15,
    color: '#555',
    marginBottom: 5,
  },
  cardProgram: {
    fontSize: 14,
    color: '#777',
    marginBottom: 3,
  },
  cardInstructor: {
    fontSize: 14,
    color: '#777',
    marginBottom: 10,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#f0f2f5',
    paddingTop: 10,
    marginTop: 10,
  },
  cardStatus: {
    fontSize: 13,
    fontWeight: '600',
    color: '#28a745',
  },
});