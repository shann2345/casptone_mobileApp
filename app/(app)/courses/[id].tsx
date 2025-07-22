import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, SectionList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'; // Import Modal and TextInput
import api from '../../../lib/api'; // Adjust path if needed

// Define interfaces for detailed course data
interface Material {
  id: number;
  title: string;
  file_path?: string; // Optional if not all materials have files
  content?: string; // Optional if materials can be text content
  type: 'material'; // Explicitly type for easier rendering
  created_at: string; // Changed from createdAt to created_at to match Laravel's default
  available_at?: string; // This property is key for your current issue
  isNested?: boolean; // Added for styling differentiation
}

interface Assessment {
  id: number;
  title: string;
  type: 'assessment'; // Explicitly type for easier rendering
  created_at: string; // Changed from createdAt to created_at to match Laravel's default
  available_at?: string;
  access_code?: string;
  isNested?: boolean; // Added for styling differentiation
}

interface Topic {
  id: number;
  title: string; // Changed from 'name' to 'title' to align with combined items from backend
  description?: string;
  materials: Material[]; // Materials belong to topics
  assessments: Assessment[]; // Assessments can belong to topics
  type: 'topic'; // Explicitly type for easier rendering
  created_at: string; // Changed from createdAt to created_at to match Laravel's default
  isNested?: boolean; // Topics are not nested at the top level, but included for type consistency
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
  sorted_content: CourseItem[];
}

