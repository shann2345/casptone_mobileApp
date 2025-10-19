// [assessmentId].tsx
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
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

// Interface definitions (unchanged)
interface AssessmentDetail {
  id: number;
  course_id: number;
  topic_id: number;
  title: string;
  type: 'quiz' | 'exam' | 'assignment' | 'project' | 'activity';
  description: string;
  assessment_file_path: string | null;
  duration_minutes: number | null;
  available_at: string | null;
  unavailable_at: string | null;
  created_by: number;
  max_attempts: number | null;
  total_points: number | null;
  assessment_file_url?: string;
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

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

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
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [hasDetailedData, setHasDetailedData] = useState<boolean>(false);
  
  // New states for submission modal and link input
  const [isSubmissionModalVisible, setSubmissionModalVisible] = useState(false);
  const [submissionType, setSubmissionType] = useState<'file' | 'link' | null>(null);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [submissionLink, setSubmissionLink] = useState('');
  
  const navigation = useNavigation();

  usePendingSyncNotification(netInfo?.isInternetReachable ?? null, 'assessment-details');

  const fetchAssessmentDetailsAndAttemptStatus = useCallback(async () => {
    // This function remains largely the same, no changes needed here.
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

          if (fetchedAssessment.type === 'quiz' || fetchedAssessment.type === 'exam') {
            const attemptStatusResponse = await api.get(`/assessments/${assessmentId}/attempt-status`);
            if (attemptStatusResponse.status === 200) {
              newAttemptStatus = attemptStatusResponse.data;
              setAttemptStatus(newAttemptStatus);
            }
          } else {
            setAttemptStatus(null);
          }

          if (['assignment', 'activity', 'project'].includes(fetchedAssessment.type)) {
            const assignmentSubmissionResponse = await api.get(`/assessments/${assessmentId}/latest-assignment-submission`);
            if (assignmentSubmissionResponse.status === 200) {
              newLatestSubmission = assignmentSubmissionResponse.data;
              setLatestAssignmentSubmission(newLatestSubmission);
            }
          } else {
            setLatestAssignmentSubmission(null);
            setSelectedFile(null);
            setSubmissionLink('');
          }
          
          let validCourseId: number;
          if (courseId) {
            validCourseId = typeof courseId === 'string' ? parseInt(courseId, 10) : Number(courseId);
          } else {
            validCourseId = fetchedAssessment.course_id;
          }

          if (!validCourseId || isNaN(validCourseId) || validCourseId <= 0) {
            setError('Invalid course information.');
            setLoading(false);
            return;
          }

          await saveAssessmentsToDb([fetchedAssessment], validCourseId, userEmail);
          await saveAssessmentDetailsToDb(
            fetchedAssessment.id,
            userEmail,
            newAttemptStatus,
            newLatestSubmission
          );
          
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
          const offlineAttemptCount = await getOfflineAttemptCount(parseInt(assessmentId as string), userEmail);
          const updatedAttemptStatus = {
            ...offlineAssessment.attemptStatus,
            attempts_made: offlineAttemptCount.attempts_made,
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
      console.error('Failed to fetch details:', err.response?.data || err.message);
      setError('Network error or unable to load assessment details.');
    } finally {
      setLoading(false);
    }
  }, [assessmentId, courseId, netInfo?.isInternetReachable]);

