import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker'; // For file picking
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import api from '../../../../lib/api'; // Adjust path as necessary
// Removed: import { useAuth } from '../../../context/AuthContext'; // No AuthContext

interface AssessmentDetail {
  id: number;
  course_id: number;
  title: string;
  description?: string;
  type: 'quiz' | 'exam' | 'assignment' | 'activity' | 'project' ; // Corrected types
  available_at?: string;
  unavailable_at?: string;
  max_attempts?: number;
  duration_minutes?: number;
  points: number;
  // Add other fields as needed
}

export default function AssessmentDetailsScreen() {
  const { id: courseId, assessmentId } = useLocalSearchParams();
  const router = useRouter();
  // Removed: const { user } = useAuth(); // No AuthContext

  const [assessmentDetail, setAssessmentDetail] = useState<AssessmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [submissionLoading, setSubmissionLoading] = useState(false);

  useEffect(() => {
    if (assessmentId) {
      fetchAssessmentDetails();
    }
  }, [assessmentId]);

  const fetchAssessmentDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/assessments/${assessmentId}`);
      if (response.status === 200) {
        // --- ADDED CONSOLE LOG HERE ---
        console.log("Fetched Assessment Details:", JSON.stringify(response.data.assessment, null, 2));
        setAssessmentDetail(response.data.assessment);
      } else {
        setError('Failed to fetch assessment details. Status: ' + response.status);
        Alert.alert('Error', 'Failed to fetch assessment details.');
      }
    } catch (err: any) {
      console.error('Failed to fetch assessment details:', err.response?.data || err.message);
      setError('Network error or unable to load assessment details.');
      Alert.alert('Error', error);
    } finally {
      setLoading(false);
    }
  };

  const isAssessmentAvailable = (assessment: AssessmentDetail) => {
    if (!assessment.available_at) return true;
    const availableDate = new Date(assessment.available_at);
    return new Date().getTime() >= availableDate.getTime();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*', // Allow all file types
        copyToCacheDirectory: true,
      });

      if (!result.canceled) {
        setSelectedFile(result.assets[0]);
      }
    } catch (err) {
      console.error('Document picking error:', err);
      Alert.alert('Error', 'Failed to pick document.');
    }
  };

  const handleStartQuizAttempt = async () => {
    if (!assessmentDetail) return;

    if (!isAssessmentAvailable(assessmentDetail)) {
      Alert.alert(
        'Not Yet Available',
        `This quiz will be available on ${formatDate(assessmentDetail.available_at)}.`
      );
      return;
    }

    setSubmissionLoading(true);
    try {
      // Call the new backend endpoint to start a quiz attempt
      // The backend will get the student_id from the authenticated user via Sanctum
      const response = await api.post(`/assessments/${assessmentDetail.id}/start-quiz-attempt`);

      if (response.status === 200 || response.status === 201) { // 200 for resuming, 201 for new
        Alert.alert('Success', response.data.message);
        // Navigate to the attempt-quiz screen, passing the submitted_assessment_id
        router.push({
          pathname: '/courses/assessments/[assessmentID]/attempt-quiz',
          params: { submittedAssessmentId: response.data.submitted_assessment.id },
        });
      } else {
        Alert.alert('Error', response.data.message || 'Failed to start quiz attempt.');
      }
    } catch (err: any) {
      console.error('Error starting quiz attempt:', err.response?.data || err.message);
      Alert.alert('Error', err.response?.data?.message || 'Failed to start quiz attempt due to network error.');
    } finally {
      setSubmissionLoading(false);
    }
  };

  const handleSubmitAssignment = async () => {
    if (!assessmentDetail) return;

    if (!isAssessmentAvailable(assessmentDetail)) {
      Alert.alert(
        'Not Yet Available',
        `This assignment will be available on ${formatDate(assessmentDetail.available_at)}.`
      );
      return;
    }

    if (!selectedFile) {
      // Use optional chaining for assessmentDetail.type
      Alert.alert(`No File Selected`, `Please select a file to upload for your ${assessmentDetail.type?.toLowerCase() || 'assessment'}.`);
      return;
    }

    setSubmissionLoading(true);
    try {
      const formData = new FormData();
      formData.append('assignment_file', {
        uri: selectedFile.uri,
        name: selectedFile.name,
        type: selectedFile.mimeType || 'application/octet-stream', // Use mimeType or fallback
      } as any); // Type assertion needed for FormData with file objects

      // The backend will get the student_id from the authenticated user via Sanctum
      const response = await api.post(`/assessments/${assessmentDetail.id}/submit-assignment`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.status === 200) {
        Alert.alert('Success', response.data.message || 'Assignment submitted successfully!');
        setSelectedFile(null); // Clear selected file after successful upload
        // You might want to refresh assessment details or navigate back
      } else {
        Alert.alert('Error', response.data.message || 'Failed to submit assignment.');
      }
    } catch (err: any) {
      console.error('Error submitting assignment:', err.response?.data || err.message);
      let errorMessage = 'Failed to submit assignment due to network error.';
      if (err.response?.data?.errors) {
        errorMessage = Object.values(err.response.data.errors).flat().join('\n');
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      }
      Alert.alert('Submission Error', errorMessage);
    } finally {
      setSubmissionLoading(false);
    }
  };

  const isAvailable = assessmentDetail ? isAssessmentAvailable(assessmentDetail) : false;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading assessment...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchAssessmentDetails}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!assessmentDetail) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>Assessment not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: assessmentDetail.title || 'Assessment Details' }} />
      <ScrollView contentContainerStyle={styles.scrollViewContent}>

        <View style={styles.sectionContainer}>
          <Text style={styles.assessmentTitle}>{assessmentDetail.title}</Text>
          {assessmentDetail.description && (
            <Text style={styles.assessmentDescription}>{assessmentDetail.description}</Text>
          )}
          <View style={styles.typeContainer}>
            <Ionicons name="clipboard-outline" size={18} color="#666" style={styles.icon} />
            {/* Added optional chaining and fallback for toUpperCase */}
            <Text style={styles.assessmentType}>{assessmentDetail.type || 'N/A'}</Text>
          </View>
        </View>

        {/* Details Section */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeader}>Details</Text>
          <View style={styles.detailRow}>
            <Ionicons name="timer-outline" size={18} color="#666" style={styles.icon} />
            <Text style={styles.detailText}>
              <Text style={styles.detailLabel}>Duration:</Text> {assessmentDetail.duration_minutes ? `${assessmentDetail.duration_minutes} minutes` : 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="checkbox-outline" size={18} color="#666" style={styles.icon} />
            <Text style={styles.detailText}>
              <Text style={styles.detailLabel}>Points:</Text> {assessmentDetail.points}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={18} color="#666" style={styles.icon} />
            <Text style={styles.detailText}>
              <Text style={styles.detailLabel}>Available From:</Text> {formatDate(assessmentDetail.available_at)}
            </Text>
          </View>
          {assessmentDetail.unavailable_at && (
            <View style={styles.detailRow}>
              <Ionicons name="close-circle-outline" size={18} color="#666" style={styles.icon} />
              <Text style={styles.detailText}>
                <Text style={styles.detailLabel}>Available Until:</Text> {formatDate(assessmentDetail.unavailable_at)}
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Ionicons name="repeat-outline" size={18} color="#666" style={styles.icon} />
            <Text style={styles.detailText}>
              <Text style={styles.detailLabel}>Max Attempts:</Text> {assessmentDetail.max_attempts ?? 'Unlimited'}
            </Text>
          </View>
        </View>

        {/* Action Section based on Assessment Type */}
        <View style={styles.sectionContainer}>
          {assessmentDetail.type === 'quiz' || assessmentDetail.type === 'exam' ? (
            // Quiz/Exam Type
            <TouchableOpacity
              style={[styles.actionButton, !isAvailable && styles.actionButtonDisabled]}
              onPress={handleStartQuizAttempt}
              disabled={!isAvailable || submissionLoading}
            >
              {submissionLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="play-circle-outline" size={24} color="#fff" style={styles.icon} />
                  <Text style={styles.actionButtonText}>
                    {isAvailable ? 'Attempt Now' : 'Quiz Not Yet Available'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            // Assignment, Activity, Project Types
            <View>
              <Text style={styles.sectionHeader}>Submit Assessment</Text>
              <TouchableOpacity
                style={styles.pickFileButton}
                onPress={handlePickDocument}
                disabled={!isAvailable || submissionLoading}
              >
                <Ionicons name="folder-open-outline" size={20} color="#007bff" />
                <Text style={styles.pickFileButtonText}>
                  {/* Added optional chaining and fallback */}
                  {selectedFile ? selectedFile.name : `Select ${assessmentDetail.type || 'assessment'} File`}
                </Text>
              </TouchableOpacity>
              {selectedFile && (
                <Text style={styles.selectedFileName}>Selected: {selectedFile.name}</Text>
              )}
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  (!isAvailable || !selectedFile || submissionLoading) && styles.actionButtonDisabled,
                ]}
                onPress={handleSubmitAssignment}
                disabled={!isAvailable || !selectedFile || submissionLoading}
              >
                {submissionLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={24} color="#fff" style={styles.icon} />
                    <Text style={styles.actionButtonText}>
                      {/* Added optional chaining and fallback */}
                      {isAvailable ? `Submit ${assessmentDetail.type || 'assessment'}` : `${assessmentDetail.type || 'assessment'} Not Yet Available`}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f2f5',
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
  scrollViewContent: {
    padding: 15,
    paddingBottom: 30,
  },
  sectionContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  assessmentTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: 5,
    textAlign: 'center',
  },
  assessmentDescription: {
    fontSize: 15,
    color: '#555',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 10,
  },
  typeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  assessmentType: {
    fontSize: 15,
    color: '#666',
    fontWeight: '600',
    textTransform: 'uppercase',
    marginLeft: 5,
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 5,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  icon: {
    marginRight: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#666',
  },
  detailLabel: {
    fontWeight: 'bold',
    color: '#333',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#28a745', // Green for action
    borderRadius: 8,
    padding: 15,
    justifyContent: 'center',
    marginTop: 10,
  },
  actionButtonDisabled: {
    backgroundColor: '#cccccc',
    opacity: 0.7,
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 5,
  },
  pickFileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ced4da',
  },
  pickFileButtonText: {
    fontSize: 15,
    color: '#007bff',
    marginLeft: 10,
  },
  selectedFileName: {
    fontSize: 13,
    color: '#555',
    marginTop: 8,
    textAlign: 'center',
  },
});