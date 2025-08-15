// [assessmentId].tsx
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../../../context/NetworkContext';
import api, { getUserData } from '../../../../lib/api';
import { getAssessmentDetailsFromDb, saveAssessmentDetailsToDb, saveAssessmentsToDb } from '../../../../lib/localDb'; // Updated import

interface AssessmentDetail {
  id: number;
  course_id: number;
  title: string;
  description?: string;
  type: 'quiz' | 'exam' | 'assignment' | 'activity' | 'project';
  available_at?: string;
  unavailable_at?: string;
  max_attempts?: number;
  duration_minutes?: number;
  assessment_file_path?: string | null;
  assessment_file_url?: string | null; // Added this property
  points: number;
}

interface AttemptStatus {
  max_attempts: number | null;
  attempts_made: number;
  attempts_remaining: number | null;
  can_start_new_attempt: boolean;
  has_in_progress_attempt: boolean;
  in_progress_submitted_assessment_id: number | null;
}

interface LatestAssignmentSubmission {
  has_submitted_file: boolean;
  submitted_file_path: string | null;
  submitted_file_url: string | null;
  submitted_file_name: string | null;
  original_filename: string | null;
  submitted_at: string | null;
  status: string | null;
}

export default function AssessmentDetailsScreen() {
  const { id: courseId, assessmentId } = useLocalSearchParams();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();

  const [assessmentDetail, setAssessmentDetail] = useState<AssessmentDetail | null>(null);
  const [attemptStatus, setAttemptStatus] = useState<AttemptStatus | null>(null);
  const [latestAssignmentSubmission, setLatestAssignmentSubmission] = useState<LatestAssignmentSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [submissionLoading, setSubmissionLoading] = useState(false);

  const fetchAssessmentDetailsAndAttemptStatus = useCallback(async () => {
    if (!assessmentId) return;

    setLoading(true);
    setError(null);

    const user = await getUserData();
    const userEmail = user?.email;
    if (!userEmail) {
      setError('User not logged in.');
      setLoading(false);
      return;
    }

    try {
      if (isConnected) {
        // ONLINE MODE
        console.log('✅ Online: Fetching assessment details from API.');
        const assessmentResponse = await api.get(`/assessments/${assessmentId}`);
        if (assessmentResponse.status === 200) {
          console.log("API Response for Assessment Details:", JSON.stringify(assessmentResponse.data, null, 2));
          const fetchedAssessment = assessmentResponse.data.assessment;
          setAssessmentDetail(fetchedAssessment);

          let newAttemptStatus: AttemptStatus | null = null;
          let newLatestSubmission: LatestAssignmentSubmission | null = null;
          
          // Fetch attempt status and latest submission only if online
          if (fetchedAssessment.type === 'quiz' || fetchedAssessment.type === 'exam') {
            const attemptStatusResponse = await api.get(`/assessments/${assessmentId}/attempt-status`);
            if (attemptStatusResponse.status === 200) {
              newAttemptStatus = attemptStatusResponse.data;
              setAttemptStatus(newAttemptStatus);
            } else {
              setError('Failed to fetch attempt status.');
            }
          } else {
            setAttemptStatus(null);
          }

          if (['assignment', 'activity', 'project'].includes(fetchedAssessment.type)) {
            const assignmentSubmissionResponse = await api.get(`/assessments/${assessmentId}/latest-assignment-submission`);
            if (assignmentSubmissionResponse.status === 200) {
              newLatestSubmission = assignmentSubmissionResponse.data;
              setLatestAssignmentSubmission(newLatestSubmission);
              // ... (file handling logic remains the same)
            } else {
              setError('Failed to fetch latest assignment submission.');
            }
          } else {
            setLatestAssignmentSubmission(null);
            setSelectedFile(null);
          }
          
          // Save the fetched data to local DB
          await saveAssessmentsToDb([fetchedAssessment], parseInt(courseId as string), userEmail);
          await saveAssessmentDetailsToDb(
            fetchedAssessment.id,
            userEmail,
            newAttemptStatus,
            newLatestSubmission
          );
          
        } else {
          setError('Failed to fetch assessment details.');
        }
      } else {
        // OFFLINE MODE
        console.log('⚠️ Offline: Fetching assessment details from local DB.');
        const offlineAssessment = await getAssessmentDetailsFromDb(assessmentId as string, userEmail);
        if (offlineAssessment) {
          // The returned object now includes the additional data
          setAssessmentDetail(offlineAssessment as AssessmentDetail);
          setAttemptStatus(offlineAssessment.attemptStatus);
          setLatestAssignmentSubmission(offlineAssessment.latestSubmission);
          setSelectedFile(null);
        } else {
          setError('Offline: Assessment details not available locally.');
          Alert.alert('Offline Mode', 'Assessment details not found in local storage. Please connect to the internet to load.');
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch assessment details/status/submission:', err.response?.data || err.message);
      setError('Network error or unable to load assessment details/status/submission.');
      if (!isConnected) {
         Alert.alert('Error', 'Failed to load assessment details from local storage.');
      } else {
         Alert.alert('Error', 'Failed to fetch assessment details/status/submission.');
      }
    } finally {
      setLoading(false);
    }
  }, [assessmentId, isConnected]);

  useFocusEffect(
    useCallback(() => {
      fetchAssessmentDetailsAndAttemptStatus();
    }, [fetchAssessmentDetailsAndAttemptStatus])
  );

  const isAssessmentAvailable = (assessment: AssessmentDetail) => {
    if (!assessment.available_at) return true;
    const availableDate = new Date(assessment.available_at);
    return new Date().getTime() >= availableDate.getTime();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
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

  const handleDownloadSubmittedFile = async (fileUrl: string) => {
    try {
      await Linking.openURL(fileUrl);
    } catch (error) {
      console.error('Error opening file:', error);
      Alert.alert('Error', 'Could not open the submitted file.');
    }
  };

  // New handler for downloading the instructor's assessment file
  const handleDownloadAssessmentFile = async (fileUrl: string) => {
    try {
      await Linking.openURL(fileUrl);
    } catch (error) {
      console.error('Error opening assessment file:', error);
      Alert.alert('Error', 'Could not open the assessment file.');
    }
  };

  const handleStartQuizAttempt = async () => {
    if (!assessmentDetail) return;
    
    if (!isConnected) {
       Alert.alert('Offline Mode', 'You must be online to start a quiz or exam attempt.');
       return;
    }

    if (!isAssessmentAvailable(assessmentDetail)) {
      Alert.alert(
        'Not Yet Available',
        `This quiz will be available on ${formatDate(assessmentDetail.available_at)}.`
      );
      return;
    }

    if (attemptStatus && !attemptStatus.has_in_progress_attempt && !attemptStatus.can_start_new_attempt) {
      Alert.alert(
        'Attempt Limit Reached',
        `You have used all ${attemptStatus.max_attempts} attempts for this ${assessmentDetail.type}.`
      );
      return;
    }

    setSubmissionLoading(true);
    try {
      const response = await api.post(`/assessments/${assessmentDetail.id}/start-quiz-attempt`);

      if (response.status === 200 || response.status === 201) {
        const submittedAssessment = response.data.submitted_assessment;
        Alert.alert('Success', response.data.message, [
          {
            text: 'Start Quiz',
            onPress: () => {
              router.push({
                pathname: '/courses/assessments/[assessmentId]/attempt-quiz',
                params: { 
                  assessmentId: assessmentDetail.id.toString(),
                  submittedAssessmentId: submittedAssessment.id.toString()
                },
              });
            }
          }
        ]);
        console.log("API Response for Quiz type attempt Submission:", JSON.stringify(response.data, null, 2));
        
      } else {
        Alert.alert('Error', response.data.message || 'Failed to start quiz attempt.');
      }
    } catch (err: any) {
      console.error('Error starting quiz attempt:', err.response?.data || err.message);
      Alert.alert('Error', err.response?.data?.message || 'Failed to start quiz attempt due to network error.');
    } finally {
      setSubmissionLoading(false);
      fetchAssessmentDetailsAndAttemptStatus();
    }
  };

  const handleSubmitAssignment = async () => {
    if (!assessmentDetail) return;

    if (!isConnected) {
      Alert.alert('Offline Mode', 'You must be online to submit an assignment.');
      return;
    }

    if (!isAssessmentAvailable(assessmentDetail)) {
      Alert.alert(
        'Not Yet Available',
        `This assignment will be available on ${formatDate(assessmentDetail.available_at)}.`
      );
      return;
    }

    if (!selectedFile) {
      Alert.alert(
        `No File Selected`, 
        `Please select a file to upload for your ${assessmentDetail.type?.toLowerCase() || 'assessment'}.`
      );
      return;
    }

    console.log('Selected file details for submission:', {
      name: selectedFile.name,
      uri: selectedFile.uri,
      mimeType: selectedFile.mimeType,
      size: selectedFile.size
    });

    setSubmissionLoading(true);
    try {
      const formData = new FormData();
      formData.append('assignment_file', {
        uri: selectedFile.uri,
        name: selectedFile.name,
        type: selectedFile.mimeType || 'application/octet-stream',
      } as any);

      console.log('Submitting assignment with FormData');

      const response = await api.post(`/assessments/${assessmentDetail.id}/submit-assignment`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      console.log('Assignment submission response:', response.data);

      if (response.status === 200) {
        Alert.alert('Success', response.data.message || 'Assignment submitted successfully!');
        setSelectedFile(null); // Clear selected file after successful submission
        
        await fetchAssessmentDetailsAndAttemptStatus();
      } else {
        Alert.alert('Error', response.data.message || 'Failed to submit assignment.');
      }
    } catch (err: any) {
      console.error('Error submitting assignment:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status
      });
      
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

  let isQuizAttemptButtonDisabled = !isAvailable || submissionLoading || !isConnected;
  let quizButtonText = 'Start Quiz';

  if (assessmentDetail && (assessmentDetail.type === 'quiz' || assessmentDetail.type === 'exam') && attemptStatus) {
    if (attemptStatus.has_in_progress_attempt) {
      quizButtonText = 'Resume Quiz';
      isQuizAttemptButtonDisabled = submissionLoading;
    } else if (!isAvailable) {
      quizButtonText = 'Quiz Not Yet Available';
      isQuizAttemptButtonDisabled = true;
    } else if (!attemptStatus.can_start_new_attempt) {
      quizButtonText = 'Attempt Limit Reached';
      isQuizAttemptButtonDisabled = true;
    }
  } else if (!isAvailable) {
    quizButtonText = 'Quiz Not Yet Available';
    isQuizAttemptButtonDisabled = true;
  }
  
  if (!isConnected) {
    isQuizAttemptButtonDisabled = true;
    if (assessmentDetail?.type === 'quiz' || assessmentDetail?.type === 'exam') {
      quizButtonText = 'Online Required to Start Quiz';
    }
  }


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
        <TouchableOpacity style={styles.retryButton} onPress={fetchAssessmentDetailsAndAttemptStatus}>
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

  const isAssignmentType = ['assignment', 'activity', 'project'].includes(assessmentDetail.type);

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
          {/* Display current attempt status for quizzes/exams */}
          {(assessmentDetail.type === 'quiz' || assessmentDetail.type === 'exam') && attemptStatus && (
            <>
              <View style={styles.detailRow}>
                <Ionicons name="checkmark-done-circle-outline" size={18} color="#666" style={styles.icon} />
                <Text style={styles.detailText}>
                  <Text style={styles.detailLabel}>Attempts Made:</Text> {attemptStatus.attempts_made}
                </Text>
              </View>
              {attemptStatus.max_attempts !== null && (
                <View style={styles.detailRow}>
                  <Ionicons name="hourglass-outline" size={18} color="#666" style={styles.icon} />
                  <Text style={styles.detailText}>
                    <Text style={styles.detailLabel}>Attempts Remaining:</Text> {attemptStatus.attempts_remaining}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* Instructor's Assessment File Section (for Assignment types) */}
        {isAssignmentType && assessmentDetail.assessment_file_url && (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionHeader}>Assessment File</Text>
                <TouchableOpacity 
                    onPress={() => assessmentDetail.assessment_file_url && handleDownloadAssessmentFile(assessmentDetail.assessment_file_url)}
                    style={styles.downloadFileButton}
                    disabled={!isConnected}
                >
                    <Ionicons name="download-outline" size={20} color={isConnected ? "#007bff" : "#666"} />
                    <Text style={[styles.downloadFileButtonText, !isConnected && { color: '#666' }]}>
                        Download Assignment Instructions
                    </Text>
                </TouchableOpacity>
                {!isConnected && <Text style={styles.offlineWarning}>Must be online to download file.</Text>}
            </View>
        )}

        {/* Action Section based on Assessment Type */}
        <View style={styles.sectionContainer}>
          {isAssignmentType ? (
            // Assignment, Activity, Project Types
            <View>
              <Text style={styles.sectionHeader}>Submit Assessment</Text>
              
              {!isConnected && (
                  <Text style={[styles.offlineWarning, { textAlign: 'center', marginBottom: 10 }]}>
                    Submission is disabled in offline mode.
                  </Text>
              )}

              {latestAssignmentSubmission?.has_submitted_file && (
                <View style={styles.submittedFileContainer}>
                  <Text style={styles.submittedFileLabel}>Previously Submitted File:</Text>
                  <TouchableOpacity 
                    onPress={() => latestAssignmentSubmission.submitted_file_url && handleDownloadSubmittedFile(latestAssignmentSubmission.submitted_file_url)}
                    style={styles.downloadFileButton}
                    disabled={!isConnected}
                  >
                    <Ionicons name="document-text-outline" size={20} color={isConnected ? "#007bff" : "#666"} />
                    <Text style={[styles.downloadFileButtonText, !isConnected && { color: '#666' }]}>
                      {latestAssignmentSubmission.original_filename || 
                      latestAssignmentSubmission.submitted_file_name || 
                      'Unknown File'}
                    </Text>
                  </TouchableOpacity>
                  {latestAssignmentSubmission.submitted_at && (
                    <Text style={styles.submittedAtText}>
                      Submitted on: {formatDate(latestAssignmentSubmission.submitted_at)}
                    </Text>
                  )}
                  {latestAssignmentSubmission.status && (
                    <Text style={styles.submittedStatusText}>
                      Status: {latestAssignmentSubmission.status.replace('_', ' ')}
                    </Text>
                  )}
                  {!isConnected && <Text style={styles.offlineWarning}>Must be online to view/download submission.</Text>}
                </View>
              )}

              <TouchableOpacity
                style={styles.pickFileButton}
                onPress={handlePickDocument}
                disabled={!isAvailable || submissionLoading || !isConnected}
              >
                <Ionicons name="folder-open-outline" size={20} color={!isAvailable || !isConnected ? "#666" : "#007bff"} />
                <Text style={[styles.pickFileButtonText, (!isAvailable || !isConnected) && { color: '#666' }]}>
                  {selectedFile ? selectedFile.name : `Select ${assessmentDetail.type || 'assessment'} File`}
                </Text>
              </TouchableOpacity>
              {selectedFile && (
                <Text style={styles.selectedFileName}>Selected: {selectedFile.name}</Text>
              )}
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  (!isAvailable || !selectedFile || submissionLoading || !isConnected) && styles.actionButtonDisabled,
                ]}
                onPress={handleSubmitAssignment}
                disabled={!isAvailable || !selectedFile || submissionLoading || !isConnected}
              >
                {submissionLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={24} color="#fff" style={styles.icon} />
                    <Text style={styles.actionButtonText}>
                      {isAvailable ? `Submit ${assessmentDetail.type || 'assessment'}` : `${assessmentDetail.type || 'assessment'} Not Yet Available`}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            // Quiz/Exam Type
            <TouchableOpacity
              style={[styles.actionButton, isQuizAttemptButtonDisabled && styles.actionButtonDisabled]}
              onPress={handleStartQuizAttempt}
              disabled={isQuizAttemptButtonDisabled}
            >
              {submissionLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="play-circle-outline" size={24} color="#fff" style={styles.icon} />
                  <Text style={styles.actionButtonText}>
                    {quizButtonText}
                  </Text>
                </>
              )}
            </TouchableOpacity>
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
    backgroundColor: '#28a745',
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
  submittedFileContainer: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#d1e7dd',
    alignItems: 'center',
  },
  submittedFileLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#28a745',
    marginBottom: 8,
  },
  downloadFileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e0f7fa',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#00bcd4',
  },
  downloadFileButtonText: {
    fontSize: 15,
    color: '#007bff',
    marginLeft: 10,
    textDecorationLine: 'underline',
  },
  submittedAtText: {
    fontSize: 13,
    color: '#6c757d',
    marginTop: 5,
  },
  submittedStatusText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#6c757d',
    marginTop: 5,
  },
  offlineWarning: {
    color: '#ff6347',
    fontSize: 12,
    marginTop: 5,
  },
});