import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNetworkStatus } from '../../../../../context/NetworkContext';
import api, { getUserData } from '../../../../../lib/api';
import { getDb, getOfflineQuizAttempt } from '../../../../../lib/localDb';

interface SubmittedOption {
  id: number;
  submitted_question_id: number;
  question_option_id: number;
  option_text: string;
  is_correct_option: boolean;
  is_selected: boolean;
}

interface SubmittedQuestion {
  id: number;
  submitted_assessment_id: number;
  question_id: number;
  question_text: string;
  question_type: 'multiple_choice' | 'true_false' | 'essay' | 'identification';
  max_points: number;
  submitted_answer: string | null;
  is_correct: boolean | null;
  score_earned: number | null;
  submitted_options?: SubmittedOption[];
}

interface AssessmentDetail {
  id: number;
  course_id: number;
  title: string;
  description?: string;
  type: 'quiz' | 'exam';
  duration_minutes?: number;
  points: number;
}

interface SubmittedAssessmentData {
  id: number;
  assessment_id: number;
  student_id: number;
  score: number | null;
  status: 'in_progress' | 'completed' | 'graded';
  started_at: string;
  completed_at: string | null;
  submitted_file_path: string | null;
  submitted_questions: SubmittedQuestion[];
  assessment: AssessmentDetail;
}

type StudentAnswers = {
  [submittedQuestionId: number]: {
    type: SubmittedQuestion['question_type'];
    answer: string | number[];
    isDirty?: boolean;
  };
};

