// [assessmentId].tsx
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../../../context/NetworkContext';
import api, { getUserData, syncOfflineSubmission } from '../../../../lib/api'; // Add syncOfflineSubmission here
import {
  checkIfAssessmentNeedsDetails,
  deleteOfflineSubmission,
  getAssessmentDetailsFromDb,
  getCurrentServerTime,
  getOfflineAttemptCount,
  getOfflineQuizAttempt,
  getUnsyncedSubmissions,
  hasQuizQuestionsSaved,
  saveAssessmentDetailsToDb,
  saveAssessmentsToDb,
  saveOfflineSubmission,
  startOfflineQuiz
} from '../../../../lib/localDb';

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
  assessment_file_url?: string | null;
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

interface SubmittedAssessment {
  score: number | null;
  status: string;
}

export default function AssessmentDetailsScreen() {
  const { id: courseId, assessmentId } = useLocalSearchParams();
  const router = useRouter();
  const { isConnected, netInfo } = useNetworkStatus();
  const [assessmentDetail, setAssessmentDetail] = useState<AssessmentDetail | null>(null);
  const [attemptStatus, setAttemptStatus] = useState<AttemptStatus | null>(null);
  const [latestAssignmentSubmission, setLatestAssignmentSubmission] = useState<LatestAssignmentSubmission | null>(null);
  const [submittedAssessment, setSubmittedAssessment] = useState<SubmittedAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasOfflineAttempt, setHasOfflineAttempt] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [hasDetailedData, setHasDetailedData] = useState<boolean>(false);
  const navigation = useNavigation();

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
    if (netInfo?.isInternetReachable) {
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
            console.warn('Failed to fetch attempt status.');
          }
        } else {
          setAttemptStatus(null);
        }

        if (['assignment', 'activity', 'project'].includes(fetchedAssessment.type)) {
          const assignmentSubmissionResponse = await api.get(`/assessments/${assessmentId}/latest-assignment-submission`);
          if (assignmentSubmissionResponse.status === 200) {
            newLatestSubmission = assignmentSubmissionResponse.data;
            setLatestAssignmentSubmission(newLatestSubmission);
          } else {
            console.warn('Failed to fetch latest assignment submission.');
          }
        } else {
          setLatestAssignmentSubmission(null);
          setSelectedFile(null);
        }
        
        // FIXED: Simplified courseId handling with proper validation
        let validCourseId: number;
        
        // First try to get courseId from URL params
        if (courseId) {
          validCourseId = typeof courseId === 'string' ? parseInt(courseId, 10) : Number(courseId);
        } else {
          // If no courseId in params, get it from the fetched assessment
          validCourseId = fetchedAssessment.course_id;
        }

        // Validate the courseId
        if (!validCourseId || isNaN(validCourseId) || validCourseId <= 0) {
          console.error('❌ Invalid courseId:', { 
            fromParams: courseId, 
            fromAssessment: fetchedAssessment.course_id, 
            calculated: validCourseId 
          });
          setError('Invalid course information. Please navigate from the course page.');
          setLoading(false);
          return;
        }

        console.log('✅ Using valid courseId:', validCourseId);

        // Save to database
        await saveAssessmentsToDb([fetchedAssessment], validCourseId, userEmail);
        await saveAssessmentDetailsToDb(
          fetchedAssessment.id,
          userEmail,
          newAttemptStatus,
          newLatestSubmission
        );
        
        // Check if detailed data exists after saving
        const needsDetails = await checkIfAssessmentNeedsDetails(fetchedAssessment.id, userEmail);
        setHasDetailedData(!needsDetails);
        
      } else {
        setError('Failed to fetch assessment details.');
      }

      const offlineAttempt = await getOfflineQuizAttempt(parseInt(assessmentId as string), userEmail);
      setHasOfflineAttempt(!!offlineAttempt);
    } else {
      // OFFLINE MODE
      console.log('⚠️ Offline: Fetching assessment details from local DB.');
      const offlineAssessment = await getAssessmentDetailsFromDb(assessmentId as string, userEmail);
      const offlineAttempt = await getOfflineQuizAttempt(parseInt(assessmentId as string), userEmail);
      
      if (offlineAssessment) {
        // Get completed attempts count from offline_quiz_attempts
        const offlineAttemptCount = await getOfflineAttemptCount(parseInt(assessmentId as string), userEmail);

        // Use only the completed attempts for attempts_made
        const updatedAttemptStatus = {
          ...offlineAssessment.attemptStatus,
          attempts_made: offlineAttemptCount.attempts_made, // ← Use only completed attempts
          attempts_remaining: offlineAttemptCount.attempts_remaining,
          has_in_progress_attempt: !!offlineAttempt,
          can_start_new_attempt: offlineAttemptCount.attempts_remaining === null || 
                              offlineAttemptCount.attempts_remaining > 0
        };

        setAssessmentDetail(offlineAssessment);
        setAttemptStatus(updatedAttemptStatus);
        setLatestAssignmentSubmission(offlineAssessment.latestSubmission);
        setHasDetailedData(true);
        setHasOfflineAttempt(!!offlineAttempt);
      } else {
        setError('Assessment details not available offline.');
        setHasDetailedData(false);
      }
    }
  } catch (err: any) {
    console.error('Failed to fetch assessment details/status/submission:', err.response?.data || err.message);
    setError('Network error or unable to load assessment details/status/submission.');
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Error', 'Failed to load assessment details from local storage.');
    } else {
      Alert.alert('Error', 'Failed to fetch assessment details/status/submission.');
    }
  } finally {
    setLoading(false);
  }
}, [assessmentId, courseId, netInfo?.isInternetReachable]);
  // ✅ CRITICAL: This will refresh data when returning from quiz attempt
  useFocusEffect(
    useCallback(() => {
      fetchAssessmentDetailsAndAttemptStatus();
    }, [fetchAssessmentDetailsAndAttemptStatus])
  );

  useEffect(() => {
    const syncSubmissions = async () => {
      if (netInfo?.isInternetReachable) {
        console.log('Network is back online. Checking for unsynced submissions...');
        const user = await getUserData();
        if (!user || !user.email) return;

        const unsyncedSubmissions = await getUnsyncedSubmissions(user.email);
        if (unsyncedSubmissions.length > 0) {
          Alert.alert(
            'Synchronization',
            `Found ${unsyncedSubmissions.length} offline submission(s) to sync.`,
            [{ text: 'OK' }]
          );

          for (const submission of unsyncedSubmissions) {
            const success = await syncOfflineSubmission(
              submission.assessment_id,
              submission.file_uri,
              submission.original_filename,
              submission.submitted_at
            );

            if (success) {
              await deleteOfflineSubmission(submission.id);
              console.log(`Successfully synced and deleted local record for assessment ${submission.assessment_id}`);
            } else {
              console.warn(`Failed to sync submission for assessment ${submission.assessment_id}`);
            }
          }
          
          fetchAssessmentDetailsAndAttemptStatus();
        }
      }
    };

    syncSubmissions();
  }, [netInfo?.isInternetReachable]);

  const isAssessmentOpen = (assessment: AssessmentDetail) => {
    const now = new Date().getTime();
    if (assessment.available_at && now < new Date(assessment.available_at).getTime()) {
      return false;
    }
    if (assessment.unavailable_at && now > new Date(assessment.unavailable_at).getTime()) {
      return false;
    }
    return true;
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

    const user = await getUserData();
    const userEmail = user?.email;

    if (!userEmail) {
      Alert.alert('Error', 'User not found. Cannot start quiz.');
      return;
    }

    if (!isAssessmentOpen(assessmentDetail)) {
      Alert.alert(
        'Assessment Unavailable',
        `This assessment is not currently available. Please check the available date/time.`
      );
      return;
    }

    const hasQuestions = await hasQuizQuestionsSaved(assessmentDetail.id, userEmail);
    if (!hasQuestions) {
      Alert.alert(
        'Quiz Questions Not Downloaded',
        'Please go online once to download the quiz questions before attempting. After that, you can start the quiz in online or offline mode.'
      );
      return;
    }

    const existingAttempt = await getOfflineQuizAttempt(assessmentDetail.id, userEmail);
    if (existingAttempt) {
      Alert.alert(
        'Resume Quiz',
        'An in-progress quiz attempt was found in your local storage. Do you want to resume it?',
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Resume',
            onPress: () => router.replace({
              pathname: `/courses/assessments/[assessmentId]/attempt-quiz`,
              params: {
                assessmentId: assessmentDetail.id,
                isOffline: 'true'
              }
            })
          },
        ]
      );
      return;
    }

    if (attemptStatus && attemptStatus.attempts_remaining !== null && attemptStatus.attempts_remaining <= 0) {
      Alert.alert('Attempt Limit Reached', 'You have used all attempts for this quiz.');
      return;
    }

    try {
      console.log('Starting quiz attempt and saving locally...');
      await startOfflineQuiz(parseInt(assessmentId as string), userEmail);

      Alert.alert('Success', 'Your quiz has been started and saved locally. You can proceed to attempt it now.', [
        {
          text: 'OK',
          onPress: () =>
            router.replace({
              pathname: '/courses/assessments/[assessmentId]/attempt-quiz',
              params: { 
                assessmentId: assessmentDetail.id.toString(), 
                userEmail, 
                isOffline: 'true'
              },
            }),
        },
      ]);
    } catch (error) {
      console.error('Error starting quiz attempt:', error);
      Alert.alert('Error', 'Failed to start quiz attempt locally.');
    }
  };

  const handleSubmitAssignment = async () => {
    if (!assessmentDetail) return;

    if (!isAssessmentOpen(assessmentDetail)) {
      Alert.alert(
        'Assessment Unavailable',
        `This assessment is not currently available. Please check the dates.`
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
      if (netInfo?.isInternetReachable) {
        const formData = new FormData();
        formData.append('assignment_file', {
          uri: selectedFile.uri,
          name: selectedFile.name,
          type: selectedFile.mimeType || 'application/octet-stream',
        } as any);

        console.log('Submitting assignment with FormData (Online)');

        const response = await api.post(`/assessments/${assessmentDetail.id}/submit-assignment`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        console.log('Assignment submission response:', response.data);

        if (response.status === 200) {
          Alert.alert('Success', response.data.message || 'Assignment submitted successfully!');
          setSelectedFile(null);
          await fetchAssessmentDetailsAndAttemptStatus();
        } else {
          Alert.alert('Error', response.data.message || 'Failed to submit assignment.');
        }
      } else {
        console.log('⚠️ Offline: Saving submission to local DB with server time.');
        const user = await getUserData();
        if (user && user.email) {
          const serverSubmissionTime = await getCurrentServerTime(user.email);
          console.log('🕒 Using server time for offline submission:', serverSubmissionTime);
          
          const actualSubmissionTime = await saveOfflineSubmission(
            user.email, 
            assessmentDetail.id, 
            selectedFile.uri, 
            selectedFile.name,
            serverSubmissionTime
          );
          
          Alert.alert('Offline Submission', 'Your assignment has been saved locally and will be submitted once you are online.');
          
          setLatestAssignmentSubmission({
            has_submitted_file: true,
            submitted_file_path: selectedFile.uri,
            submitted_file_url: null,
            submitted_file_name: selectedFile.name,
            original_filename: selectedFile.name,
            submitted_at: actualSubmissionTime,
            status: 'to sync',
          });
          setSelectedFile(null);
        } else {
          Alert.alert('Error', 'User not found. Cannot save offline submission.');
        }
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

  const getAssessmentIcon = (type: string) => {
    switch (type) {
      case 'quiz': return 'help-circle';
      case 'exam': return 'school';
      case 'assignment': return 'document-text';
      case 'project': return 'folder';
      case 'activity': return 'play-circle';
      default: return 'clipboard';
    }
  };

  const getAssessmentColor = (type: string) => {
    switch (type) {
      case 'quiz': return '#8e24aa';
      case 'exam': return '#d32f2f';
      case 'assignment': return '#1976d2';
      case 'project': return '#388e3c';
      case 'activity': return '#f57c00';
      default: return '#616161';
    }
  };

  const isAssessmentCurrentlyOpen = assessmentDetail ? isAssessmentOpen(assessmentDetail) : false;

  let isQuizAttemptButtonDisabled = false;
  let quizButtonText = 'Start Quiz';

  if (assessmentDetail && (assessmentDetail.type === 'quiz' || assessmentDetail.type === 'exam')) {
    if (hasOfflineAttempt) {
      quizButtonText = 'Resume Quiz';
      isQuizAttemptButtonDisabled = false;
    } else if (!isAssessmentCurrentlyOpen) {
      isQuizAttemptButtonDisabled = true;
      quizButtonText = 'Assessment Unavailable';
    } else if (attemptStatus) {
      if (attemptStatus.has_in_progress_attempt) {
        quizButtonText = 'Resume Quiz';
        isQuizAttemptButtonDisabled = submissionLoading;
      } else if (attemptStatus.attempts_remaining !== null && attemptStatus.attempts_remaining <= 0) {
        quizButtonText = 'Attempt Limit Reached';
        isQuizAttemptButtonDisabled = true;
      }
    }
  } else if (!isAssessmentCurrentlyOpen) {
    isQuizAttemptButtonDisabled = true;
    quizButtonText = 'Assessment Unavailable';
  }

  if (!netInfo?.isInternetReachable) {
    if (assessmentDetail?.type === 'quiz' || assessmentDetail?.type === 'exam') {
      if (hasOfflineAttempt) {
        isQuizAttemptButtonDisabled = false;
        quizButtonText = 'Resume Quiz (Offline)';
      } else if (!hasDetailedData) {
        isQuizAttemptButtonDisabled = true;
        quizButtonText = 'Download Assessment Details First (Offline)';
      } else if (attemptStatus && attemptStatus.attempts_remaining !== null && attemptStatus.attempts_remaining <= 0) {
        isQuizAttemptButtonDisabled = true;
        quizButtonText = 'Attempt Limit Reached (Offline)';
      } else if (!isAssessmentCurrentlyOpen) {
        isQuizAttemptButtonDisabled = true;
        quizButtonText = 'Assessment Unavailable (Offline)';
      } else {
        isQuizAttemptButtonDisabled = false;
        quizButtonText = 'Start Quiz (Offline)';
      }
    } else {
      isQuizAttemptButtonDisabled = true;
    }
  }

  const fetchSubmittedAssessment = async () => {
    if (!netInfo?.isInternetReachable) {
      console.log('⚠️ Offline: Cannot fetch submitted assessment.');
      setSubmittedAssessment({ score: null, status: 'not_started' });
      return;
    }

    try {
      const response = await api.get(`/submitted-assessments/${assessmentId}`);
      if (response.status === 200) {
        setSubmittedAssessment(response.data.submitted_assessment);
      }
    } catch (error) {
      console.error('Failed to fetch submitted assessment:', error);
      setSubmittedAssessment({ score: null, status: 'not_started' });
    }
  };

  useEffect(() => {
    fetchSubmittedAssessment();
  }, [assessmentId]);

  if (loading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#02135eff', '#7979f1ff']}
          style={styles.loadingGradient}
        >
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>Loading assessment...</Text>
        </LinearGradient>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#02135eff', '#7979f1ff']}
          style={styles.loadingGradient}
        >
          <Ionicons name="alert-circle" size={64} color="#fff" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchAssessmentDetailsAndAttemptStatus}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    );
  }

  if (!assessmentDetail) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#02135eff', '#7979f1ff']}
          style={styles.loadingGradient}
        >
          <Ionicons name="document" size={64} color="#fff" />
          <Text style={styles.errorText}>Assessment not found.</Text>
        </LinearGradient>
      </View>
    );
  }

  const isAssignmentType = ['assignment', 'activity', 'project'].includes(assessmentDetail.type);
  const isQuizOrExamType = ['quiz', 'exam'].includes(assessmentDetail.type);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: assessmentDetail.title || 'Assessment Details' }} />
      
      <ScrollView contentContainerStyle={styles.scrollViewContent} showsVerticalScrollIndicator={false}>
        {/* Enhanced Header with Gradient */}
        <LinearGradient
          colors={['#02135eff', '#7979f1ff']}
          style={styles.headerContainer}
        >
          <View style={styles.headerContent}>
            <View style={[
              styles.assessmentIconContainer,
              { backgroundColor: getAssessmentColor(assessmentDetail.type) + '20' }
            ]}>
              <Ionicons 
                name={getAssessmentIcon(assessmentDetail.type)} 
                size={32} 
                color="#fff" 
              />
            </View>
            <Text style={styles.assessmentTitle}>{assessmentDetail.title}</Text>
            <View style={styles.assessmentTypeBadge}>
              <Text style={styles.assessmentTypeText}>
                {assessmentDetail.type?.toUpperCase() || 'ASSESSMENT'}
              </Text>
            </View>
            {assessmentDetail.description && (
              <Text style={styles.assessmentDescription}>{assessmentDetail.description}</Text>
            )}
          </View>
          
          {!netInfo?.isInternetReachable && (
            <View style={styles.offlineNotice}>
              <Ionicons name="cloud-offline" size={14} color="#fff" />
              <Text style={styles.offlineText}>Working offline</Text>
            </View>
          )}
        </LinearGradient>

        {/* Enhanced Details Section */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeader}>Assessment Details</Text>
          
          <View style={styles.detailsGrid}>
            {/* Points */}
            {/* <View style={styles.detailCard}>
              <View style={styles.detailIconContainer}>
                <Ionicons name="trophy" size={20} color="#f39c12" />
              </View>
              <Text style={styles.detailLabel}>Points</Text>
              <Text style={styles.detailValue}>{assessmentDetail.points}</Text>
            </View> */}

            {/* Duration (for quizzes/exams) */}
            {isQuizOrExamType && (
              <View style={styles.detailCard}>
                <View style={styles.detailIconContainer}>
                  <Ionicons name="timer" size={20} color="#3498db" />
                </View>
                <Text style={styles.detailLabel}>Duration</Text>
                <Text style={styles.detailValue}>
                  {assessmentDetail.duration_minutes ? `${assessmentDetail.duration_minutes} min` : 'N/A'}
                </Text>
              </View>
            )}

            {/* Max Attempts (for quizzes/exams) */}
            {isQuizOrExamType && (
              <View style={styles.detailCard}>
                <View style={styles.detailIconContainer}>
                  <Ionicons name="repeat" size={20} color="#9b59b6" />
                </View>
                <Text style={styles.detailLabel}>Max Attempts</Text>
                <Text style={styles.detailValue}>
                  {assessmentDetail.max_attempts ?? 'Unlimited'}
                </Text>
              </View>
            )}

            {/* Attempts Made (for quizzes/exams) */}
            {isQuizOrExamType && attemptStatus && (
              <View style={styles.detailCard}>
                <View style={styles.detailIconContainer}>
                  <Ionicons name="checkmark-done" size={20} color="#27ae60" />
                </View>
                <Text style={styles.detailLabel}>Attempts Made</Text>
                <Text style={styles.detailValue}>{attemptStatus.attempts_made}</Text>
              </View>
            )}
          </View>

          {/* Availability Information */}
          <View style={styles.availabilityContainer}>
            <View style={styles.availabilityItem}>
              <Ionicons name="calendar" size={16} color="#7f8c8d" />
              <Text style={styles.availabilityLabel}>Available From:</Text>
              <Text style={styles.availabilityValue}>{formatDate(assessmentDetail.available_at)}</Text>
            </View>
            {assessmentDetail.unavailable_at && (
              <View style={styles.availabilityItem}>
                <Ionicons name="calendar-outline" size={16} color="#e74c3c" />
                <Text style={styles.availabilityLabel}>Available Until:</Text>
                <Text style={styles.availabilityValue}>{formatDate(assessmentDetail.unavailable_at)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Assessment File Section (for assignments) */}
        {isAssignmentType && assessmentDetail.assessment_file_url && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Assignment Instructions</Text>
            <TouchableOpacity 
              onPress={() => assessmentDetail.assessment_file_url && handleDownloadAssessmentFile(assessmentDetail.assessment_file_url)}
              style={[styles.actionCard, !netInfo?.isInternetReachable && styles.actionCardDisabled]}
              disabled={!netInfo?.isInternetReachable}
              activeOpacity={0.8}
            >
              <View style={styles.actionCardContent}>
                <View style={styles.actionCardIcon}>
                  <Ionicons 
                    name="download" 
                    size={24} 
                    color={netInfo?.isInternetReachable ? "#fff" : "#ccc"} 
                  />
                </View>
                <View style={styles.actionCardText}>
                  <Text style={[styles.actionCardTitle, !netInfo?.isInternetReachable && styles.disabledText]}>
                    Download Instructions
                  </Text>
                  <Text style={[styles.actionCardSubtitle, !netInfo?.isInternetReachable && styles.disabledText]}>
                    Get the assignment file from your instructor
                  </Text>
                </View>
              </View>
              {!netInfo?.isInternetReachable && (
                <Text style={styles.offlineWarning}>Must be online to download</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Previous Submission Section (for assignments) */}
        {isAssignmentType && latestAssignmentSubmission?.has_submitted_file && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Previous Submission</Text>
            <View style={styles.submissionCard}>
              <View style={styles.submissionHeader}>
                <View style={styles.submissionIconContainer}>
                  <Ionicons name="document-text" size={20} color="#27ae60" />
                </View>
                <View style={styles.submissionInfo}>
                  <Text style={styles.submissionFileName}>
                    {latestAssignmentSubmission.original_filename || 
                     latestAssignmentSubmission.submitted_file_name || 
                     'Unknown File'}
                  </Text>
                  {latestAssignmentSubmission.status && (
                    <View style={[
                      styles.statusBadge,
                      latestAssignmentSubmission.status === 'to sync' 
                        ? { backgroundColor: '#f39c12' }
                        : { backgroundColor: '#27ae60' }
                    ]}>
                      <Text style={styles.statusText}>
                        {latestAssignmentSubmission.status.replace('_', ' ').toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              
              {latestAssignmentSubmission.submitted_at && (
                <Text style={styles.submissionDate}>
                  Submitted: {formatDate(latestAssignmentSubmission.submitted_at)}
                </Text>
              )}
              
              {latestAssignmentSubmission.submitted_file_url && (
                <TouchableOpacity 
                  onPress={() => latestAssignmentSubmission.submitted_file_url && handleDownloadSubmittedFile(latestAssignmentSubmission.submitted_file_url)}
                  style={[styles.downloadButton, !netInfo?.isInternetReachable && styles.downloadButtonDisabled]}
                  disabled={!netInfo?.isInternetReachable}
                  activeOpacity={0.8}
                >
                  <Ionicons name="cloud-download" size={16} color={netInfo?.isInternetReachable ? "#2196F3" : "#ccc"} />
                  <Text style={[styles.downloadButtonText, !netInfo?.isInternetReachable && { color: '#ccc' }]}>
                    Download Submission
                  </Text>
                </TouchableOpacity>
              )}
              
              {!netInfo?.isInternetReachable && (
                <Text style={styles.offlineWarning}>Must be online to download submission</Text>
              )}
            </View>
          </View>
        )}

        {/* Action Section */}
        <View style={styles.sectionContainer}>
          {isAssignmentType ? (
            // Assignment Upload Section
            <View>
              <Text style={styles.sectionHeader}>Submit Your Work</Text>
              
              {/* File Selection */}
              <TouchableOpacity
                style={styles.filePickerCard}
                onPress={handlePickDocument}
                disabled={!isAssessmentCurrentlyOpen || submissionLoading}
                activeOpacity={0.8}
              >
                <View style={styles.filePickerContent}>
                  <View style={styles.filePickerIcon}>
                    <Ionicons 
                      name={selectedFile ? "document" : "folder-open"} 
                      size={24} 
                      color={selectedFile ? "#27ae60" : "#7f8c8d"} 
                    />
                  </View>
                  <View style={styles.filePickerText}>
                    <Text style={styles.filePickerTitle}>
                      {selectedFile ? selectedFile.name : `Select ${assessmentDetail.type} File`}
                    </Text>
                    <Text style={styles.filePickerSubtitle}>
                      {selectedFile ? 'Tap to change file' : 'Choose a file to upload'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* Submit Button */}
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  (!isAssessmentCurrentlyOpen || !selectedFile || submissionLoading) && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmitAssignment}
                disabled={!isAssessmentCurrentlyOpen || !selectedFile || submissionLoading}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={
                    (!isAssessmentCurrentlyOpen || !selectedFile || submissionLoading)
                      ? ['#ccc', '#ccc']
                      : ['#02135eff', '#7979f1ff']
                  }
                  style={styles.submitButtonGradient}
                >
                  {submissionLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload" size={24} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={styles.submitButtonText}>
                        {isAssessmentCurrentlyOpen ? `Submit ${assessmentDetail.type}` : 'Assessment Unavailable'}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            // Quiz/Exam Start Section
            <View>
              <Text style={styles.sectionHeader}>Take Assessment</Text>
              <TouchableOpacity
                style={[styles.submitButton, isQuizAttemptButtonDisabled && styles.submitButtonDisabled]}
                onPress={handleStartQuizAttempt}
                disabled={isQuizAttemptButtonDisabled}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={
                    isQuizAttemptButtonDisabled
                      ? ['#ccc', '#ccc']
                      : ['#02135eff', '#7979f1ff']
                  }
                  style={styles.submitButtonGradient}
                >
                  {submissionLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons 
                        name={hasOfflineAttempt ? "play" : "play-circle"} 
                        size={24} 
                        color="#fff" 
                        style={{ marginRight: 8 }} 
                      />
                      <Text style={styles.submitButtonText}>{quizButtonText}</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Submitted Assessment Score and Status */}
        {submittedAssessment && (
          <View style={styles.submittedAssessmentContainer}>
            <Text style={styles.submittedAssessmentHeader}>Your Submission</Text>
            {!netInfo?.isInternetReachable ? (
              <Text style={styles.offlineSubmissionText}>
                Submission data is not available offline. Please connect to the internet to view your submission details.
              </Text>
            ) : (
              <>
                <View style={styles.submittedAssessmentDetails}>
                  <Ionicons name="star" size={20} color="#f39c12" style={styles.submittedAssessmentIcon} />
                  <Text style={styles.submittedAssessmentLabel}>Score:</Text>
                  <Text style={styles.submittedAssessmentValue}>
                    {submittedAssessment.score !== null ? submittedAssessment.score : 'Not yet taken'}
                  </Text>
                </View>
                <View style={styles.submittedAssessmentDetails}>
                  <Ionicons name="checkmark-circle" size={20} color={submittedAssessment.status === 'graded' ? '#27ae60' : '#f39c12'} style={styles.submittedAssessmentIcon} />
                  <Text style={styles.submittedAssessmentLabel}>Status:</Text>
                  <Text style={[styles.submittedAssessmentValue, { color: submittedAssessment.status === 'graded' ? '#27ae60' : '#f39c12' }]}>
                    {submittedAssessment.status === 'not_started' ? 'Not started' : submittedAssessment.status}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// Enhanced styles matching index.tsx design
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  
  // Loading and Error States
  loadingGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    marginTop: 20,
    fontSize: 18,
    color: '#fff',
    fontWeight: '500',
    textAlign: 'center',
  },
  errorText: {
    marginTop: 20,
    fontSize: 18,
    color: '#fff',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 24,
  },
  retryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 20,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  scrollViewContent: {
    paddingBottom: 30,
  },

  // Enhanced Header (matching index.tsx)
  headerContainer: {
    paddingTop: 20,
    paddingBottom: 30,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    marginBottom: 20,
  },
  headerContent: {
    alignItems: 'center',
  },
  assessmentIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  assessmentTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 28,
  },
  assessmentTypeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginBottom: 15,
  },
  assessmentTypeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  assessmentDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 15,
  },
  offlineText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },

  // Enhanced Sections
  sectionContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 15,
  },

  // Details Grid
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  detailCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 15,
    alignItems: 'center',
    width: '48%',
    marginBottom: 10,
  },
  detailIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  detailLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    marginBottom: 4,
    textAlign: 'center',
  },
  detailValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
  },

  // Availability Information
  availabilityContainer: {
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 15,
  },
  availabilityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  availabilityLabel: {
    fontSize: 14,
    color: '#7f8c8d',
    marginLeft: 8,
    marginRight: 8,
    fontWeight: '500',
  },
  availabilityValue: {
    fontSize: 14,
    color: '#2c3e50',
    flex: 1,
  },

  // Action Cards
  actionCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 15,
    marginBottom: 10,
  },
  actionCardDisabled: {
    opacity: 0.6,
  },
  actionCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  actionCardText: {
    flex: 1,
  },
  actionCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  actionCardSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  disabledText: {
    color: '#ccc',
  },

  // Submission Card
  submissionCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#27ae60',
  },
  submissionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  submissionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#27ae60',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  submissionInfo: {
    flex: 1,
  },
  submissionFileName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  statusBadge: {
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  submissionDate: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 10,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    borderRadius: 10,
    padding: 10,
    marginBottom: 5,
  },
  downloadButtonDisabled: {
    backgroundColor: '#f5f5f5',
  },
  downloadButtonText: {
    fontSize: 14,
    color: '#2196F3',
    marginLeft: 8,
    fontWeight: '500',
  },

  // File Picker
  filePickerCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#e9ecef',
    borderStyle: 'dashed',
  },
  filePickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filePickerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  filePickerText: {
    flex: 1,
  },
  filePickerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  filePickerSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
  },

  // Submit Button
  submitButton: {
    borderRadius: 15,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  submitButtonDisabled: {
    shadowOpacity: 0.1,
    elevation: 2,
  },
  submitButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },

  // Warnings
  offlineWarning: {
    color: '#e74c3c',
    fontSize: 12,
    marginTop: 5,
    fontStyle: 'italic',
  },

  // Submitted Assessment
  submittedAssessmentContainer: {
    backgroundColor: '#f1f8e9',
    borderRadius: 15,
    padding: 15,
    marginTop: 20,
  },
  submittedAssessmentHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 10,
  },
  submittedAssessmentDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  submittedAssessmentLabel: {
    fontSize: 14,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  submittedAssessmentValue: {
    fontSize: 14,
    color: '#2c3e50',
    fontWeight: 'bold',
  },
  submittedAssessmentIcon: {
    marginRight: 8,
  },
  offlineSubmissionText: {
    fontSize: 14,
    color: '#7f8c8d',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 10,
  },
});