  // Other functions like getStatusIcon, formatDate, etc. remain unchanged.
  // ... (keep all existing helper functions)
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return 'checkmark-circle';
      case 'graded': return 'checkmark-done-circle';
      case 'in_progress': return 'time';
      case 'submitted': return 'cloud-done';
      default: return 'help-circle';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#27ae60';
      case 'graded': return '#2ecc71';
      case 'in_progress': return '#f39c12';
      case 'submitted': return '#3498db';
      default: return '#7f8c8d';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'Completed';
      case 'graded': return 'Graded';
      case 'in_progress': return 'In Progress';
      case 'submitted': return 'Submitted';
      case 'not_started': return 'Not yet taken';
      default: return 'Unknown';
    }
  };

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
    if (assessment.available_at && now < new Date(assessment.available_at).getTime()) return false;
    if (assessment.unavailable_at && now > new Date(assessment.unavailable_at).getTime()) return false;
    return true;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };
  
  // NEW: handlePickDocument now includes file size validation
  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const file = result.assets[0];

        // Validate file size
        if (file.size && file.size > MAX_FILE_SIZE) {
          Alert.alert(
            'File Too Large',
            `The selected file exceeds the 50MB size limit. Please choose a smaller file.`
          );
          return;
        }

        setSelectedFile(file);
        setSubmissionLink(''); // Clear link if a file is selected
        setSubmissionType('file');
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
      Alert.alert('Error', 'Could not open the submitted file.');
    }
  };

  const handleDownloadAssessmentFile = async (fileUrl: string) => {
    try {
      await Linking.openURL(fileUrl);
    } catch (error) {
      Alert.alert('Error', 'Could not open the assessment file.');
    }
  };
  
  // handleStartQuizAttempt remains unchanged.
  const handleStartQuizAttempt = async () => {
    if (!assessmentDetail) return;

    const user = await getUserData();
    const userEmail = user?.email;
    const assessmentType = assessmentDetail.type || 'assessment';
    const assessmentTypeCapitalized = assessmentType.charAt(0).toUpperCase() + assessmentType.slice(1);

    if (!userEmail) {
      Alert.alert('Error', `User not found. Cannot start ${assessmentType}.`);
      return;
    }

    if (!isAssessmentOpen(assessmentDetail)) {
      Alert.alert('Assessment Unavailable', `This assessment is not currently available.`);
      return;
    }

    const hasQuestions = await hasQuizQuestionsSaved(assessmentDetail.id, userEmail);
    if (!hasQuestions) {
      Alert.alert(`${assessmentTypeCapitalized} Not Downloaded`, `Please go online to download questions before attempting.`);
      return;
    }

    const existingAttempt = await getOfflineQuizAttempt(assessmentDetail.id, userEmail);
    if (existingAttempt) {
      Alert.alert(`Resume ${assessmentTypeCapitalized}`, `An in-progress attempt was found. Do you want to resume it?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Resume', onPress: () => router.replace({ pathname: `/courses/assessments/[assessmentId]/attempt-quiz`, params: { assessmentId: assessmentDetail.id, isOffline: 'true' } }) }]
      );
      return;
    }

    if (attemptStatus && attemptStatus.attempts_remaining !== null && attemptStatus.attempts_remaining <= 0) {
      Alert.alert('Attempt Limit Reached', `You have used all attempts.`);
      return;
    }

    Alert.alert('Important Notice',
      `Please read carefully:\n\n` +
      `1. You must complete the ${assessmentType} in one session.\n` +
      `2. Do not leave or close the page before submitting.\n` +
      `3. Make sure you have enough time (${assessmentDetail.duration_minutes} minutes).\n\n` +
      `Are you ready to start?`,
      [{ text: 'Cancel', style: 'cancel' }, { text: `Start ${assessmentTypeCapitalized}`, onPress: async () => {
            try {
              await startOfflineQuiz(parseInt(assessmentId as string), userEmail);
              Alert.alert(`${assessmentTypeCapitalized} Started`, `Good luck!`, [{ text: 'OK', onPress: () => router.replace({ pathname: '/courses/assessments/[assessmentId]/attempt-quiz', params: { assessmentId: assessmentDetail.id.toString(), userEmail, isOffline: 'true' } }) }]);
            } catch (error) {
              Alert.alert('Error', `Failed to start attempt locally.`);
            }
          }
        }]
    );
  };

  // NEW: Heavily modified submission handler for both files and links
  const handleSubmitAssignment = async () => {
    if (!assessmentDetail) return;
      if (!isAssessmentOpen(assessmentDetail)) {
        Alert.alert('Assessment Unavailable', `This assessment is not currently available.`);
        return;
      }

      const hasFile = selectedFile !== null;
      const hasLink = submissionLink.trim() !== '';

      if (!hasFile && !hasLink) {
        Alert.alert(`No Submission`, `Please select a file or enter a link to submit.`);
        return;
      }

      setSubmissionLoading(true);

      try {
        // --- MODIFICATION START ---
        if (netInfo?.isInternetReachable) {
          // ONLINE SUBMISSION
          const formData = new FormData();
          
          if (hasLink) {
            formData.append('submission_link', submissionLink.trim());
          } else if (hasFile && selectedFile) {
            formData.append('assignment_file', {
              uri: selectedFile.uri,
              name: selectedFile.name,
              type: selectedFile.mimeType || 'application/octet-stream',
            } as any);
          }

          const response = await api.post(`/assessments/${assessmentDetail.id}/submit-assignment`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });

          if (response.status === 200) {
            Alert.alert('Success', response.data.message || 'Submission successful!');
            setSelectedFile(null);
            setSubmissionLink('');
            setSubmissionType(null);
            await fetchAssessmentDetailsAndAttemptStatus();
          } else {
            Alert.alert('Error', response.data.message || 'Failed to submit.');
          }

        } else {
          // OFFLINE SUBMISSION
          const user = await getUserData();
          if (user && user.email) {
            let submissionUri = '';
            let submissionName = '';

            if (hasLink) {
              submissionUri = submissionLink.trim();
              submissionName = submissionLink.trim();
            } else if (hasFile && selectedFile) {
              submissionUri = selectedFile.uri;
              submissionName = selectedFile.name;
            }

            const serverSubmissionTime = await getCurrentServerTime(user.email);
            const actualSubmissionTime = await saveOfflineSubmission(
              user.email,
              assessmentDetail.id,
              submissionUri,
              submissionName,
              serverSubmissionTime
            );

            Alert.alert('Submission Saved Offline', 'Your work has been saved and will be submitted once you are online.');

            setLatestAssignmentSubmission({
              has_submitted_file: true,
              submitted_file_path: submissionUri,
              submitted_file_url: null, // No URL available offline
              submitted_file_name: submissionName,
              original_filename: submissionName,
              submitted_at: actualSubmissionTime,
              status: 'to sync',
            });
            setSelectedFile(null);
            setSubmissionLink('');
            setSubmissionType(null);
          } else {
            Alert.alert('Error', 'User not found. Cannot save offline submission.');
          }
        }
        // --- MODIFICATION END ---
      } catch (err: any) {
        console.error('Error submitting assignment:', err.response?.data || err.message);
        Alert.alert('Submission Error', err.response?.data?.message || 'Failed to submit due to a network error.');
      } finally {
        setSubmissionLoading(false);
        setSubmissionModalVisible(false);
      }
  };

  // Other functions like getAssessmentIcon, fetchSubmittedAssessment, etc. remain unchanged.
  // ... (keep all existing helper and rendering functions)
  
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

  const fetchSubmittedAssessment = async () => {
    if (!netInfo?.isInternetReachable) {
      setSubmittedAssessment({ score: null, status: 'not_started' });
      return;
    }
    if (!assessmentId) return;
    try {
      const response = await api.get(`/assessments/${assessmentId}/submitted-assessment`);
      if (response.status === 200) {
        setSubmittedAssessment(response.data.submitted_assessment);
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        setSubmittedAssessment({ score: null, status: 'not_started' });
      }
    }
  };

  useEffect(() => {
    if (assessmentDetail) fetchSubmittedAssessment();
  }, [assessmentId, assessmentDetail, netInfo?.isInternetReachable]);
  
  // Render functions start here, some will be modified.
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1967d2" />
        </View>
      </View>
    );
  }

  if (error || !assessmentDetail) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={64} color="#d93025" />
          <Text style={styles.errorText}>{error || 'Assessment not found.'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchAssessmentDetailsAndAttemptStatus}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isAssessmentCurrentlyOpen = isAssessmentOpen(assessmentDetail);
  const isAssignmentType = ['assignment', 'activity', 'project'].includes(assessmentDetail.type);
  const isQuizOrExamType = ['quiz', 'exam'].includes(assessmentDetail.type);

  // Button logic remains the same.
  let isQuizAttemptButtonDisabled = false;
  const assessmentType = assessmentDetail?.type || 'assessment';
  const assessmentTypeCapitalized = assessmentType.charAt(0).toUpperCase() + assessmentType.slice(1);
  let quizButtonText = `Start ${assessmentTypeCapitalized}`;

  if (assessmentDetail && (assessmentDetail.type === 'quiz' || assessmentDetail.type === 'exam')) {
    if (hasOfflineAttempt) {
      quizButtonText = `Resume ${assessmentTypeCapitalized}`;
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
        quizButtonText = 'Resume assessment (Offline)';
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
        quizButtonText = 'Start Assessment (Offline)';
      }
    } else {
      isQuizAttemptButtonDisabled = true;
    }
  }


  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: assessmentDetail.title || 'Assessment Details' }} />
      
      <ScrollView contentContainerStyle={styles.scrollViewContent} showsVerticalScrollIndicator={false}>
        {/* *** REDESIGNED HEADER *** */}
        <View style={styles.headerContainer}>
          <View style={[styles.assessmentTypeBadge, { backgroundColor: getAssessmentColor(assessmentDetail.type) }]}>
            <Text style={styles.assessmentTypeText}>{assessmentDetail.type?.toUpperCase()}</Text>
          </View>
          
          <Text style={styles.assessmentTitle}>{assessmentDetail.title}</Text>
          
          {assessmentDetail.description && (
            <View style={styles.descriptionContainer}>
              <Text style={styles.assessmentDescription}>{assessmentDetail.description}</Text>
            </View>
          )}

          {!netInfo?.isInternetReachable && (
            <View style={styles.offlineNotice}>
              <Ionicons name="cloud-offline" size={14} color="#5f6368" />
              <Text style={styles.offlineText}>Working offline</Text>
            </View>
          )}
        </View>

        {/* Details section remains unchanged */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeader}>Assessment Details</Text>
          <View style={styles.detailsGrid}>
            {isQuizOrExamType && (<View style={styles.detailCard}><View style={styles.detailIconContainer}><Ionicons name="timer" size={20} color="#3498db" /></View><Text style={styles.detailLabel}>Duration</Text><Text style={styles.detailValue}>{assessmentDetail.duration_minutes ? `${assessmentDetail.duration_minutes} min` : 'N/A'}</Text></View>)}
            {isQuizOrExamType && (<View style={styles.detailCard}><View style={styles.detailIconContainer}><Ionicons name="repeat" size={20} color="#9b59b6" /></View><Text style={styles.detailLabel}>Max Attempts</Text><Text style={styles.detailValue}>{assessmentDetail.max_attempts ?? 'Unlimited'}</Text></View>)}
            {isQuizOrExamType && (<View style={styles.detailCard}><View style={styles.detailIconContainer}><Ionicons name="star" size={20} color="#f39c12" /></View><Text style={styles.detailLabel}>Total Points</Text><Text style={styles.detailValue}>{assessmentDetail.total_points ?? 'N/A'}</Text></View>)}
            {isQuizOrExamType && attemptStatus && (<View style={styles.detailCard}><View style={styles.detailIconContainer}><Ionicons name="checkmark-done" size={20} color="#27ae60" /></View><Text style={styles.detailLabel}>Attempts Made</Text><Text style={styles.detailValue}>{attemptStatus.attempts_made}</Text></View>)}
          </View>
          <View style={styles.availabilityContainer}>
            <View style={styles.availabilityItem}><Ionicons name="calendar" size={16} color="#7f8c8d" /><Text style={styles.availabilityLabel}>Available From:</Text><Text style={styles.availabilityValue}>{formatDate(assessmentDetail.available_at)}</Text></View>
            {assessmentDetail.unavailable_at && <View style={styles.availabilityItem}><Ionicons name="calendar-outline" size={16} color="#e74c3c" /><Text style={styles.availabilityLabel}>Available Until:</Text><Text style={styles.availabilityValue}>{formatDate(assessmentDetail.unavailable_at)}</Text></View>}
          </View>
        </View>
        
        {/* Other sections like Assessment File and Previous Submission remain largely the same */}
        {isAssignmentType && assessmentDetail.assessment_file_url && (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionHeader}>Assignment Instructions</Text>
                <TouchableOpacity onPress={() => handleDownloadAssessmentFile(assessmentDetail.assessment_file_url!)} style={[styles.actionCard, !netInfo?.isInternetReachable && styles.actionCardDisabled]} disabled={!netInfo?.isInternetReachable}><View style={styles.actionCardContent}><View style={styles.actionCardIcon}><Ionicons name="download" size={24} color={netInfo?.isInternetReachable ? "#fff" : "#ccc"} /></View><View style={styles.actionCardText}><Text style={[styles.actionCardTitle, !netInfo?.isInternetReachable && styles.disabledText]}>Download Instructions</Text><Text style={[styles.actionCardSubtitle, !netInfo?.isInternetReachable && styles.disabledText]}>Get the assignment file</Text></View></View>{!netInfo?.isInternetReachable && <Text style={styles.offlineWarning}>Must be online to download</Text>}</TouchableOpacity>
            </View>
        )}
        {isAssignmentType && latestAssignmentSubmission?.has_submitted_file && (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionHeader}>Previous Submission</Text>
                <View style={styles.submissionCard}><View style={styles.submissionHeader}><View style={styles.submissionIconContainer}><Ionicons name="document-text" size={20} color="#27ae60" /></View><View style={styles.submissionInfo}><Text style={styles.submissionFileName}>{latestAssignmentSubmission.original_filename || 'Unknown File'}</Text>{latestAssignmentSubmission.status && <View style={[styles.statusBadge, latestAssignmentSubmission.status === 'to sync' ? { backgroundColor: '#f39c12' } : { backgroundColor: '#27ae60' }]}><Text style={styles.statusText}>{latestAssignmentSubmission.status.replace('_', ' ').toUpperCase()}</Text></View>}</View></View>{latestAssignmentSubmission.submitted_at && <Text style={styles.submissionDate}>Submitted: {formatDate(latestAssignmentSubmission.submitted_at)}</Text>}{latestAssignmentSubmission.submitted_file_url && <TouchableOpacity onPress={() => handleDownloadSubmittedFile(latestAssignmentSubmission.submitted_file_url!)} style={[styles.downloadButton, !netInfo?.isInternetReachable && styles.downloadButtonDisabled]} disabled={!netInfo?.isInternetReachable}><Ionicons name="cloud-download" size={16} color={netInfo?.isInternetReachable ? "#2196F3" : "#ccc"} /><Text style={[styles.downloadButtonText, !netInfo?.isInternetReachable && { color: '#ccc' }]}>Download Submission</Text></TouchableOpacity>}{!netInfo?.isInternetReachable && <Text style={styles.offlineWarning}>Must be online to download</Text>}</View>
            </View>
        )}
        
        {/* MODIFIED: Action Section */}
        <View style={styles.sectionContainer}>
          {isAssignmentType ? (
            <View>
              <Text style={styles.sectionHeader}>Submit Your Work</Text>
              
              {/* Display selected file or link */}
              {submissionType === 'file' && selectedFile ? (
                <View style={styles.submissionPreviewCard}>
                    <Ionicons name="document-attach" size={24} color="#1976d2" />
                    <Text style={styles.submissionPreviewText} numberOfLines={1}>{selectedFile.name}</Text>
                    <TouchableOpacity onPress={() => { setSelectedFile(null); setSubmissionType(null); }}>
                        <Ionicons name="close-circle" size={24} color="#d93025" />
                    </TouchableOpacity>
                </View>
              ) : submissionType === 'link' && submissionLink ? (
                <View style={styles.submissionPreviewCard}>
                    <Ionicons name="link" size={24} color="#1976d2" />
                    <Text style={styles.submissionPreviewText} numberOfLines={1}>{submissionLink}</Text>
                    <TouchableOpacity onPress={() => { setSubmissionLink(''); setSubmissionType(null); }}>
                        <Ionicons name="close-circle" size={24} color="#d93025" />
                    </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.submitButton}
                  onPress={() => setSubmissionModalVisible(true)}
                  disabled={!isAssessmentCurrentlyOpen || submissionLoading}
                >
                  <Ionicons name="add-circle" size={24} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.submitButtonText}>Add Submission</Text>
                </TouchableOpacity>
              )}

              {/* Final Submit Button appears after selecting a file/link */}
              {(submissionType === 'file' || submissionType === 'link') && (
                <TouchableOpacity
                    style={[styles.submitButton, {marginTop: 12, backgroundColor: '#388e3c'}]}
                    onPress={handleSubmitAssignment}
                    disabled={!isAssessmentCurrentlyOpen || submissionLoading}
                >
                    {submissionLoading ? <ActivityIndicator color="#fff" /> : <><Ionicons name="cloud-upload" size={24} color="#fff" style={{ marginRight: 8 }} /><Text style={styles.submitButtonText}>Submit Now</Text></>}
                </TouchableOpacity>
              )}
            </View>
          ) : (
            // Quiz/Exam Start Section (unchanged)
            <View>
              <Text style={styles.sectionHeader}>Take Assessment</Text>
              <TouchableOpacity
                style={[styles.submitButton, isQuizAttemptButtonDisabled && styles.submitButtonDisabled]}
                onPress={handleStartQuizAttempt}
                disabled={isQuizAttemptButtonDisabled}
              >
                {submissionLoading ? <ActivityIndicator color="#fff" /> : <><Ionicons name={hasOfflineAttempt ? "play" : "play-circle"} size={24} color="#fff" style={{ marginRight: 8 }} /><Text style={styles.submitButtonText}>{quizButtonText}</Text></>}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Submitted Assessment Score and Status (unchanged) */}
        {assessmentDetail && (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionHeader}>Your Submission</Text>
                {!netInfo?.isInternetReachable ? (<View style={styles.offlineSubmissionContainer}><Ionicons name="cloud-offline" size={24} color="#7f8c8d" /><Text style={styles.offlineSubmissionText}>Submission data is not available offline.</Text></View>) : (<View style={styles.submissionStatusContainer}>{submittedAssessment ? (<><View style={styles.submissionStatusItem}><View style={styles.submissionIconContainer}><Ionicons name="star" size={20} color={submittedAssessment.score !== null ? "#f39c12" : "#7f8c8d"} /></View><Text style={styles.submissionLabel}>Score:</Text><Text style={[styles.submissionValue, { color: submittedAssessment.score !== null ? "#2c3e50" : "#7f8c8d" }]}>{submittedAssessment.score !== null ? `${submittedAssessment.score} / ${assessmentDetail.total_points || 0}` : 'Not yet taken'}</Text></View><View style={styles.submissionStatusItem}><View style={styles.submissionIconContainer}><Ionicons name={getStatusIcon(submittedAssessment.status)} size={20} color={getStatusColor(submittedAssessment.status)} /></View><Text style={styles.submissionLabel}>Status:</Text><Text style={[styles.submissionValue, { color: getStatusColor(submittedAssessment.status) }]}>{getStatusText(submittedAssessment.status)}</Text></View>{(submittedAssessment.status === 'completed' || submittedAssessment.status === 'graded') && <View style={styles.completionInfoContainer}><Text style={styles.completionInfoText}>{submittedAssessment.status === 'graded' ? 'Results graded.' : 'Awaiting grading.'}</Text></View>}</>) : (<View style={styles.loadingSubmissionContainer}><ActivityIndicator size="small" /><Text style={styles.loadingSubmissionText}>Loading status...</Text></View>)}</View>)}
            </View>
        )}
      </ScrollView>

      {/* NEW: Submission Choice Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isSubmissionModalVisible}
        onRequestClose={() => setSubmissionModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Choose Submission Type</Text>
            
            {/* Upload File Option */}
            <TouchableOpacity style={styles.modalButton} onPress={() => { setSubmissionModalVisible(false); handlePickDocument(); }}>
              <Ionicons name="document-attach-outline" size={24} color="#1967d2" />
              <Text style={styles.modalButtonText}>Upload a File</Text>
            </TouchableOpacity>
            <Text style={styles.modalHint}>Max file size: 50MB</Text>

            {/* Submit Link Option */}
            <TouchableOpacity style={styles.modalButton} onPress={() => { setSubmissionType('link'); }}>
              <Ionicons name="link-outline" size={24} color="#388e3c" />
              <Text style={styles.modalButtonText}>Submit a Link</Text>
            </TouchableOpacity>
            
            {submissionType === 'link' && (
              <View style={styles.linkInputContainer}>
                <TextInput
                  style={styles.linkInput}
                  placeholder="https://example.com/your-work"
                  placeholderTextColor="#9aa0a6"
                  value={submissionLink}
                  onChangeText={setSubmissionLink}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <TouchableOpacity style={styles.linkSubmitButton} onPress={() => { setSubmissionModalVisible(false); }}>
                    <Text style={styles.linkSubmitButtonText}>Confirm Link</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={styles.modalCancelButton} onPress={() => { setSubmissionModalVisible(false); setSubmissionType(null); }}>
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// *** UPDATED HEADER STYLES ***
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 16, fontSize: 16, color: '#5f6368' },
  errorText: { fontSize: 16, color: '#d93025', textAlign: 'center', marginVertical: 16 },
  retryButton: { backgroundColor: '#1967d2', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginTop: 8 },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  scrollViewContent: { paddingBottom: 24 },
  
  // Redesigned header styles
  headerContainer: { 
    backgroundColor: '#fff', 
    padding: 20, 
    borderBottomWidth: 1, 
    borderBottomColor: '#e0e0e0' 
  },
  assessmentTypeBadge: { 
    alignSelf: 'flex-start',
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 16,
    marginBottom: 12 
  },
  assessmentTypeText: { 
    color: '#fff', 
    fontSize: 12, 
    fontWeight: '600', 
    letterSpacing: 0.5 
  },
  assessmentTitle: { 
    fontSize: 26, 
    fontWeight: '600', 
    color: '#202124', 
    textAlign: 'left', 
    marginBottom: 16
  },
  descriptionContainer: {
    backgroundColor: '#f1f3f4',
    borderRadius: 8,
    padding: 16,
    width: '100%',
  },
  assessmentDescription: {
    fontSize: 14,
    color: '#3c4043',
    textAlign: 'left',
    lineHeight: 22,
  },
  offlineNotice: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    alignSelf: 'flex-start', 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    backgroundColor: '#f1f3f4', 
    borderRadius: 16, 
    marginTop: 16, 
    gap: 6 
  },
  offlineText: { fontSize: 12, color: '#5f6368', fontWeight: '500' },
  
  // (The rest of the styles remain unchanged)
  sectionContainer: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#e0e0e0' },
  sectionHeader: { fontSize: 18, fontWeight: '500', color: '#202124', marginBottom: 16 },
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  detailCard: { flex: 1, minWidth: '45%', backgroundColor: '#f8f9fa', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#e0e0e0' },
  detailIconContainer: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  detailLabel: { fontSize: 12, color: '#5f6368', marginBottom: 4 },
  detailValue: { fontSize: 16, fontWeight: '600', color: '#202124' },
  availabilityContainer: { gap: 12 },
  availabilityItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  availabilityLabel: { fontSize: 13, color: '#5f6368', fontWeight: '500' },
  availabilityValue: { fontSize: 13, color: '#202124', flex: 1 },
  actionCard: { backgroundColor: '#1967d2', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#1967d2' },
  actionCardDisabled: { backgroundColor: '#f1f3f4', borderColor: '#e0e0e0' },
  actionCardContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionCardIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255, 255, 255, 0.2)', justifyContent: 'center', alignItems: 'center' },
  actionCardText: { flex: 1 },
  actionCardTitle: { fontSize: 16, fontWeight: '500', color: '#fff', marginBottom: 4 },
  actionCardSubtitle: { fontSize: 13, color: 'rgba(255, 255, 255, 0.8)' },
  disabledText: { color: '#9aa0a6' },
  offlineWarning: { fontSize: 12, color: '#d93025', marginTop: 8, textAlign: 'center' },
  submissionCard: { backgroundColor: '#f8f9fa', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#e0e0e0' },
  submissionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  submissionIconContainer: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: '#e6f4ea' },
  submissionInfo: { flex: 1 },
  submissionFileName: { fontSize: 14, fontWeight: '500', color: '#202124', marginBottom: 4 },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  statusText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  submissionDate: { fontSize: 12, color: '#5f6368', marginBottom: 12 },
  downloadButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#e8f0fe', borderRadius: 8, gap: 8, borderWidth: 1, borderColor: '#1967d2' },
  downloadButtonDisabled: { backgroundColor: '#f1f3f4', borderColor: '#e0e0e0' },
  downloadButtonText: { fontSize: 14, color: '#1967d2', fontWeight: '500' },
  filePickerCard: { backgroundColor: '#f8f9fa', borderRadius: 8, padding: 16, marginBottom: 16, borderWidth: 2, borderColor: '#e0e0e0', borderStyle: 'dashed' },
  filePickerContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  filePickerIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  filePickerText: { flex: 1 },
  filePickerTitle: { fontSize: 14, fontWeight: '500', color: '#202124', marginBottom: 4 },
  filePickerSubtitle: { fontSize: 12, color: '#5f6368' },
  submitButton: { backgroundColor: '#1967d2', borderRadius: 8, paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  submitButtonDisabled: { backgroundColor: '#dadce0', shadowOpacity: 0, elevation: 0 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  offlineSubmissionContainer: { padding: 24, alignItems: 'center', gap: 12 },
  offlineSubmissionText: { fontSize: 14, color: '#5f6368', textAlign: 'center', lineHeight: 20 },
  submissionStatusContainer: { gap: 12 },
  submissionStatusItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  submissionLabel: { fontSize: 14, color: '#5f6368', fontWeight: '500', minWidth: 60 },
  submissionValue: { fontSize: 14, fontWeight: '600', flex: 1 },
  completionInfoContainer: { marginTop: 12, padding: 12, backgroundColor: '#e6f4ea', borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#137333' },
  completionInfoText: { fontSize: 13, color: '#137333', lineHeight: 18 },
  loadingSubmissionContainer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  loadingSubmissionText: { fontSize: 14, color: '#5f6368' },
  submissionPreviewCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8f0fe', borderRadius: 8, padding: 12, gap: 12, borderWidth: 1, borderColor: '#1967d2' },
  submissionPreviewText: { flex: 1, fontSize: 14, color: '#202124' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContainer: { width: '90%', backgroundColor: '#fff', borderRadius: 12, padding: 24, gap: 16 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#202124', textAlign: 'center', marginBottom: 8 },
  modalButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f9fa', borderRadius: 8, padding: 16, gap: 12, borderWidth: 1, borderColor: '#e0e0e0' },
  modalButtonText: { fontSize: 16, fontWeight: '500', color: '#202124' },
  modalHint: { fontSize: 12, color: '#5f6368', textAlign: 'center', marginTop: -8 },
  linkInputContainer: { marginTop: 8, gap: 8 },
  linkInput: { borderWidth: 1, borderColor: '#dadce0', borderRadius: 8, padding: 12, fontSize: 14, color: '#202124' },
  linkSubmitButton: { backgroundColor: '#388e3c', padding: 12, borderRadius: 8, alignItems: 'center' },
  linkSubmitButtonText: { color: '#fff', fontWeight: '500' },
  modalCancelButton: { marginTop: 8, padding: 12, alignItems: 'center' },
  modalCancelButtonText: { fontSize: 16, color: '#5f6368' },
});