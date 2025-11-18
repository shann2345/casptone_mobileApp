// review-answer.tsx

import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../../../../context/NetworkContext';
import api, { getUserData } from '../../../../../lib/api';
import { getAssessmentReviewFromDb } from '../../../../../lib/localDb';

// Define the data structures for clarity
interface OriginalQuestion {
  id: number;
  question_text: string;
  question_type: string;
  correct_answer: string | null; // This holds 'True'/'False' for T/F, option_order for MC, text for ID
  points: number;
  questionOptions?: { id: number; question_id: number; option_text: string; option_order: number }[]; // For finding correct option text
}

interface SubmittedOption {
  id: number;
  question_option_id: number;
  option_text: string;
  is_correct_option: boolean; // Note: We rely less on this now
  is_selected: boolean;
}

interface SubmittedQuestion {
  id: number;
  question_text: string;
  question_type: 'multiple_choice' | 'true_false' | 'essay' | 'identification';
  max_points: number;
  submitted_answer: string | null;
  is_correct: boolean | null;
  score_earned: number | null;
  submitted_options?: SubmittedOption[];
  question?: OriginalQuestion; // Contains the original question details including correct_answer
}

interface ReviewData {
  id: number;
  score: number | null;
  status: string;
  assessment: {
    title: string;
    points: number;
    type: string;
  };
  submitted_questions: SubmittedQuestion[];
}

