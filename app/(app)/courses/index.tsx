// app/(app)/courses/index.tsx
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import api from '../../../lib/api';

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
    // Add other pivot fields if you have them, e.g., grade, progress
  };
}

export default function CoursesScreen() {
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true); // Initial state set to true
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    // This function handles fetching the enrolled courses
    const fetchEnrolledCourses = async () => {
      setIsLoading(true); // Always set loading to true when starting a fetch
      setError(null);
      try {
        const response = await api.get('/my-courses');
        setEnrolledCourses(response.data.courses);
      } catch (err: any) {
        console.error('Failed to fetch enrolled courses:', err.response?.data || err.message);
        setError('Failed to load courses.');
        Alert.alert('Error', 'Failed to load enrolled courses.');
      } finally {
        setIsLoading(false); // Always set loading to false when the fetch operation completes (success or error)
      }
    };

    // --- Deep Link Navigation Logic ---
    // This block runs if a 'courseId' parameter is present (e.g., from Dashboard click)
    if (params.courseId) {
      const courseIdToNavigate = params.courseId;
      router.setParams({ courseId: undefined });

      // Immediately push to the specific course details page
      router.push(`/courses/${courseIdToNavigate}`);
      
      setIsLoading(false);
      
      return; // Exit the effect early if we are deep-linking
    }

    // --- Normal List Fetch Logic ---
    // This block runs if there's no 'courseId' param (e.g., direct tab press, or navigating back)
    fetchEnrolledCourses();

  }, [params.courseId]);


  const renderCourseCard = ({ item }: { item: EnrolledCourse }) => (
    <TouchableOpacity
      style={styles.courseCard}
      onPress={() => router.push(`/courses/${item.id}`)} // Direct push within this stack
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
        <TouchableOpacity style={styles.retryButton} onPress={() => { /* Consider re-fetching here */ }}>
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