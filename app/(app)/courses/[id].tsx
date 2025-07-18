// app/(app)/courses/[id].tsx
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import api from '../../../lib/api'; // Adjust path if needed

// Define interfaces for detailed course data
interface Material {
  id: number;
  title: string;
  file_path?: string; // Optional if not all materials have files
  content?: string; // Optional if materials can be text content
  type: string; // e.g., 'pdf', 'video', 'text'
}

interface Assessment {
  id: number;
  title: string;
  type: string; // e.g., 'quiz', 'assignment'
  // Add other assessment details if available
}

interface Topic {
  id: number;
  title: string;
  description?: string;
  materials: Material[]; // Materials belong to topics
  assessments: Assessment[]; // Assessments can belong to topics
}

interface CourseDetail {
  id: number;
  title: string;
  course_code: string;
  description: string;
  credits: number;
  status: string;
  program: {
    id: number;
    name: string;
  };
  instructor: {
    id: number;
    name: string;
  };
  topics: Topic[]; // Topics related to the course
  assessments: Assessment[]; // Independent assessments related to the course
}

export default function CourseDetailsScreen() {
  const { id } = useLocalSearchParams(); // Get the dynamic ID from the URL
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Course ID not provided.");
      setIsLoading(false);
      return;
    }

    const fetchCourseDetails = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await api.get(`/courses/${id}`); // Call your API
        setCourse(response.data.course);
      } catch (err: any) {
        console.error('Error fetching course details:', err);
        setError('Failed to load course details. Please try again.');
        if (err.response && err.response.data && err.response.data.message) {
          setError(err.response.data.message);
        }
        Alert.alert("Error", error || "Could not fetch course details.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchCourseDetails();
  }, [id]); // Re-fetch if ID changes

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading Course Details...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Error: {error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => setId(id)}> {/* Simple retry */}
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!course) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Course not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: course.title }} />

      <View style={styles.card}>
        <Text style={styles.title}>{course.title}</Text>
        <Text style={styles.detailText}>
          <Text style={styles.label}></Text> {course.description || 'N/A'}
        </Text>

        {/* Display Topics */}
        {course.topics && course.topics.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Topic</Text>
            {course.topics.map((topic) => (
              <View key={topic.id} style={styles.topicCard}>
                <Text style={styles.topicTitle}><Ionicons name="bulb-outline" size={16} color="#4CAF50" /> {topic.title}</Text>
                {topic.description && <Text style={styles.topicDescription}>{topic.description}</Text>}

                <TouchableOpacity>
                  {topic.materials && topic.materials.length > 0 && (
                    <View style={styles.subSection}>
                      <Text style={styles.subSectionTitle}>Materials</Text>
                      {topic.materials.map((material) => (
                        <Text key={material.id} style={styles.materialText}>
                          <Ionicons name="document-text-outline" size={14} color="#555" /> {material.title} ({material.type})
                        </Text>
                      ))}
                    </View>
                  )}
                </TouchableOpacity>

                {topic.assessments && topic.assessments.length > 0 && (
                  <View style={styles.subSection}>
                    {topic.assessments.map((assessment) => (
                      <View style={styles.subSection}>
                        <Text key={assessment.id} style={styles.assessmentText}>
                          <Ionicons name="clipboard-outline" size={14} color="#E91E63" /> {assessment.title} ({assessment.type})
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Display Independent Assessments (not tied to a topic) */}
        {course.assessments && course.assessments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Independent Assessments</Text>
            {course.assessments.map((assessment) => (
              <View key={assessment.id} style={styles.assessmentCard}>
                <Text style={styles.assessmentTitle}><Ionicons name="clipboard-outline" size={16} color="#E91E63" /> {assessment.title} ({assessment.type})</Text>
                {/* Add button to start assessment */}
              </View>
            ))}
          </View>
        )}

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f2f5',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#555',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f2f5',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: '#dc3545',
    textAlign: 'center',
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
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: 5,
  },
  subTitle: {
    fontSize: 18,
    color: '#555',
    marginBottom: 15,
  },
  detailText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 5,
  },
  label: {
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  section: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 15,
  },
  sectionContent: {
    fontSize: 16,
    color: '#555',
    lineHeight: 24,
  },
  topicCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  topicTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
  },
  topicDescription: {
    fontSize: 15,
    color: '#7f8c8d',
    marginBottom: 10,
  },
  subSection: {
    marginTop: 10,
    paddingLeft: 15,
    borderLeftWidth: 3,
    borderLeftColor: '#f0f0f0',
  },
  subSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4a69bd',
    marginBottom: 8,
  },
  materialText: {
    fontSize: 15,
    color: '#555',
    marginBottom: 5,
  },
  assessmentText: {
    fontSize: 15,
    color: '#555',
    marginBottom: 5,
  },
  assessmentCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  assessmentTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
});