export default function ReviewAnswerScreen() {
  const { assessmentId, submittedAssessmentId, isOffline } = useLocalSearchParams<{
    assessmentId: string;
    submittedAssessmentId?: string;
    isOffline?: string;
  }>();
  const router = useRouter();
  const { netInfo } = useNetworkStatus();
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Screenshot prevention useEffect (no changes)
  useEffect(() => {
    const activateScreenshotPrevention = async () => { await ScreenCapture.preventScreenCaptureAsync(); };
    const deactivateScreenshotPrevention = async () => { await ScreenCapture.allowScreenCaptureAsync(); };
    activateScreenshotPrevention();
    const subscription = ScreenCapture.addScreenshotListener(() => {
      Alert.alert('Screenshot Not Allowed', 'For security reasons, taking screenshots is not allowed during assessment review. This attempt has been noted.', [{ text: 'OK' }]);
    });
    return () => { deactivateScreenshotPrevention(); subscription.remove(); };
  }, []);

  // fetchReviewData useEffect (no changes)
  useEffect(() => {
    const fetchReviewData = async () => {
      setLoading(true); setError(null);
      const user = await getUserData();
      if (!assessmentId || !user?.email) { setError('Required information is missing.'); setLoading(false); return; }
      try {
        let data: ReviewData | null = null;
        if (isOffline === 'true') {
          console.log(`📘 Offline: Fetching review data for assessment ${assessmentId} from local DB.`);
          data = await getAssessmentReviewFromDb(Number(assessmentId), user.email);
          if (!data) setError('Review data for this assessment is not available offline. Please sync online first.');
        } else {
          if (!submittedAssessmentId) { setError('Submission ID is missing for online review.'); setLoading(false); return; }
          console.log(`🧠 Online: Fetching review data for submission ${submittedAssessmentId} from API.`);
          const response = await api.get(`/submitted-assessments/${submittedAssessmentId}`);
          if (response.status === 200 && response.data.submitted_assessment) data = response.data.submitted_assessment;
          else setError('Failed to load review data from the server.');
        }
        setReviewData(data);
      } catch (err) { console.error('Failed to load review data:', err); setError('An error occurred while loading the review.'); }
      finally { setLoading(false); }
    };
    fetchReviewData();
  }, [assessmentId, submittedAssessmentId, isOffline]);

  // Loading/Error states (no changes)
  if (loading) return <View style={styles.centerContainer}><ActivityIndicator size="large" color="#007bff" /><Text style={styles.loadingText}>Loading Review...</Text></View>;
  if (error || !reviewData) return <View style={styles.centerContainer}><Ionicons name="alert-circle-outline" size={48} color="#d93025" /><Text style={styles.errorText}>{error || 'Review data not found.'}</Text><TouchableOpacity onPress={() => router.back()} style={styles.backButton}><Text style={styles.backButtonText}>Go Back</Text></TouchableOpacity></View>;

  const totalPoints = Math.round(reviewData.submitted_questions.reduce((sum, q) => sum + (q.max_points || 0), 0));
  const finalScore = reviewData.score !== null ? Math.round(reviewData.score) : 'N/A';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollViewContent}>
      <Stack.Screen options={{ title: `${reviewData.assessment.title} - Review` }} />

      {/* Header Card (no changes) */}
      <View style={styles.headerCard}>
        <Text style={styles.quizTitle}>{reviewData.assessment.title}</Text>
        <Text style={styles.finalScoreText}>Final Score: {finalScore} / {totalPoints}</Text>
        <Text style={styles.quizStatus}>Status: {reviewData.status.replace('_', ' ')}</Text>
        {!netInfo?.isInternetReachable && <Text style={styles.offlineStatus}>⚠️ Viewing offline version</Text>}
      </View>

      {reviewData.submitted_questions.map((question, qIndex) => {
        // Determine correctness based on score (no changes)
        let isQuestionCorrect: boolean | null;
        if (question.score_earned !== null && question.max_points > 0) isQuestionCorrect = question.score_earned >= question.max_points;
        else isQuestionCorrect = null;
        if (question.question_type === 'essay') isQuestionCorrect = null;

        let optionsToRender = question.submitted_options || [];
        if (question.question_type === 'true_false' && (optionsToRender.length === 0 || optionsToRender.length === 1 || optionsToRender.length === 2 && !optionsToRender.find(o => o.option_text === 'True'))) {
          const submittedAnswerText = question.submitted_answer; let selectedId: number | null = null;
          
          // --- MODIFICATION: Make comparison case-insensitive ---
          if (submittedAnswerText?.toLowerCase() === 'true') {
            selectedId = 1;
          } else if (submittedAnswerText?.toLowerCase() === 'false') {
            selectedId = 2;
          }
          // --- END MODIFICATION ---

          optionsToRender = [
            { id: question.id * 100 + 1, question_option_id: 1, option_text: 'True', is_selected: selectedId === 1, is_correct_option: false },
            { id: question.id * 100 + 2, question_option_id: 2, option_text: 'False', is_selected: selectedId === 2, is_correct_option: false }
          ];
        }

        let correctAnswerText: string | null = null;
        const originalQ = question.question; // Shortcut for original question data

        if (originalQ?.correct_answer !== null && originalQ?.correct_answer !== undefined) {
          if (question.question_type === 'identification') {
            correctAnswerText = originalQ.correct_answer;
          } else if (question.question_type === 'true_false') {
            correctAnswerText = originalQ.correct_answer; // Direct text "True" or "False"
          } else if (question.question_type === 'multiple_choice') {
            // Find the option text using the option_order saved in correct_answer
            const correctOptionOrder = originalQ.correct_answer; // This is '0', '1', '2'...
            const correctOption = (originalQ.questionOptions || []).find(opt => String(opt.option_order) === String(correctOptionOrder));
            correctAnswerText = correctOption?.option_text || null; // Get the text
          }
        }
        // --- END MODIFIED ---

        return (
          <View key={question.id} style={styles.questionCard}>
            <Text style={styles.questionText}>Q{qIndex + 1}. {question.question_text}</Text>

            {/* Multiple Choice & True/False Options */}
            {(question.question_type === 'multiple_choice' || question.question_type === 'true_false') && (
              <View style={styles.optionsContainer}>
                {(optionsToRender || []).map((option) => {
                  const isSelectedByUser = !!option.is_selected;

                  // Determine if this is the actual correct option using original question data
                  const correctOptionValue = originalQ?.correct_answer;
                  let isCorrectOption = false;

                  if (question.question_type === 'true_false' && correctOptionValue) {
                      isCorrectOption = option.option_text.toLowerCase() === correctOptionValue.toLowerCase();
                  } else if (question.question_type === 'multiple_choice' && correctOptionValue !== null && correctOptionValue !== undefined) {
                     const currentOptionOrder = (originalQ?.questionOptions || []).find(opt => opt.id === option.question_option_id)?.option_order;
                     if (currentOptionOrder !== undefined && !isNaN(Number(correctOptionValue))) {
                         isCorrectOption = currentOptionOrder === Number(correctOptionValue);
                     }
                  } else {
                    isCorrectOption = !!option.is_correct_option; // Fallback
                  }

                  // Determine styling (no changes needed here)
                  const shouldShowGreen = isSelectedByUser && isQuestionCorrect === true;
                  const shouldShowRed = isSelectedByUser && isQuestionCorrect === false;
                  const shouldShowMissedCorrect = isCorrectOption && !isSelectedByUser && question.question_type === 'multiple_choice';

                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.optionButton,
                        shouldShowGreen && styles.correctOption,
                        shouldShowRed && styles.incorrectOption,
                        shouldShowMissedCorrect && styles.correctOption,
                      ]}
                      disabled
                    >
                      <View style={styles.radioCircle}>
                        {isSelectedByUser && <View style={styles.radioChecked} />}
                      </View>
                      <Text style={styles.optionText}>{option.option_text}</Text>
                      {shouldShowGreen && <Ionicons name="checkmark-circle" size={22} color="#137333" style={styles.correctnessIcon} />}
                      {shouldShowRed && <Ionicons name="close-circle" size={22} color="#d93025" style={styles.correctnessIcon} />}
                      {shouldShowMissedCorrect && <Ionicons name="checkmark-circle-outline" size={22} color="#137333" style={styles.correctnessIcon} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Identification & Essay Answer Display (no changes)*/}
            {['identification', 'essay'].includes(question.question_type) && (
              <View style={styles.answerContainer}>
                <Text style={styles.answerLabel}>Your Answer:</Text>
                <Text style={[styles.answerText,
                  isQuestionCorrect === false && question.question_type === 'identification' && styles.incorrectAnswerText,
                  isQuestionCorrect === true && question.question_type === 'identification' && styles.correctAnswerBox
                ]}>
                  {question.submitted_answer || '(No answer provided)'}
                </Text>
                {question.question_type === 'essay' && (
                  <View style={styles.essayNoteContainer}>
                    <Ionicons name="information-circle-outline" size={18} color="#00579b" />
                    <Text style={styles.essayNoteText}>Note: This question is for manual checking by your instructor.</Text>
                  </View>
                )}
              </View>
            )}

            {/* {correctAnswerText && (question.question_type === 'identification' || question.question_type === 'true_false' || question.question_type === 'multiple_choice') && (
              <View style={styles.correctAnswerContainer}>
                <Text style={styles.correctAnswerLabel}>Correct Answer:</Text>
                <Text style={styles.correctAnswerText}>{correctAnswerText}</Text>
              </View>
            )} */}


            {/* Score Display (no changes) */}
            <View style={styles.pointsContainer}>
              {question.question_type === 'essay' ? (
                <Text style={[styles.scoreText, styles.pendingScore]}>Score: Pending Review ({Math.round(question.max_points)} pts possible)</Text>
              ) : (
                <Text style={[ styles.scoreText, isQuestionCorrect === true ? styles.correctScore : (isQuestionCorrect === false ? styles.incorrectScore : null) ]}>
                  Score: {question.score_earned !== null ? Math.round(question.score_earned) : 'N/A'} / {Math.round(question.max_points)}
                  {isQuestionCorrect === true && ' ✓'}
                  {isQuestionCorrect === false && ' ✗'}
                </Text>
              )}
            </View>
          </View>
        );
      })}

      {/* Back Button (no changes) */}
      <TouchableOpacity onPress={() => router.replace(`/courses/assessments/${assessmentId}`)} style={styles.backButton}>
        <Text style={styles.backButtonText}>Back to Assessment</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// Styles (no changes)
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  scrollViewContent: { padding: 16, paddingBottom: 32 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontSize: 16, color: '#5f6368' },
  errorText: { fontSize: 16, color: '#d93025', textAlign: 'center', marginBottom: 16 },
  headerCard: { backgroundColor: '#fff', borderRadius: 8, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#e0e0e0' },
  quizTitle: { fontSize: 24, fontWeight: '600', color: '#202124', marginBottom: 8 },
  finalScoreText: { fontSize: 18, color: '#1967d2', fontWeight: '600', marginBottom: 8 },
  quizStatus: { fontSize: 14, color: '#5f6368', textTransform: 'capitalize' },
  offlineStatus: { fontSize: 14, color: '#e37400', marginTop: 6, fontWeight: '600' },
  questionCard: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e0e0e0' },
  questionText: { fontSize: 16, fontWeight: '500', color: '#202124', lineHeight: 24, marginBottom: 16 },
  optionsContainer: { gap: 8 },
  optionButton: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, backgroundColor: '#f8f9fa', borderRadius: 8, borderWidth: 1.5, borderColor: '#e0e0e0' },
  correctOption: { borderColor: '#137333', backgroundColor: '#e6f4ea' },
  incorrectOption: { borderColor: '#d93025', backgroundColor: '#fce8e6' },
  optionText: { flex: 1, fontSize: 15, color: '#202124', lineHeight: 22 },
  correctnessIcon: { marginLeft: 'auto', paddingLeft: 10 },
  radioCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#5f6368', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  radioChecked: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1967d2' },
  checkboxSquare: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: '#5f6368', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  checkboxCheck: { color: '#1967d2', fontSize: 14, fontWeight: 'bold' },
  answerContainer: { marginTop: 8, gap: 8 },
  answerLabel: { fontSize: 13, color: '#5f6368', fontWeight: 'bold' },
  answerText: { fontSize: 15, color: '#202124', padding: 10, backgroundColor: '#f1f3f4', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' },
  incorrectAnswerText: { borderColor: '#d93025', backgroundColor: '#fce8e6' },
  correctAnswerBox: { borderColor: '#137333', backgroundColor: '#e6f4ea' },
  correctAnswerContainer: { marginTop: 12, padding: 10, backgroundColor: '#e6f4ea', borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#137333' },
  correctAnswerLabel: { fontSize: 13, fontWeight: 'bold', color: '#137333' },
  correctAnswerText: { fontSize: 15, color: '#0d652d' },
  essayNoteContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 10, backgroundColor: '#e8f0fe', borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#1967d2' },
  essayNoteText: { flex: 1, fontSize: 13, color: '#00579b', marginLeft: 8, lineHeight: 18 },
  pointsContainer: { alignItems: 'flex-end', marginTop: 12 },
  scoreText: { fontSize: 14, fontWeight: '600' },
  correctScore: { color: '#137333' },
  incorrectScore: { color: '#d93025' },
  pendingScore: { color: '#00579b', fontStyle: 'italic' },
  backButton: { backgroundColor: '#1967d2', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  backButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});