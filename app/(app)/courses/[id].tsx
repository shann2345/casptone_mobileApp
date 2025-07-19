// app/(app)/courses/[id].tsx
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import api from '../../../lib/api'; // Adjust path if needed

// Define interfaces for detailed course data
interface Material {
  id: number;
  title: string;
  file_path?: string; // Optional if not all materials have files
  content?: string; // Optional if materials can be text content
  type: 'material'; // Explicitly type for easier rendering
  created_at: string; // Changed from createdAt to created_at to match Laravel's default
  isNested?: boolean; // Added for styling differentiation
}

interface Assessment {
  id: number;
  title: string;
  type: 'assessment'; // Explicitly type for easier rendering
  created_at: string; // Changed from createdAt to created_at to match Laravel's default
  isNested?: boolean; // Added for styling differentiation
  // ... other assessment details
}

interface Topic {
  id: number;
  name: string;
  description?: string;
  materials: Material[]; // Materials belong to topics
  assessments: Assessment[]; // Assessments can belong to topics
  type: 'topic'; // Explicitly type for easier rendering
  created_at: string; // Changed from createdAt to created_at to match Laravel's default
}

// Combined type for all displayable items in the SectionList
type CourseItem = Topic | Material | Assessment;

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
    email: string;
  };
  topics: Topic[]; // Topics related to the course
  materials: Material[]; // Independent materials related to the course
  assessments: Assessment[]; // Independent assessments related to the course
}

// Helper function to sort items by creation date
// Ensure all objects have 'created_at' property
const sortByDate = (a: Material | Assessment, b: Material | Assessment) => { // Changed type to only compare materials/assessments
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
};

