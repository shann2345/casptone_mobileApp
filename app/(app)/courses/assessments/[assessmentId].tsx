// app/(app)/courses/assessments/[assessmentId].tsx
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'; // Import useRouter
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import api from '../../../../lib/api';

interface AssessmentDetail {
  id: number;
  title: string;
  description?: string;
  type: 'quiz' | 'exam' | 'assignment' | 'activity' | 'project' | 'other';
  assessment_file_path?: string;
  duration_minutes?: number;
  // access_code is no longer needed here as it's handled in [id].tsx
  available_at?: string;
  unavailable_at?: string;
  // questions are no longer fetched/rendered here for quiz/exam types
}

export default function AssessmentDetailsScreen() {
  const { id: courseId, assessmentId } = useLocalSearchParams();
  const router = useRouter(); // Initialize useRouter
  const [assessmentDetail, setAssessmentDetail] = useState<AssessmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);

  // Removed: showAccessCodeModal, enteredAccessCode, accessGranted states

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
        console.log("API Response for Assessment Details (AssessmentId.tsx):", JSON.stringify(response.data, null, 2));
        if (response.data && response.data.assessment) {
          setAssessmentDetail(response.data.assessment);
          // Removed: Access code logic here
        } else {
          const errorMessage = 'Received unexpected data format from API.';
          setError(errorMessage);
          Alert.alert('Error', errorMessage);
        }
      } else {
        const errorMessage = response.data?.message || 'Failed to fetch assessment details.';
        setError(errorMessage);
        Alert.alert('Error', errorMessage);
      }
    } catch (err: any) {
      console.error("Error fetching assessment details:", err);
      const errorMessage = err.response?.data?.message || 'An unexpected error occurred.';
      setError(errorMessage);
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadAssessmentFile = async () => {
    if (!assessmentDetail?.assessment_file_path) {
      Alert.alert('Error', 'No file available for download.');
      return;
    }

    setIsDownloading(true);
    try {
      const fileUrl = api.defaults.baseURL + '/assessments/' + assessmentDetail.id + '/download';
      const fileName = assessmentDetail.title.replace(/[^a-z0-9]/gi, '_') + '_assessment.' + assessmentDetail.assessment_file_path.split('.').pop();
      const downloadPath = FileSystem.documentDirectory + fileName;

      const authToken = api.defaults.headers.common['Authorization'] as string | undefined;
      let authorizationHeader = '';
      if (authToken && typeof authToken === 'string' && authToken.startsWith('Bearer ')) {
        authorizationHeader = authToken;
      } else {
        console.warn('Authorization token not found or incorrectly formatted for download.');
        Alert.alert('Authentication Error', 'You are not logged in or your session has expired. Please log in again.');
        setIsDownloading(false);
        return;
      }

      const { uri } = await FileSystem.downloadAsync(fileUrl, downloadPath, {
        headers: {
          'Authorization': authorizationHeader,
        },
      });

      Alert.alert('Download Complete', `File saved to: ${uri}`);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        Alert.alert(
          'Open File',
          'Do you want to open the downloaded file?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open', onPress: async () => { await Sharing.shareAsync(uri); } },
          ],
          { cancelable: true }
        );
      }
    } catch (e: any) {
      console.error('Download error:', e);
      Alert.alert('Download Failed', 'Could not download the file. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*', // Allow all file types
        copyToCacheDirectory: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedFile(result.assets[0]);
      } else {
        setSelectedFile(null);
      }
    } catch (err) {
      console.error('Error picking document:', err);
      Alert.alert('Error', 'Failed to pick a file.');
    }
  };

  const handleSubmitAnswer = async () => {
    if (!selectedFile) {
      Alert.alert('No file selected', 'Please select a file to upload as your answer.');
      return;
    }

    if (!assessmentDetail?.id) {
      Alert.alert('Error', 'Assessment ID not found. Cannot submit.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('submission_file', {
      uri: selectedFile.uri,
      name: selectedFile.name,
      type: selectedFile.mimeType || 'application/octet-stream',
    } as any);

    try {
      const response = await api.post(`/assessments/${assessmentDetail.id}/submit`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.status === 200) {
        Alert.alert('Success', 'Your answer has been submitted successfully!');
        setSelectedFile(null);
      } else {
        const errorMessage = response.data?.message || 'Failed to upload submission.';
        Alert.alert('Upload Failed', errorMessage);
      }
    } catch (err: any) {
      console.error('Submission upload error:', err);
      const errorMessage = err.response?.data?.message || 'An unexpected error occurred during upload.';
      Alert.alert('Upload Failed', errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const handleAttemptQuizExam = () => {
    if (assessmentDetail?.id) {
      router.push(`/courses/assessments/${assessmentDetail.id}/attempt-quiz`); // Navigate to the new quiz screen
    } else {
      Alert.alert('Error', 'Assessment ID is missing.');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading assessment details...</Text>
      </View>
    );
  }

  if (error || !assessmentDetail) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error || 'Assessment not found.'}</Text>
        <TouchableOpacity onPress={fetchAssessmentDetails} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isQuizExamType = ['quiz', 'exam'].includes(assessmentDetail.type);
  const isAssignmentType = ['assignment', 'activity', 'project'].includes(assessmentDetail.type);


  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollViewContent}>
      <Stack.Screen options={{ title: assessmentDetail.title }} />

      <View style={styles.card}>
        <Text style={styles.title}>{assessmentDetail.title}</Text>
        <Text style={styles.assessmentType}>Type: {assessmentDetail.type.charAt(0).toUpperCase() + assessmentDetail.type.slice(1)}</Text>
        {assessmentDetail.description && (
          <Text style={styles.description}>{assessmentDetail.description}</Text>
        )}

        {assessmentDetail.duration_minutes && (
          <Text style={styles.infoText}>
            Duration: {assessmentDetail.duration_minutes} minutes
          </Text>
        )}
        {assessmentDetail.available_at && (
          <Text style={styles.infoText}>
            Available From: {new Date(assessmentDetail.available_at).toLocaleString()}
          </Text>
        )}
        {assessmentDetail.unavailable_at && (
          <Text style={styles.infoText}>
            Available Until: {new Date(assessmentDetail.unavailable_at).toLocaleString()}
          </Text>
        )}

        {isQuizExamType ? (
          // Display for Quiz/Exam types - only details and "Attempt Now" button
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Ready to start?</Text>
            <Text style={styles.quizInstructions}>
              This {assessmentDetail.type} contains multiple-choice and/or essay questions. Ensure you have a stable internet connection before starting.
              {assessmentDetail.duration_minutes && ` You will have ${assessmentDetail.duration_minutes} minutes to complete it.`}
            </Text>
            <TouchableOpacity onPress={handleAttemptQuizExam} style={styles.attemptButton}>
              <Ionicons name="play-circle-outline" size={24} color="#fff" />
              <Text style={styles.attemptButtonText}>Attempt Now</Text>
            </TouchableOpacity>
          </View>
        ) : isAssignmentType ? (
          // Display for Assignment/Activity/Project types - download/upload
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Assessment File</Text>
            {assessmentDetail.assessment_file_path ? (
              <TouchableOpacity
                onPress={handleDownloadAssessmentFile}
                style={styles.downloadButton}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="download" size={24} color="#fff" />
                    <Text style={styles.downloadButtonText}>Download Assessment</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <Text style={styles.noFileText}>No file provided for this assessment.</Text>
            )}

            <Text style={[styles.sectionHeader, { marginTop: 20 }]}>Submit Your Answer</Text>
            <TouchableOpacity onPress={handlePickFile} style={styles.pickFileButton}>
              <Ionicons name="attach" size={20} color="#007bff" />
              <Text style={styles.pickFileButtonText}>
                {selectedFile ? selectedFile.name : 'Select File'}
              </Text>
            </TouchableOpacity>
            {selectedFile && (
              <Text style={styles.selectedFileName}>Selected: {selectedFile.name}</Text>
            )}
            <TouchableOpacity
              onPress={handleSubmitAnswer}
              style={styles.submitButton}
              disabled={isUploading || !selectedFile}
            >
              {isUploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Upload Answer</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
            // For 'other' types or unhandled types, just show a message
            <Text style={styles.infoText}>This assessment type does not have specific actions here.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollViewContent: {
    padding: 20,
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
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
    backgroundColor: '#f8f9fa',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: '#dc3545',
    textAlign: 'center',
    marginBottom: 20,
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
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 25,
    width: '100%',
    maxWidth: 700,
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
    marginBottom: 10,
    textAlign: 'center',
  },
  assessmentType: {
    fontSize: 16,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 15,
  },
  description: {
    fontSize: 16,
    color: '#555',
    marginBottom: 20,
    lineHeight: 24,
  },
  infoText: { // Re-purposed for general info text
    fontSize: 16,
    color: '#555',
    marginBottom: 8,
    textAlign: 'center',
  },
  sectionContainer: {
    marginTop: 20,
    width: '100%',
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 5,
    textAlign: 'center',
  },
  quizInstructions: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
    marginBottom: 20,
    textAlign: 'center',
  },
  attemptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007bff', // Blue for attempt button
    borderRadius: 8,
    padding: 15,
    justifyContent: 'center',
    marginTop: 20,
  },
  attemptButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#28a745', // Green for download
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    justifyContent: 'center',
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  noFileText: {
    fontSize: 16,
    color: '#777',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 20,
  },
  pickFileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e9ecef',
    borderColor: '#ced4da',
    borderWidth: 1,
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    justifyContent: 'center',
  },
  pickFileButtonText: {
    color: '#007bff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  selectedFileName: {
    fontSize: 14,
    color: '#555',
    marginBottom: 10,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: '#007bff',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});