export default function CourseDetailsScreen() {
  const { id: courseId } = useLocalSearchParams(); 
  const [courseDetail, setCourseDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // State for Access Code Modal
  const [isAccessCodeModalVisible, setAccessCodeModalVisible] = useState(false);
  const [currentAssessment, setCurrentAssessment] = useState<Assessment | null>(null);
  const [enteredAccessCode, setEnteredAccessCode] = useState('');
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (courseId) {
      fetchCourseDetails();
    }
  }, [courseId]);

  const fetchCourseDetails = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/courses/${courseId}`);
      if (response.status === 200) {
        console.log("API Response for Course Details:", JSON.stringify(response.data, null, 2));
        setCourseDetail(response.data.course);
      } else {
        Alert.alert('Error', 'Failed to fetch course details.');
      }
    } catch (error) {
      console.error('Failed to fetch course details:', error);
      Alert.alert('Error', 'Network error or unable to load course details.');
    } finally {
      setLoading(false);
    }
  };

  const handleAccessCodeSubmit = () => {
    setAccessCodeError(null); // Clear previous errors

    if (!currentAssessment || !currentAssessment.access_code) {
      setAccessCodeError("No access code defined for this assessment.");
      return;
    }
    if (enteredAccessCode === currentAssessment.access_code) { // Simulating correct code
      setAccessCodeModalVisible(false);
      setEnteredAccessCode(''); // Clear input
      router.push("/settings");
    } else {
      setAccessCodeError('Incorrect access code. Please try again.');
    }
  };


  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Loading course details...</Text>
      </View>
    );
  }

  if (!courseDetail) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Course not found or an error occurred.</Text>
      </View>
    );
  }

  // --- Rendering Logic using sorted_content ---
  // If you want a single section for all content:
  const sectionsData = [{
    title: 'Course Content',
    data: courseDetail.sorted_content,
  }];

  const renderItem = ({ item }: { item: CourseItem }) => {
    // Helper to format date
    const formatDate = (dateString: string) => {
      const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
      return new Date(dateString).toLocaleDateString(undefined, options);
    };

    // Helper to check if an item is available
    const isAvailable = (item: Material | Assessment) => {
      if ('available_at' in item && item.available_at) {
        const availableDate = new Date(item.available_at);
        const now = new Date();
        return now >= availableDate;
      }
      return true; // If no available_at date, consider it always available
    };

    if (item.type === 'topic') {
      const topic = item as Topic;
      return (
        <View style={styles.topicCard}>
          <Text style={styles.topicTitle}>{topic.title}</Text>

          {(topic.materials.length > 0 || topic.assessments.length > 0) && (
            <View style={styles.nestedItemsContainer}>
              {topic.materials.map(material => {
                const available = isAvailable(material);
                const opacityStyle = available ? {} : { opacity: 0.5 }; // Reduce opacity if not available
                const disabled = !available; // Disable touch if not available

                return (
                  <TouchableOpacity
                    key={material.id}
                    style={[styles.itemCardNested, opacityStyle]}
                    onPress={() => {
                      if (!disabled) {
                        router.push(`/courses/materials/${material.id}`);
                      } else {
                        Alert.alert('Not Available Yet', `This material will be available on ${formatDate(material.available_at!)}.`);
                      }
                    }}
                    disabled={disabled}
                  >
                    <Text style={styles.itemTitleNested}>{material.title}</Text>
                    <Text style={styles.itemTypeNested}>Material {available ? '' : '(Not Available Yet)'}</Text>
                    {material.content && <Text style={styles.itemDetailNested}>{material.content.substring(0, 100)}...</Text>}
                    {material.file_path && <Text style={styles.itemDetailNested}>File: {material.file_path.split('/').pop()}</Text>}
                    {material.available_at && !available && (
                      <Text style={styles.itemDateNested}>Available: {formatDate(material.available_at)}</Text>
                    )}
                    <Text style={styles.itemDateNested}>Created: {formatDate(material.created_at)}</Text>
                  </TouchableOpacity>
                );
              })}
              {topic.assessments.map(assessment => {
                const available = isAvailable(assessment);
                const opacityStyle = available ? {} : { opacity: 0.5 };
                const disabled = !available;

                return (
                  <TouchableOpacity
                    key={assessment.id}
                    style={[styles.itemCardNested, opacityStyle]}
                    onPress={() => {
                      if (!disabled) {
                        if (assessment.access_code) {
                          setCurrentAssessment(assessment);
                          setAccessCodeModalVisible(true);
                        } else {
                          router.push(`/settings`);
                        }
                      } else {
                        Alert.alert('Not Available Yet', `This assessment will be available on ${formatDate(assessment.available_at!)}.`);
                      }
                    }}
                    disabled={disabled}
                  >
                    <Text style={styles.itemTitleNested}>{assessment.title}</Text>
                    <Text style={styles.itemTypeNested}>
                      Assessment {available ? '' : '(Not Available Yet)'}
                      {assessment.access_code ? ' (Code Required)' : ''}
                    </Text>
                    {assessment.available_at && !available && (
                      <Text style={styles.itemDateNested}>Available: {formatDate(assessment.available_at)}</Text>
                    )}
                    <Text style={styles.itemDateNested}>Created: {formatDate(assessment.created_at)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      );
    } else if (item.type === 'material') {
      const material = item as Material;
      const available = isAvailable(material);
      const opacityStyle = available ? {} : { opacity: 0.5 };
      const disabled = !available;

      return (
        <TouchableOpacity
          style={[styles.itemCard, opacityStyle]}
          onPress={() => {
            if (!disabled) {
              // Navigate to the new material details screen
              // Make sure 'id' (course ID) is available from useLocalSearchParams
              router.push(`/courses/materials/${material.id}`);
            } else {
              Alert.alert('Not Available Yet', `This material will be available on ${formatDate(material.available_at!)}.`);
            }
          }}
          disabled={disabled}
        >
          <Text style={styles.itemTitle}>{material.title}</Text>
          <Text style={styles.itemType}>Material (Independent) {available ? '' : '(Not Available Yet)'}</Text>
          {material.content && <Text style={styles.itemDetail}>{material.content.substring(0, 150)}...</Text>}
          {material.file_path && <Text style={styles.itemDetail}>File: {material.file_path.split('/').pop()}</Text>}
          {material.available_at && !available && (
            <Text style={styles.itemDate}>Available: {formatDate(material.available_at)}</Text>
          )}
          <Text style={styles.itemDate}>Created: {formatDate(material.created_at)}</Text>
        </TouchableOpacity>
      );
    } else if (item.type === 'assessment') {
      const assessment = item as Assessment;
      const available = isAvailable(assessment);
      const opacityStyle = available ? {} : { opacity: 0.5 };
      const disabled = !available;

      return (
        <TouchableOpacity
          style={[styles.itemCard, opacityStyle]}
          onPress={() => {
            if (!disabled) {
              if (assessment.access_code) {
                setCurrentAssessment(assessment);
                setAccessCodeModalVisible(true);
              } else {
                router.push(`/settings`);
              }
            } else {
              Alert.alert('Not Available Yet', `This assessment will be available on ${formatDate(assessment.available_at!)}.`);
            }
          }}
          disabled={disabled}
        >
          <Text style={styles.itemTitle}>{assessment.title}</Text>
          <Text style={styles.itemType}>
            Assessment (Independent) {available ? '' : '(Not Available Yet)'}
            {assessment.access_code ? ' (Code Required)' : ''}
          </Text>
          {assessment.available_at && !available && (
            <Text style={styles.itemDate}>Available: {formatDate(assessment.available_at)}</Text>
          )}
          <Text style={styles.itemDate}>Created: {formatDate(assessment.created_at)}</Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: courseDetail.title }} />
      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        <View style={styles.headerContainer}>
          <Text style={styles.courseTitle}>{courseDetail.title}</Text>
          <View style={styles.detailRow}>
            <Text style={styles.label}>{courseDetail.instructor.name} ({courseDetail.instructor.email})</Text>
          </View>
        </View>

        <SectionList
          sections={sectionsData}
          keyExtractor={(item, index) => `${item.type}-${item.id}-${index}`}
          renderItem={renderItem}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{title}</Text>
            </View>
          )}
          contentContainerStyle={styles.sectionListContent}
          // Optional: Remove scrollEnabled on SectionList if ScrollView handles it
          scrollEnabled={false}
        />
      </ScrollView>

      {/* Access Code Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isAccessCodeModalVisible}
        onRequestClose={() => {
          setAccessCodeModalVisible(!isAccessCodeModalVisible);
          setEnteredAccessCode(''); // Clear input on close
          setAccessCodeError(null); // Clear error on close
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Access Code</Text>
            {currentAssessment && (
              <Text style={styles.modalAssessmentTitle}>for "{currentAssessment.title}"</Text>
            )}
            <TextInput
              style={styles.input}
              placeholder="Access Code"
              value={enteredAccessCode}
              onChangeText={setEnteredAccessCode}
              secureTextEntry // Hide the input for sensitive codes
              autoCapitalize="none"
            />
            {accessCodeError && <Text style={styles.errorTextModal}>{accessCodeError}</Text>}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={() => {
                  setAccessCodeModalVisible(false);
                  setEnteredAccessCode(''); // Clear input
                  setAccessCodeError(null); // Clear error
                }}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.submitButton]}
                onPress={handleAccessCodeSubmit}
              >
                <Text style={styles.buttonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollViewContent: {
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#333',
  },
  errorText: {
    fontSize: 18,
    color: 'red',
    textAlign: 'center',
    marginTop: 50,
  },
  headerContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  courseTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: 5,
  },
  courseCode: {
    fontSize: 18,
    color: '#555',
    marginBottom: 10,
  },
  description: {
    fontSize: 16,
    color: '#333',
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
  // Styles for Topic Card
  topicCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    marginTop: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  topicTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#007bff', // Highlight topic titles
    marginBottom: 5,
  },
  topicDescription: {
    fontSize: 15,
    color: '#555',
    marginBottom: 10,
  },
  // Styles for Independent Material/Assessment Cards
  itemCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    marginTop: 5,
    borderColor: '#696868ff',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1.5,
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

  // Styles for Nested Items (Material/Assessment within Topic)
  nestedItemsContainer: {
    marginTop: 15,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#d1e0f0', // Lighter blue for nesting
  },
  itemCardNested: {
    backgroundColor: '#f8f8f8', // Slightly different background for nested items
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 15,
    marginBottom: 8,
    marginTop: 4,
    borderColor: '#696868ff',
    borderWidth: 1, // Add a subtle border
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  itemTitleNested: {
    fontSize: 16,
    fontWeight: '600',
    color: '#34495e',
    marginBottom: 3,
  },
  itemTypeNested: {
    fontSize: 13,
    color: '#6c7a89',
    fontStyle: 'italic',
    marginBottom: 3,
  },
  itemDetailNested: {
    fontSize: 13,
    color: '#555',
  },
  itemDateNested: {
    fontSize: 12,
    color: '#95a5a6',
    marginTop: 3,
    textAlign: 'right',
  },
  sectionListContent: {
    paddingBottom: 20,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // Dim background
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 25,
    width: '80%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  modalAssessmentTitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
    color: '#333',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 10,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  submitButton: {
    backgroundColor: '#007bff',
  },
  cancelButton: {
    backgroundColor: '#6c757d',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorTextModal: {
    color: 'red',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
});