const CourseDetailScreen = () => {
  const { id } = useLocalSearchParams();
  const [courseDetail, setCourseDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCourseDetail = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/courses/${id}`);

        console.log("API Response for Course Details:", JSON.stringify(response.data, null, 2));

        // Ensure that `created_at` is consistently used, not `createdAt`
        // You might need to adjust your Laravel backend to ensure it returns `created_at`
        // or transform the data here if it's `createdAt` from the backend.
        // Assuming backend returns `created_at` for all models.
        setCourseDetail(response.data.course);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch course details.');
        Alert.alert('Error', err.message || 'Failed to fetch course details.');
        if (err.response) {
          console.error("API Error Response Data:", JSON.stringify(err.response.data, null, 2));
          console.error("API Error Response Status:", err.response.status);
        } else if (err.request) {
          console.error("API Error Request:", err.request);
        } else {
          console.error("API Error Message:", err.message);
        }
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchCourseDetail();
    }
  }, [id]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text>Loading course details...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!courseDetail) {
    return (
      <View style={styles.centered}>
        <Text>No course details found.</Text>
      </View>
    );
  }

  // --- Data Transformation for SectionList ---
  const sections: { title: string; data: (Material | Assessment)[] }[] = []; // Data is now only materials/assessments
  const processedItemIds = new Set<number>(); // To track processed items and prevent duplication

  // Process topics first, ensuring their nested items are marked as 'nested'
  if (courseDetail.topics) {
    // Sort topics by creation date
    const sortedTopics = [...courseDetail.topics].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    sortedTopics.forEach(topic => {
      const topicSectionData: (Material | Assessment)[] = []; // Data for this section

      // Add topic's materials, marking them as nested
      if (topic.materials) {
        const sortedMaterials = [...topic.materials].sort(sortByDate);
        sortedMaterials.forEach(material => {
          topicSectionData.push({ ...material, type: 'material', isNested: true });
          processedItemIds.add(material.id); // Mark material as processed
        });
      }

      // Add topic's assessments, marking them as nested
      if (topic.assessments) {
        const sortedAssessments = [...topic.assessments].sort(sortByDate);
        sortedAssessments.forEach(assessment => {
          topicSectionData.push({ ...assessment, type: 'assessment', isNested: true });
          processedItemIds.add(assessment.id); // Mark assessment as processed
        });
      }

      // Only add a section if it has actual content (materials/assessments)
      if (topicSectionData.length > 0) {
        sections.push({
          title: `${topic.name}`, // Only topic name as title
          data: topicSectionData,
        });
      }
    });
  }

  // Collect independent materials and assessments that haven't been processed yet
  const independentContent: (Material | Assessment)[] = [];

  if (courseDetail.materials) {
    courseDetail.materials.forEach(material => {
      if (!processedItemIds.has(material.id)) {
        independentContent.push({ ...material, type: 'material' });
      }
    });
  }

  if (courseDetail.assessments) {
    courseDetail.assessments.forEach(assessment => {
      if (!processedItemIds.has(assessment.id)) {
        independentContent.push({ ...assessment, type: 'assessment' });
      }
    });
  }

  // Sort independent content by creation date
  independentContent.sort(sortByDate);

  // Add independent items as a separate section if any exist
  if (independentContent.length > 0) {
    sections.push({
      title: 'Independent Items', // A generic title for the section header
      data: independentContent,
    });
  }

  // --- Render Functions ---
  const renderSectionHeader = ({ section: { title } }: { section: { title: string } }) => {
    // Check if it's the "Independent Items" section
    if (title === 'Independent Items') {
      return (
        <View style={styles.separatorContainer}>
          <View style={styles.separatorLine} />
          <View style={styles.separatorLine} />
        </View>
      );
    }
    // Default rendering for other section headers (Topics)
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: Material | Assessment }) => { // Item is now always Material or Assessment
    const isNested = item.isNested;
    const itemCardStyle = isNested ? styles.itemCardNested : styles.itemCard;
    const itemTypeStyle = isNested ? styles.itemTypeNested : styles.itemType;

    return (
      <TouchableOpacity style={itemCardStyle} onPress={() => Alert.alert('Item Clicked', `You clicked: ${item.title}`)}>
        <Text style={styles.itemTitle}>{item.title}</Text>
        <Text style={itemTypeStyle}>Type: {item.type === 'material' ? 'Material' : 'Assessment'}</Text>
        {item.type === 'material' && item.content && item.content.length > 0 && (
          <Text style={styles.itemDetail} numberOfLines={2}>{item.content}</Text>
        )}
        {item.type === 'material' && item.file_path && (
          <Text style={styles.itemDetail}>File: {item.file_path.split('/').pop()}</Text>
        )}
        <Text style={styles.itemDate}>Created: {new Date(item.created_at).toLocaleDateString()}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: courseDetail.title }} />
      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        <Text style={styles.courseTitle}>{courseDetail.title}</Text>
        <View style={styles.detailRow}>
          <Text style={styles.label}>{courseDetail.instructor.name}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.label}>{courseDetail.instructor.email}</Text>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item, index) => `${item.type}-${item.id}-${index}`}
          renderSectionHeader={renderSectionHeader}
          renderItem={renderItem}
          stickySectionHeadersEnabled={true}
          ListEmptyComponent={<Text style={styles.centered}>No topics, materials, or assessments found for this course.</Text>}
          scrollEnabled={false}
          contentContainerStyle={styles.sectionListContent}
        />

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f7f6',
  },
  scrollViewContent: {
    padding: 20,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: 'red',
    fontSize: 16,
  },
  courseTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 10,
    textAlign: 'center',
  },
  courseCode: {
    fontSize: 18,
    color: '#7f8c8d',
    marginBottom: 5,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: '#555',
    lineHeight: 24,
    marginBottom: 15,
  },
  credits: {
    fontSize: 16,
    color: '#333',
    marginBottom: 5,
  },
  status: {
    fontSize: 16,
    color: '#333',
    marginBottom: 15,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  label: {
    fontWeight: 'bold',
    color: '#2c3e50',
    marginRight: 5,
  },
  value: {
    fontSize: 16,
    color: '#333',
  },
  sectionHeader: {
    backgroundColor: '#e0e6eb',
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginTop: 20,
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#c0c6cb',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#34495e',
  },
  // Style for the Topic card itself (when rendered as an item)
  topicHeaderCard: {
    backgroundColor: '#ecf0f1', // Lighter background for topic headers
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#bdc3c7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  topicHeaderTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  topicDescription: {
    fontSize: 15,
    color: '#555',
    marginBottom: 5,
  },
  // Base style for material/assessment cards
  itemCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  // NEW: Style for nested material/assessment cards
  itemCardNested: {
    backgroundColor: '#f8f8f8', // Slightly different background
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 15,
    marginLeft: 20, // Indent from the left
    marginRight: 5, // Keep a small margin on the right
    marginBottom: 8,
    marginTop: 4,
    borderLeftWidth: 4, // Visual indicator of nesting
    borderLeftColor: '#3498db', // Blue border for nesting
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 1.5,
    elevation: 1,
  },
  itemTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  itemType: {
    fontSize: 15,
    color: '#7f8c8d',
    fontStyle: 'italic',
    marginBottom: 5,
  },
  // NEW: Style for nested item type text
  itemTypeNested: {
    fontSize: 14,
    color: '#6c7a89',
    fontStyle: 'italic',
    marginBottom: 3,
  },
  itemDetail: {
    fontSize: 14,
    color: '#555',
  },
  itemDate: {
    fontSize: 13,
    color: '#95a5a6',
    marginTop: 5,
    textAlign: 'right',
  },
  sectionListContent: {
    paddingBottom: 20,
  },
  // NEW: Styles for the custom separator
  separatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 25, // Space above and below the separator
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ccc', // Light gray line
    marginHorizontal: 10,
  },
  separatorText: {
    color: '#7f8c8d',
    fontSize: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  courseInfoContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});

export default CourseDetailScreen;