export default function AttemptQuizScreen() {
  const { submittedAssessmentId, assessmentId, isOffline } = useLocalSearchParams();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const [submittedAssessment, setSubmittedAssessment] = useState<SubmittedAssessmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studentAnswers, setStudentAnswers] = useState<StudentAnswers>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [timerInterval, setTimerInterval] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [savingAnswers, setSavingAnswers] = useState<Set<number>>(new Set());
  const debounceTimers = useRef<{ [key: number]: ReturnType<typeof setTimeout> | null }>({});
  const studentAnswersRef = useRef<StudentAnswers>(studentAnswers);

  // Update the ref whenever studentAnswers state changes
  useEffect(() => {
    studentAnswersRef.current = studentAnswers;
  }, [studentAnswers]);

  useEffect(() => {
    // Determine which ID to use based on the mode
    const idToFetch = isOffline === 'true' ? assessmentId : submittedAssessmentId;
    if (idToFetch) {
      fetchQuizData(Number(idToFetch));
    }

    return () => {
      if (timerInterval) {
        clearInterval(timerInterval);
      }
      // Clean up all debounce timers on unmount
      Object.values(debounceTimers.current).forEach(timer => {
        if (timer) clearTimeout(timer);
      });
    };
  }, [submittedAssessmentId, assessmentId, isOffline]);

  useEffect(() => {
    if (submittedAssessment && submittedAssessment.assessment.duration_minutes && submittedAssessment.status === 'in_progress') {
      const startTime = new Date(submittedAssessment.started_at).getTime();
      const durationMs = submittedAssessment.assessment.duration_minutes * 60 * 1000;
      const endTime = startTime + durationMs;

      const calculateTimeLeft = () => {
        const now = new Date().getTime();
        const remainingMs = endTime - now;
        if (remainingMs <= 0) {
          setTimeLeft(0);
          if (timerInterval) clearInterval(timerInterval);
          if (submittedAssessment.status === 'in_progress') {
            Alert.alert("Time's Up!", "Your quiz will be automatically submitted.", [
              { text: "OK", onPress: () => handleFinalizeQuiz() }
            ]);
          }
        } else {
          setTimeLeft(Math.floor(remainingMs / 1000));
        }
      };

      calculateTimeLeft();
      const interval = setInterval(calculateTimeLeft, 1000);
      setTimerInterval(interval);
    }
  }, [submittedAssessment]);

  const fetchQuizData = async (id: number) => {
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
    if (isOffline === 'true') {
      // OFFLINE MODE - Fetch from offline_quiz_attempts table
      console.log("⚠️ Offline: Fetching quiz attempt from local DB.");
      const offlineData = await getOfflineQuizAttempt(userEmail, id);

      if (offlineData) {
        // Debug the data structure
        console.log("Offline questionsData structure:", JSON.stringify(offlineData.questionsData, null, 2));
        
        // Handle the questions data - it should be an array directly
        let questions = [];
        if (Array.isArray(offlineData.questionsData)) {
          questions = offlineData.questionsData;
        } else if (offlineData.questionsData?.questions) {
          questions = offlineData.questionsData.questions;
        } else {
          console.error("No questions found in offline data");
          console.error("Expected structure: [...] or { questions: [...] }");
          console.error("Actual structure:", offlineData.questionsData);
          setError('Quiz questions not found in offline data. Please restart the quiz.');
          Alert.alert(
            'Data Error',
            'Quiz questions structure is invalid. Please go back and start the quiz again.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
          setLoading(false);
          return;
        }

        // Map the offline data to match the expected structure
        const mockSubmittedAssessment: SubmittedAssessmentData = {
          id: -1, // Temporary ID for offline attempts
          assessment_id: offlineData.assessmentData.id,
          student_id: 0, // Placeholder
          score: null,
          status: 'in_progress',
          started_at: new Date().toISOString(),
          completed_at: null,
          submitted_file_path: null,
          submitted_questions: questions.map((q: any, index: number) => ({
            id: q.id || index, // Use question ID or index as fallback
            submitted_assessment_id: -1,
            question_id: q.id || index,
            question_text: q.question_text || q.text,
            question_type: q.question_type || q.type,
            max_points: q.max_points || q.points || 1,
            submitted_answer: null,
            is_correct: null,
            score_earned: null,
            submitted_options: q.options ? q.options.map((opt: any, optIndex: number) => ({
              id: opt.id || optIndex,
              submitted_question_id: q.id || index,
              question_option_id: opt.id || optIndex,
              option_text: opt.option_text || opt.text,
              is_correct_option: opt.is_correct_option || opt.is_correct || false,
              is_selected: false,
            })) : []
          })),
          assessment: offlineData.assessmentData,
        };
        
        setSubmittedAssessment(mockSubmittedAssessment);
        initializeStudentAnswers(mockSubmittedAssessment.submitted_questions);
        console.log("✅ Offline quiz data loaded successfully");
      } else {
        setError('Offline: Quiz attempt not found locally. Please start the quiz first while online.');
        Alert.alert(
          'Quiz Not Found', 
          'This quiz attempt was not found in local storage. Please connect to the internet and start the quiz again.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      }
    } else {
      // ONLINE MODE - existing logic remains the same
      console.log("✅ Online: Fetching submitted quiz details from API.");
      const response = await api.get(`/submitted-assessments/${id}`);
      if (response.status === 200) {
        const fetchedSubmittedAssessment = response.data.submitted_assessment;
        setSubmittedAssessment(fetchedSubmittedAssessment);
        initializeStudentAnswers(fetchedSubmittedAssessment.submitted_questions);
        console.log("API Response for Submitted Quiz Details:", JSON.stringify(response.data, null, 2));
      } else {
        setError(response.data?.message || 'Failed to fetch submitted quiz details.');
      }
    }
  } catch (err: any) {
    console.error("Error fetching quiz details:", err.response?.data || err);
    if (isOffline === 'true') {
      setError('Failed to load offline quiz data.');
      Alert.alert('Error', 'Failed to load quiz from local storage.');
    } else {
      setError(err.response?.data?.message || 'An unexpected error occurred while fetching quiz details.');
    }
  } finally {
    setLoading(false);
  }
};

  const initializeStudentAnswers = (questions: SubmittedQuestion[]) => {
    const initialAnswers: StudentAnswers = {};
    questions.forEach((q: SubmittedQuestion) => {
      if (q.question_type === 'multiple_choice' || q.question_type === 'true_false') {
        const selectedOptions = q.submitted_options?.filter(opt => opt.is_selected).map(opt => opt.question_option_id) || [];
        initialAnswers[q.id] = { type: q.question_type, answer: selectedOptions, isDirty: false };
      } else {
        initialAnswers[q.id] = { type: q.question_type, answer: q.submitted_answer || '', isDirty: false };
      }
    });
    setStudentAnswers(initialAnswers);
  };

  const saveAnswer = async (submittedQuestionId: number) => {
    const answerData = studentAnswersRef.current[submittedQuestionId];
    if (!answerData || !answerData.isDirty) return;

    setSavingAnswers(prev => new Set(prev.add(submittedQuestionId)));

    try {
      if (isConnected) {
        // ONLINE MODE
        let payload: any = {};
        if (answerData.type === 'multiple_choice' || answerData.type === 'true_false') {
          payload.selected_option_ids = answerData.answer as number[];
        } else {
          payload.submitted_answer = answerData.answer as string;
        }

        const response = await api.patch(`/submitted-questions/${submittedQuestionId}/answer`, payload);

        if (response.status === 200) {
          setStudentAnswers(prev => ({
            ...prev,
            [submittedQuestionId]: { ...prev[submittedQuestionId], isDirty: false }
          }));
          console.log("API Response for Submitted Quiz Details:", JSON.stringify(response.data, null, 2));
        }
      } else {
        // OFFLINE MODE
        // No need to save individual answers, they will be part of the final submission
        setStudentAnswers(prev => ({
          ...prev,
          [submittedQuestionId]: { ...prev[submittedQuestionId], isDirty: false }
        }));
      }
    } catch (err: any) {
      console.error('Error saving answer:', err.response?.data || err);
    } finally {
      setSavingAnswers(prev => {
        const newSet = new Set(prev);
        newSet.delete(submittedQuestionId);
        return newSet;
      });
    }
  };

  const handleAnswerChange = (submittedQuestionId: number, type: SubmittedQuestion['question_type'], value: string | number | number[]) => {
    setStudentAnswers((prevAnswers) => ({
      ...prevAnswers,
      [submittedQuestionId]: { type, answer: value, isDirty: true },
    }));

    if (isConnected) { // Only debounce and save if online
      if (debounceTimers.current[submittedQuestionId]) {
        clearTimeout(debounceTimers.current[submittedQuestionId] as unknown as NodeJS.Timeout);
      }

      debounceTimers.current[submittedQuestionId] = setTimeout(() => {
        saveAnswer(submittedQuestionId);
      }, 1000);
    }
  };

  const handleFinalizeQuiz = async () => {
  if (!submittedAssessment) {
    Alert.alert('Error', 'Quiz data not loaded.');
    return;
  }
  
  Alert.alert(
    'Confirm Submission',
    'Are you sure you want to finalize and submit your quiz? This action cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Submit',
        onPress: async () => {
          setLoading(true);
          if (timerInterval) clearInterval(timerInterval);

          try {
            if (isConnected && isOffline !== 'true') {
              // ONLINE MODE - existing logic
              const pendingAnswers = Object.keys(studentAnswers)
                .filter(key => studentAnswers[parseInt(key)].isDirty)
                .map(key => parseInt(key));

              for (const submittedQuestionId of pendingAnswers) {
                await saveAnswer(submittedQuestionId);
              }

              const response = await api.post(`/submitted-assessments/${submittedAssessment.id}/finalize-quiz`);

              if (response.status === 200) {
                Alert.alert('Success', 'Quiz submitted successfully!', [
                  {
                    text: 'OK',
                    onPress: () => router.replace(`/courses/assessments/${submittedAssessment.assessment_id}`)
                  }
                ]);
              } else {
                Alert.alert('Submission Failed', response.data?.message || 'Could not submit quiz.');
              }
            } else {
              // OFFLINE MODE - Save completed attempt locally
              const user = await getUserData();
              if (!user || !user.email) {
                throw new Error('User data not available for offline submission.');
              }
              
              // Update the offline quiz attempt status to completed
              const db = await getDb();
              await db.runAsync(
                `UPDATE offline_quiz_attempts 
                 SET status = 'completed' 
                 WHERE user_email = ? AND assessment_id = ? AND status = 'in progress';`,
                [user.email, submittedAssessment.assessment_id]
              );
              
              // Save the final answers (you might want to save these separately for syncing later)
              const finalAnswers = JSON.stringify(studentAnswers);
              
              Alert.alert(
                'Offline Submission', 
                'Your quiz has been saved locally and will be submitted once you are online.',
                [
                  {
                    text: 'OK',
                    onPress: () => router.replace(`/courses/assessments/${submittedAssessment.assessment_id}`)
                  }
                ]
              );
            }
          } catch (err: any) {
            console.error('Quiz submission error:', err.response?.data || err);
            Alert.alert('Submission Failed', err.response?.data?.message || 'An error occurred during submission.');
          } finally {
            setLoading(false);
          }
        },
      },
    ],
    { cancelable: true }
  );
};

  const formatTime = (totalSeconds: number | null) => {
    if (totalSeconds === null || totalSeconds < 0) return 'N/A';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading quiz...</Text>
      </View>
    );
  }

  if (error || !submittedAssessment) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error || 'Quiz not found.'}</Text>
        <TouchableOpacity onPress={() => fetchQuizData(Number(assessmentId))} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const quiz = submittedAssessment.assessment;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollViewContent}>
      <Stack.Screen options={{ title: `${quiz.title} - Attempt` }} />

      <View style={styles.headerCard}>
        <Text style={styles.quizTitle}>{quiz.title}</Text>
        <Text style={styles.quizInfo}>{quiz.description}</Text>
        {quiz.duration_minutes && (
          <Text style={[styles.quizInfo, timeLeft !== null && timeLeft < 300 && styles.timeWarning]}>
            Time Left: {formatTime(timeLeft)}
          </Text>
        )}
        <Text style={styles.quizStatus}>Status: {submittedAssessment.status.replace('_', ' ')}</Text>
        {!isConnected && (
            <Text style={styles.offlineStatus}>âš ï¸ You are currently in Offline Mode</Text>
        )}
      </View>

      {submittedAssessment.submitted_questions.map((question, qIndex) => (
        <View key={question.id} style={styles.questionCard}>
          <View style={styles.questionHeader}>
            <Text style={styles.questionText}>
              Q{qIndex + 1}. [{question.question_type.replace('_', ' ')}] {question.question_text}
            </Text>
            {savingAnswers.has(question.id) && (
              <View style={styles.savingIndicator}>
                <ActivityIndicator size="small" color="#007bff" />
                <Text style={styles.savingText}>Saving...</Text>
              </View>
            )}
          </View>

          {/* Multiple Choice / True False */}
          {(question.question_type === 'multiple_choice' || question.question_type === 'true_false') && (
            <View style={styles.optionsContainer}>
              {(question.submitted_options || []).map((option) => {
                const isSelected = (studentAnswers[question.id]?.answer as number[] || []).includes(option.question_option_id);
                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.optionButton,
                      isSelected && styles.optionSelected,
                    ]}
                    onPress={() => {
                      let newSelection: number[];
                      if (question.question_type === 'multiple_choice') {
                        newSelection = isSelected ? [] : [option.question_option_id];
                      } else if (question.question_type === 'true_false') {
                        newSelection = [option.question_option_id];
                      } else {
                        newSelection = isSelected ? [] : [option.question_option_id];
                      }
                      handleAnswerChange(question.id, question.question_type, newSelection);
                    }}
                    disabled={submittedAssessment.status !== 'in_progress' && isOffline !== 'true'}
                  >
                    {question.question_type === 'true_false' ? (
                      <View style={styles.radioCircle}>
                        {isSelected && <View style={styles.radioChecked} />}
                      </View>
                    ) : (
                      <View style={styles.checkboxSquare}>
                        {isSelected && <Text style={styles.checkboxCheck}>âœ“</Text>}
                      </View>
                    )}
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}
                    >
                      {option.option_text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {(!question.submitted_options || question.submitted_options.length === 0) && question.question_type !== 'true_false' && (
                <Text style={styles.errorText}>No options available for this question</Text>
              )}
            </View>
          )}

          {/* Short Answer / Identification / Essay */}
          {['identification', 'essay'].includes(question.question_type) && (
            <TextInput
              style={[
                styles.answerInput,
                question.question_type === 'essay' && styles.essayInput,
                submittedAssessment.status !== 'in_progress' && styles.disabledInput
              ]}
              placeholder={question.question_type === 'essay' ? "Write your essay here..." : "Your answer..."}
              multiline={question.question_type === 'essay'}
              value={studentAnswers[question.id]?.answer as string || ''}
              onChangeText={(text) =>
                handleAnswerChange(question.id, question.question_type, text)
              }
              editable={submittedAssessment.status === 'in_progress'}
            />
          )}

          <Text style={styles.pointsText}>Points: {question.max_points}</Text>

          {question.score_earned !== null && (
            <Text style={[styles.scoreText, question.is_correct ? styles.correctScore : styles.incorrectScore]}>
              {question.is_correct !== null && (question.is_correct ? ' âœ“' : ' âœ—')}
            </Text>
          )}
        </View>
      ))}

      {submittedAssessment.status === 'in_progress' && (
        <TouchableOpacity
          onPress={handleFinalizeQuiz}
          style={styles.submitQuizButton}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitQuizButtonText}>Finalize & Submit Quiz</Text>
          )}
        </TouchableOpacity>
      )}

      {submittedAssessment.status !== 'in_progress' && (
        <View style={styles.completedContainer}>
          <Text style={styles.completedText}>Quiz Completed</Text>
          {submittedAssessment.score !== null && (
            <Text style={styles.finalScoreText}>
              Final Score: {submittedAssessment.score}/{quiz.points}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => router.replace(`/courses/assessments/${submittedAssessment.assessment_id}`)}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>Back to Assessment</Text>
          </TouchableOpacity>
        </View>
      )}
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
    paddingBottom: 50,
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
    padding: 20,
    backgroundColor: '#f8f9fa',
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
    fontWeight: 'bold',
  },
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 700,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 20,
    alignItems: 'center',
  },
  quizTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: 8,
    textAlign: 'center',
  },
  quizInfo: {
    fontSize: 16,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 5,
  },
  timeWarning: {
    color: '#dc3545',
    fontWeight: 'bold',
  },
  quizStatus: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#28a745',
    marginTop: 10,
  },
  questionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 18,
    width: '100%',
    maxWidth: 700,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 15,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#343a40',
    lineHeight: 25,
    flex: 1,
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  savingText: {
    fontSize: 12,
    color: '#007bff',
    marginLeft: 5,
  },
  optionsContainer: {
    marginTop: 10,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  optionSelected: {
    backgroundColor: '#d1ecf1',
    borderColor: '#007bff',
  },
  optionText: {
    fontSize: 16,
    color: '#495057',
    flex: 1,
  },
  optionTextSelected: {
    fontWeight: 'bold',
    color: '#007bff',
  },
  answerInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
    minHeight: 45,
    textAlignVertical: 'top',
    marginTop: 10,
  },
  essayInput: {
    minHeight: 120,
  },
  disabledInput: {
    backgroundColor: '#f5f5f5',
    color: '#666',
  },
  pointsText: {
    fontSize: 14,
    color: '#6c757d',
    marginTop: 10,
    fontStyle: 'italic',
  },
  scoreText: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 5,
  },
  correctScore: {
    color: '#28a745',
  },
  incorrectScore: {
    color: '#dc3545',
  },
  submitQuizButton: {
    backgroundColor: '#28a745',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
    width: '100%',
    maxWidth: 300,
    alignSelf: 'center',
  },
  submitQuizButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  completedContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    marginTop: 20,
  },
  completedText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#28a745',
    marginBottom: 10,
  },
  finalScoreText: {
    fontSize: 18,
    color: '#007bff',
    fontWeight: 'bold',
    marginBottom: 15,
  },
  backButton: {
    backgroundColor: '#6c757d',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  radioCircle: {
    height: 20,
    width: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#777',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  radioChecked: {
    height: 10,
    width: 10,
    borderRadius: 5,
    backgroundColor: '#333',
  },
  checkboxSquare: {
    height: 20,
    width: 20,
    borderWidth: 2,
    borderColor: '#777',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderRadius: 4,
  },
  checkboxCheck: {
    color: '#333',
    fontSize: 14,
  },
  offlineStatus: {
    marginTop: 10,
    fontSize: 14,
    color: '#ff6347',
    fontWeight: 'bold',
  },
});