// app/(app)/courses/index.tsx
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router'; // Import useRouter
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import api from '../../../lib/api'; // Ensure your api utility is correctly imported

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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter(); // Initialize router

  useEffect(() => {
    const fetchEnrolledCourses = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await api.get('/my-courses'); // Adjust endpoint if different
        setEnrolledCourses(response.data.courses);
      } catch (err: any) {
        console.error('Error fetching enrolled courses:', err.response?.data || err.message);
        setError('Failed to load your courses. Please try again.');
        Alert.alert('Error', 'Failed to load your courses.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchEnrolledCourses();
  }, []);

  const renderCourseCard = ({ item }: { item: EnrolledCourse }) => (
    <TouchableOpacity
      style={styles.courseCard}
      onPress={() => {
        console.log('Navigating to course details for:', item.title);
        // Navigate to the course details screen using expo-router
        router.push(`/courses/${item.id}`); // Correct navigation path
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
        <TouchableOpacity style={styles.retryButton} onPress={() => {}}>
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
    backgroundColor: '#f0f2f5', // Light background
    paddingHorizontal: 20,
    paddingTop: 40, // Add some top padding
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f2f5',
    padding: 20,
  },
  title: {
    fontSize: 28, // Larger title
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
    paddingBottom: 20, // Space at the bottom of the list
  },
  courseCard: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15, // Space between cards
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 }, // More pronounced shadow
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
    flexShrink: 1, // Allows title to wrap if long
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
    color: '#28a745', // Green for status
  },
});