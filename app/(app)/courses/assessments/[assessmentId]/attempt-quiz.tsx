// attempt-quiz.tsx
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
// import * as ScreenCapture from 'expo-screen-capture';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert, Animated, ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useApp } from '../../../../../context/AppContext';
import { useNetworkStatus } from '../../../../../context/NetworkContext';
import api, { getUserData, syncOfflineQuiz } from '../../../../../lib/api';
// Removed `startOfflineQuiz` and `hasQuizQuestionsSaved` from imports as they are only used in AssessmentDetailsScreen now
import { deleteCompletedOfflineQuizAttempt, deleteOfflineQuizAttempt, detectTimeManipulation, getAssessmentReviewFromDb, getCompletedOfflineQuizzes, getCurrentServerTime, getDb, getOfflineQuizAnswers, getOfflineQuizAttempt, getOfflineQuizAttemptStatus, getQuizQuestionsFromDb, saveAssessmentReviewToDb, submitOfflineQuiz, updateOfflineQuizAnswers, updateTimeSync } from '../../../../../lib/localDb';

// Interface definitions (unchanged)
interface OriginalQuestion {
    id: number;
    question_text: string;
    question_type: string;
    correct_answer: string | null;
    points: number;
}
// ... (rest of interfaces remain the same)
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
  original_question?: OriginalQuestion;
}

interface AssessmentDetail {
  id: number;
  course_id: number;
  title: string;
  description?: string;
  type: 'quiz' | 'exam';
  duration_minutes?: number;
  points: number;
  unavailable_at?: string | null;
  max_attempts?: number | null; 
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
    submitted_answer?: string | null;
    is_correct?: boolean | null;
    score_earned?: number | null;
  };
};

export default function AttemptQuizScreen() {
  const { submittedAssessmentId, assessmentId, isOffline, isReview } = useLocalSearchParams();
  const router = useRouter();
  const { isConnected, netInfo } = useNetworkStatus();
  const [submittedAssessment, setSubmittedAssessment] = useState<SubmittedAssessmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studentAnswers, setStudentAnswers] = useState<StudentAnswers>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [timerInterval, setTimerInterval] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [savingAnswers, setSavingAnswers] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const debounceTimers = useRef<{ [key: number]: ReturnType<typeof setTimeout> | null }>({});
  const studentAnswersRef = useRef<StudentAnswers>(studentAnswers);
  const [isSyncing, setIsSyncing] = useState(false);
  const [timeManipulationDetected, setTimeManipulationDetected] = useState(false);
  const [autoSubmitting, setAutoSubmitting] = useState(false); 
  const [shuffledQuestions, setShuffledQuestions] = useState<SubmittedQuestion[]>([]);
  const { restartApp } = useApp();
  const [justSubmittedOnline, setJustSubmittedOnline] = useState(false);
  const [progressAnim] = useState(new Animated.Value(1)); 

  const isReviewMode = isReview === 'true';

  const assessmentType = submittedAssessment?.assessment?.type || 'assessment';
  const assessmentTypeCapitalized = assessmentType.charAt(0).toUpperCase() + assessmentType.slice(1);

  // --- UTILITY FUNCTION: Fisher-Yates shuffle algorithm (Keep here just in case, though unused for resume) ---
  const shuffleArray = (array: SubmittedQuestion[]): SubmittedQuestion[] => {
      const newArray = [...array];
      for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
      }
      return newArray;
  };
  // --- END UTILITY FUNCTION ---

  // --- START: All existing hooks (mostly untouched) ---
  // useEffect(() => {
  //   const activateScreenshotPrevention = async () => {
  //     await ScreenCapture.preventScreenCaptureAsync();
  //   };
  //   const deactivateScreenshotPrevention = async () => {
  //     await ScreenCapture.allowScreenCaptureAsync();
  //   };

  //   activateScreenshotPrevention();
  //   const subscription = ScreenCapture.addScreenshotListener(() => {
  //     Alert.alert(
  //       'Screenshot Not Allowed',
  //       `For security reasons, taking screenshots is not allowed during this ${assessmentType}. This attempt has been noted.`,
  //       [{ text: 'OK' }]
  //     );
  //   });

  //   return () => {
  //     deactivateScreenshotPrevention();
  //     subscription.remove();
  //   };
  // }, [assessmentType]);

  useEffect(() => {
    if (!submittedAssessment || !submittedAssessment.assessment.duration_minutes || 
        submittedAssessment.status !== 'in_progress' || timeManipulationDetected) {
      return;
    }

    if (timeLeft !== null && submittedAssessment.assessment.duration_minutes) {
      const totalSeconds = submittedAssessment.assessment.duration_minutes * 60;
      const progress = timeLeft / totalSeconds;
      
      Animated.timing(progressAnim, {
        toValue: Math.max(0, progress),
        duration: 300,
        useNativeDriver: false,
      }).start();
    }
  }, [timeLeft, submittedAssessment?.assessment.duration_minutes]);

  useEffect(() => {
    studentAnswersRef.current = studentAnswers;
  }, [studentAnswers]);

  // Simple effect to load data into shuffledQuestions state when available
  useEffect(() => {
    if (submittedAssessment && submittedAssessment.submitted_questions.length > 0 && shuffledQuestions.length === 0) {
      // The order of submitted_questions is already correct (default or persisted)
      setShuffledQuestions(submittedAssessment.submitted_questions);
      console.log('✅ Initial questions loaded into display list.');
    } else if (submittedAssessment && submittedAssessment.submitted_questions.length > 0 && shuffledQuestions.length > 0) {
        console.log('✅ Questions already loaded, preserving order.');
    }
  }, [submittedAssessment]);

  useEffect(() => {
    const idToFetch = isOffline === 'true' ? assessmentId : submittedAssessmentId;
    if (idToFetch) {
      fetchQuizData(Number(idToFetch));
    }

    return () => {
      if (timerInterval) {
        clearInterval(timerInterval);
      }
      Object.values(debounceTimers.current).forEach(timer => {
        if (timer) clearTimeout(timer);
      });
    };
  }, [submittedAssessmentId, assessmentId, isOffline]);

  useEffect(() => {
    console.log("🕐 Timer effect triggered", {
      hasAssessment: !!submittedAssessment,
      hasDuration: !!submittedAssessment?.assessment?.duration_minutes,
      status: submittedAssessment?.status,
    });
    
    if (!submittedAssessment || !submittedAssessment.assessment.duration_minutes || submittedAssessment.status !== 'in_progress' || timeManipulationDetected) {
      if (timeManipulationDetected) {
        setTimeLeft(0);
      }
      return;
    }

    const startTime = new Date(submittedAssessment.started_at).getTime();
    const durationMs = submittedAssessment.assessment.duration_minutes * 60 * 1000;
    const endTime = startTime + durationMs;

    const initialTimeLeft = Math.floor((endTime - Date.now()) / 1000);
    setTimeLeft(initialTimeLeft > 0 ? initialTimeLeft : 0);
    console.log(`⏰ Timer synchronously set to initial value: ${initialTimeLeft} seconds`);

    const calculateTimeLeft = async () => {
      try {
        const user = await getUserData();
        if (!user?.email) {
          console.error('❌ User email not found for time calculation');
          await handleAutoSubmit('timer_error');
          return;
        }

        const timeCheck = await detectTimeManipulation(user.email);
        if (!timeCheck.isValid) {
          console.error('❌ Time manipulation detected:', timeCheck.reason);
          setTimeManipulationDetected(true);
          await handleAutoSubmit('time_manipulation');
          return;
        }

        let currentTime;
        if (isOffline === 'true') {
          const serverTimeString = await getCurrentServerTime(user.email);
          if (serverTimeString) {
            currentTime = new Date(serverTimeString).getTime();
          } else {
            await handleAutoSubmit('no_server_time');
            return;
          }
        } else {
          currentTime = Date.now();
        }

        const remainingMs = endTime - currentTime;
        let remainingSeconds = Math.floor(remainingMs / 1000);

        if (submittedAssessment.assessment.unavailable_at) {
          const unavailableTime = new Date(submittedAssessment.assessment.unavailable_at).getTime();
          if (currentTime >= unavailableTime) {
            console.log("🚨 Assessment unavailable time reached, auto-submitting");
            await handleAutoSubmit('assessment_unavailable');
            return;
          }
          const timeUntilUnavailable = Math.floor((unavailableTime - currentTime) / 1000);
          remainingSeconds = Math.min(remainingSeconds, timeUntilUnavailable);
        }

        if (remainingSeconds <= 0) {
          setTimeLeft(0);
          await handleAutoSubmit('time_up');
        } else {
          setTimeLeft(remainingSeconds);
          if (isOffline === 'true') {
            await updateTimeSync(user.email);
          }
        }
      } catch (error) {
        console.error("❌ Error in timer interval:", error);
        await handleAutoSubmit('timer_error');
      }
    };

    const interval = setInterval(calculateTimeLeft, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [submittedAssessment, isOffline, timeManipulationDetected, autoSubmitting]);

  useEffect(() => {
    const checkTimeManipulation = async () => {
      const user = await getUserData();
      if (user?.email) {
        const timeCheck = await detectTimeManipulation(user.email);
        if (!timeCheck.isValid) {
          console.warn('⚠️ Time manipulation detected on mount:', timeCheck.reason);
          setTimeManipulationDetected(true);
        }
      }
    };

    checkTimeManipulation();

    const timeCheckInterval = setInterval(checkTimeManipulation, 30000);

    return () => {
      clearInterval(timeCheckInterval);
    };
  }, []);
  // --- END: All existing hooks (mostly untouched) ---

  const handleAutoSubmit = async (reason: 'time_up' | 'time_manipulation' | 'no_server_time' | 'timer_error' | 'assessment_unavailable') => {
    if (autoSubmitting) {
      console.log('Auto-submission already in progress, skipping...');
      return;
    }

    console.log(`🚨 Auto-submitting ${assessmentType} due to: ${reason}`);
    setAutoSubmitting(true);

    try {
      let alertTitle = `${assessmentTypeCapitalized} Auto-Submitted`;
      let alertMessage = "";
      
      switch (reason) {
        case 'time_up':
          alertTitle = "Time's Up!";
          alertMessage = `Your ${assessmentType} time has expired and has been automatically submitted.`;
          break;
        case 'time_manipulation':
          alertTitle = "Security Alert";
          alertMessage = `Time manipulation detected. ${assessmentTypeCapitalized} has been automatically submitted for security reasons.`;
          break;
        case 'no_server_time':
          alertTitle = "System Error";
          alertMessage = `Unable to verify time. ${assessmentTypeCapitalized} has been automatically submitted for security.`;
          break;
        case 'timer_error':
          alertTitle = "Timer Error";
          alertMessage = `Timer error detected. ${assessmentTypeCapitalized} has been automatically submitted for security.`;
          break;
        case 'assessment_unavailable':
          alertTitle = "Assessment Unavailable";
          alertMessage = "The assessment time window has closed and has been automatically submitted.";
          break;
      }

      await handleFinalizeQuiz(true);

      if (isOffline === 'true' && !netInfo?.isInternetReachable) {
         console.log("Offline auto-submit complete, app will restart.");
      } else {
        Alert.alert(alertTitle, alertMessage, [
          { 
            text: "OK", 
            onPress: () => {
              router.replace(`/courses/assessments/${assessmentId}`);
            }
          }
        ]);
      }

    } catch (error) {
      console.error('❌ Error during auto-submission:', error);
      setSubmittedAssessment(prev => prev ? { 
        ...prev, 
        status: 'completed', 
        completed_at: new Date().toISOString() 
      } : null);
      
      Alert.alert(
        "Submission Error",
        `There was an error auto-submitting your ${assessmentType}. Please contact support.`,
        [{ text: "OK", onPress: () => router.replace(`/courses/assessments/${assessmentId}`) }]
      );
    } finally {
      setAutoSubmitting(false);
    }
  };

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

    if (isReview === 'true') {
      console.log(`✅ Review Mode: Fetching review data for assessment ${id}`);
      try {
          if (netInfo?.isInternetReachable && !isOffline) {
              const response = await api.get(`/submitted-assessments/${submittedAssessmentId}`);
              if (response.status === 200) {
                  const fetchedSubmittedAssessment = response.data.submitted_assessment;
                  setSubmittedAssessment(fetchedSubmittedAssessment);
                  setShuffledQuestions(fetchedSubmittedAssessment.submitted_questions); 
                  initializeStudentAnswers(fetchedSubmittedAssessment.submitted_questions);
                  console.log('✅ Online review data loaded');
              } else {
                  setError(`Failed to load review data.`);
              }
          } else {
              const reviewData = await getAssessmentReviewFromDb(id, user.email);
              if (reviewData) {
                  setSubmittedAssessment(reviewData);
                  setShuffledQuestions(reviewData.submitted_questions); 
                  initializeStudentAnswers(reviewData.submitted_questions);
                  console.log('✅ Offline review data loaded');
              } else {
                  setError(`Review data for this assessment is not available offline. Please sync online first.`);
              }
          }
      } catch (err) {
          console.error('Failed to load review data:', err);
          setError(`Failed to load review data for this assessment.`);
      } finally {
          setLoading(false);
      }
      return;
  }

    try {
      const timeCheck = await detectTimeManipulation(userEmail);
      if (!timeCheck.isValid) {
        console.error(`❌ Time manipulation detected during ${assessmentType} load:`, timeCheck.reason);
        setTimeManipulationDetected(true);
        setError(`Time manipulation detected. ${assessmentTypeCapitalized} cannot be loaded for security reasons.`);
        setLoading(false);
        return;
      }
    } catch (timeError) {
      console.error('❌ Error checking time manipulation:', timeError);
      setError('Unable to verify system time. Please ensure your device time is correct.');
      setLoading(false);
      return;
    }

    try {
      if (isOffline === 'true') {
        console.log(`Offline: Fetching ${assessmentType} attempt from local DB.`);
        
        // 1. Fetch data from local DB
        const localQuestions = await getQuizQuestionsFromDb(id, userEmail);
        const localAnswers = await getOfflineQuizAnswers(id, userEmail);
        const attemptStatusString = await getOfflineQuizAttemptStatus(id, userEmail);
        const isCompleted = attemptStatusString === 'completed' || attemptStatusString === 'error';
        const offlineAttempt = await getOfflineQuizAttempt(id, userEmail);
        const startTime = offlineAttempt?.start_time || new Date().toISOString();
        
        // 2. Get persisted shuffled order
        let persistedOrder: number[] | null = null;
        if (offlineAttempt?.shuffled_order) {
            try {
                const parsedOrder = typeof offlineAttempt.shuffled_order === 'string' 
                    ? JSON.parse(offlineAttempt.shuffled_order) 
                    : offlineAttempt.shuffled_order;
                
                if (Array.isArray(parsedOrder) && parsedOrder.every(qId => typeof qId === 'number')) {
                    persistedOrder = parsedOrder;
                }
            } catch (e) {
                console.error('❌ Failed to parse shuffled order from DB:', e);
                persistedOrder = null;
            }
        }
        
        if (localQuestions.length > 0) {
          const db = await getDb();
          const assessmentResult = await db.getFirstAsync(
            `SELECT duration_minutes, unavailable_at, type FROM offline_assessments WHERE id = ? AND user_email = ?;`,
            [id, userEmail]
          ) as any;
          const durationMinutes = assessmentResult?.duration_minutes || null;
          const unavailableAt = assessmentResult?.unavailable_at || null;
          const localAssessmentType = assessmentResult?.type || 'quiz';
          
          const processedQuestions: SubmittedQuestion[] = localQuestions.map(q => {
            // ... (unchanged logic for mapping local question data to SubmittedQuestion interface) ...
            let parsedOptions: any[] = [];
            
            // Special handling for true_false questions
            if (q.question_type === 'true_false') {
              if (q.options) {
                try {
                  if (typeof q.options === 'string') {
                    const trimmed = q.options.trim();
                    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                      parsedOptions = JSON.parse(q.options);
                    } else {
                      parsedOptions = [];
                    }
                  } else if (Array.isArray(q.options)) {
                    parsedOptions = q.options;
                  } else if (typeof q.options === 'object' && q.options !== null) {
                    parsedOptions = Object.values(q.options);
                  }
                } catch (e) {
                  console.error('Failed to parse true/false options for question', q.id, 'Error:', e);
                  parsedOptions = [];
                }
              }
              
              if (parsedOptions.length === 0) {
                parsedOptions = [
                  { id: 1, text: 'True', option_text: 'True', is_correct: false },
                  { id: 2, text: 'False', option_text: 'False', is_correct: false }
                ];
              }
            } else {
              if (q.options) {
                try {
                  if (typeof q.options === 'string') {
                    const trimmed = q.options.trim();
                    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                      parsedOptions = JSON.parse(q.options);
                    } else {
                      parsedOptions = [];
                    }
                  } else if (Array.isArray(q.options)) {
                    parsedOptions = q.options;
                  } else if (typeof q.options === 'object' && q.options !== null) {
                    parsedOptions = Object.values(q.options);
                  }
                } catch (e) {
                  console.error('Failed to parse options for question', q.id, 'Error:', e);
                  parsedOptions = [];
                }
              }
            }

            const submittedAnswer = localAnswers[q.id]?.answer;
            const submittedOptions = parsedOptions.map((option, index) => {
              const optionId = option.id || index + 1;
              let isSelected = false;

              if (q.question_type === 'multiple_choice' || q.question_type === 'true_false') {
                if (Array.isArray(submittedAnswer)) {
                  isSelected = submittedAnswer.includes(optionId);
                } else if (submittedAnswer !== undefined && submittedAnswer !== null) {
                  isSelected = submittedAnswer === optionId;
                }
              }
              
              return {
                id: optionId,
                submitted_question_id: q.id,
                question_option_id: option.id || option.question_option_id || optionId,
                option_text: option.text || option.option_text || option.toString(),
                is_correct_option: option.is_correct || false,
                is_selected: isSelected,
              };
            });

            return {
              id: q.id,
              submitted_assessment_id: id,
              question_id: q.id,
              question_text: q.question_text || q.question || '',
              question_type: q.question_type || q.type || 'essay',
              max_points: q.points || 1,
              submitted_answer: (q.question_type === 'essay' || q.question_type === 'identification') 
                ? submittedAnswer as string || null 
                : null,
              is_correct: null,
              score_earned: null,
              submitted_options: submittedOptions,
            } as SubmittedQuestion; 
          });

          // 3. Apply persisted order if resuming
          let finalQuestionOrder = processedQuestions;

          if (persistedOrder && isCompleted === false) {
            const questionMap = new Map(processedQuestions.map(q => [q.id, q]));
            const reorderedQuestions = persistedOrder
              .map(qId => questionMap.get(qId))
              .filter((q): q is SubmittedQuestion => q !== undefined);
            
            if (reorderedQuestions.length === processedQuestions.length) {
              finalQuestionOrder = reorderedQuestions;
              console.log(`✅ Loaded persisted question order for assessment ${id}.`);
            } else {
              console.warn(`⚠️ Persisted order length mismatch. Using default order.`);
            }
          }

          const offlineSubmittedAssessment: SubmittedAssessmentData = {
            id: id,
            assessment_id: id,
            student_id: -1,
            score: null,
            status: isCompleted ? 'completed' : 'in_progress',
            started_at: startTime,
            completed_at: isCompleted ? new Date().toISOString() : null,
            submitted_file_path: null,
            submitted_questions: finalQuestionOrder, // Use the reordered list
            assessment: {
              id: id,
              course_id: -1,
              title: localQuestions[0]?.question_data ? JSON.parse(localQuestions[0].question_data).assessment_title || `Offline ${assessmentTypeCapitalized}` : `Offline ${assessmentTypeCapitalized}`,
              type: localAssessmentType,
              duration_minutes: durationMinutes,
              points: processedQuestions.reduce((sum, q) => sum + q.max_points, 0),
              unavailable_at: unavailableAt,
            }
          };

          setSubmittedAssessment(offlineSubmittedAssessment);
          setShuffledQuestions(finalQuestionOrder);
          initializeStudentAnswers(processedQuestions);
          console.log(`✅ Offline ${assessmentTypeCapitalized} Data Loaded Successfully with duration:`, durationMinutes);
          
        } else {
          setError(`Offline: ${assessmentTypeCapitalized} questions not found locally. Please start the ${assessmentType} first while online.`);
          Alert.alert(
            `${assessmentTypeCapitalized} Not Found`,
            `This ${assessmentType} attempt was not found in local storage. Please connect to the internet and start the ${assessmentType} again.`,
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }
      } else {
        // ONLINE MODE - unchanged logic
        if (!netInfo?.isInternetReachable) {
          setError(`No internet connection. Please connect to the internet to load this ${assessmentType}.`);
          setLoading(false);
          return;
        }
        console.log(`Online: Fetching submitted ${assessmentType} details from API.`);
        try {
          const response = await api.get(`/submitted-assessments/${id}`);
          if (response.status === 200) {
            const fetchedSubmittedAssessment = response.data.submitted_assessment;
            setSubmittedAssessment(fetchedSubmittedAssessment);
            setShuffledQuestions(fetchedSubmittedAssessment.submitted_questions); // Load fetched order
            initializeStudentAnswers(fetchedSubmittedAssessment.submitted_questions);
            console.log(`API Response for Submitted ${assessmentTypeCapitalized} Details:`, JSON.stringify(response.data, null, 2));
          } else {
            setError(`Failed to fetch submitted ${assessmentType} details.`);
          }
        } catch (err: any) {
          if (netInfo?.isInternetReachable) {
            console.error(`Failed to fetch ${assessmentType} data:`, err.response?.data || err.message);
          }
          setError(`Failed to load ${assessmentType} data.`);
        }
      }
    } catch (err: any) {
      if (netInfo?.isInternetReachable) {
        console.error(`Failed to fetch ${assessmentType} data:`, err.response?.data || err.message);
      }
      setError(`Failed to load ${assessmentType} data.`);
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

  useEffect(() => {
    let mounted = true;
    
    if (netInfo?.isInternetReachable && isOffline === 'true' && mounted) {
      console.log('🔄 Connection restored, attempting to sync offline assessments...');
      syncCompletedOfflineQuiz();
    }
    
    return () => {
      mounted = false;
    };
  }, [netInfo?.isInternetReachable]);

  const saveAnswer = async (submittedQuestionId: number) => {
    const user = await getUserData();
    if (user?.email) {
      const timeCheck = await detectTimeManipulation(user.email);
      if (!timeCheck.isValid) {
        console.warn('⚠️ Time manipulation detected during answer save, blocking save');
        setTimeManipulationDetected(true);
        return;
      }
    }

    const answerData = studentAnswersRef.current[submittedQuestionId];
    if (!answerData || !answerData.isDirty) return;

    setSavingAnswers(prev => new Set(prev.add(submittedQuestionId)));

    try {
      if (netInfo?.isInternetReachable && isOffline !== 'true') {
        let payload: any = {};
        if (answerData.type === 'multiple_choice' || answerData.type === 'true_false') {
          payload.selected_option_ids = answerData.answer as number[];
        } else {
          payload.submitted_answer = answerData.answer as string;
        }
        try {
          const response = await api.patch(`/submitted-questions/${submittedQuestionId}/answer`, payload);
          if (response.status === 200) {
            setStudentAnswers(prev => ({
              ...prev,
              [submittedQuestionId]: { ...prev[submittedQuestionId], isDirty: false }
            }));
          }
        } catch (err: any) {
          if (netInfo?.isInternetReachable) {
            console.error('Error saving answer:', err.response?.data || err);
          }
        }
      } else {
        if (user && user.email && submittedAssessment) {
          const updatedAnswers = {
            ...studentAnswersRef.current,
            [submittedQuestionId]: answerData,
          };
          await updateOfflineQuizAnswers(submittedAssessment.assessment_id, user.email, updatedAnswers);
          setStudentAnswers(prev => ({
            ...prev,
            [submittedQuestionId]: { ...prev[submittedQuestionId], isDirty: false }
          }));
        }
      }
    } catch (err: any) {
      if (netInfo?.isInternetReachable) {
        console.error('Error saving answer:', err.response?.data || err);
      }
    } finally {
      setSavingAnswers(prev => {
        const newSet = new Set(prev);
        newSet.delete(submittedQuestionId);
        return newSet;
      });
    }
  };

  const handleAnswerChange = (
    submittedQuestionId: number, 
    type: SubmittedQuestion['question_type'], 
    value: string | number | number[]
  ) => {
    if (timeManipulationDetected) {
      Alert.alert(
        "Action Blocked",
        "Time manipulation detected. No further changes are allowed.",
        [{ text: "OK" }]
      );
      return;
    }

    setStudentAnswers((prevAnswers) => ({
      ...prevAnswers,
      [submittedQuestionId]: { type, answer: value, isDirty: true },
    }));

    if (debounceTimers.current[submittedQuestionId]) {
      clearTimeout(debounceTimers.current[submittedQuestionId] as unknown as NodeJS.Timeout);
    }

    debounceTimers.current[submittedQuestionId] = setTimeout(() => {
      saveAnswer(submittedQuestionId);
    }, 1000);
  };

  const syncCompletedOfflineQuiz = async () => {
    if (!netInfo?.isInternetReachable || !submittedAssessment || !assessmentId) return;
    
    setIsSyncing(true);
    try {
      if (isOffline === 'true' && submittedAssessment.status === 'completed') {
        console.log(`🔄 Attempting to sync completed offline ${assessmentType}...`);
        
        const user = await getUserData();
        const userEmail = user?.email;
        
        if (!userEmail) {
          console.error('❌ User email not found for sync');
          return;
        }
  
        const completedQuizzes = await getCompletedOfflineQuizzes(userEmail);
        const hasQuizToSync = completedQuizzes.some(quiz => 
          quiz.assessment_id === parseInt(assessmentId as string)
        );
  
        if (!hasQuizToSync) {
          console.log(`✅ No offline ${assessmentType} data found to sync for this assessment`);
          return;
        }
        
        if (savingAnswers.has(-1)) {
          console.log('⏳ Sync already in progress, skipping...');
          return;
        }
        
        setSavingAnswers(new Set([...Array.from(savingAnswers), -1]));
        
        const quizToSync = completedQuizzes.find(quiz => 
          quiz.assessment_id === parseInt(assessmentId as string)
        );

        if (!quizToSync) {
           console.log(`✅ Quiz ${assessmentId} already synced or not found.`);
           return;
        }
        
        const answersJson = quizToSync.answers;
        const startTime = quizToSync.start_time;
        const endTime = quizToSync.end_time;

        const syncSuccess = await syncOfflineQuiz(
          parseInt(assessmentId as string),
          answersJson,
          startTime,
          endTime
        );
        
        if (syncSuccess) {
          console.log(`✅ Offline ${assessmentType} successfully synced with server`);
          
          await deleteCompletedOfflineQuizAttempt(parseInt(assessmentId as string), userEmail);
          console.log('🧹 Local offline attempt data cleaned up after sync');
          
          Alert.alert(
            'Sync Complete',
            `Your offline ${assessmentType} has been successfully synced with the server.`,
            [
              { 
                text: 'OK', 
                onPress: () => {
                  router.replace(`/courses/assessments/${assessmentId}`);
                }
              }
            ]
          );
        } else {
          console.error(`❌ Failed to sync offline ${assessmentType}`);
          Alert.alert(
            'Sync Failed',
            `Failed to sync your offline ${assessmentType}. Please try again.`,
            [{ text: 'OK' }]
          );
        }
        
        setSavingAnswers(prevState => {
          const newSet = new Set(prevState);
          newSet.delete(-1);
          return newSet;
        });
      }
    } catch (error) {
      console.error(`Error syncing completed offline ${assessmentType}:`, error);
      Alert.alert(
        'Sync Error',
        'An error occurred while syncing. Please try again.',
        [{ text: 'OK' }]
      );
      setSavingAnswers(prevState => {
        const newSet = new Set(prevState);
        newSet.delete(-1);
        return newSet;
      });
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (netInfo?.isInternetReachable && isOffline === 'true' && submittedAssessment?.status === 'completed' && !justSubmittedOnline) {
      syncCompletedOfflineQuiz();
    }
  }, [netInfo?.isInternetReachable, submittedAssessment?.status, justSubmittedOnline]);


  const getFormattedAnswers = (): StudentAnswers => {
    const formattedAnswers: StudentAnswers = {};
        
    for (const questionId in studentAnswers) {
      const answerData = studentAnswers[questionId];
      const question = submittedAssessment?.submitted_questions?.find(
        q => q.id.toString() === questionId
      );

      if (!question) continue;

      let isCorrect: boolean | null = null;
      let scoreEarned: number | null = 0;
      let submittedAnswerText: string | null = null;

      if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
        const selectedOptionIds = new Set(Array.isArray(answerData.answer) ? answerData.answer : [answerData.answer]);
        const correctOptionIds = new Set(question.submitted_options?.filter(o => o.is_correct_option).map(o => o.question_option_id));
        
        isCorrect = selectedOptionIds.size === correctOptionIds.size && [...selectedOptionIds].every(id => correctOptionIds.has(id));
        scoreEarned = isCorrect ? question.max_points : 0;

        const firstSelectedOption = question.submitted_options?.find(o => selectedOptionIds.has(o.question_option_id));
        submittedAnswerText = firstSelectedOption?.option_text || null;

      } else if (question.question_type === 'identification') {
        const correctOption = question.submitted_options?.[0];
        submittedAnswerText = answerData.answer as string;
        if (correctOption) {
          isCorrect = (submittedAnswerText || '').trim().toLowerCase() === (correctOption.option_text || '').trim().toLowerCase();
          scoreEarned = isCorrect ? question.max_points : 0;
        }
      } else { // Essay
        submittedAnswerText = answerData.answer as string;
        isCorrect = null;
        scoreEarned = null;
      }

      formattedAnswers[questionId] = {
        type: answerData.type,
        answer: answerData.answer,
        submitted_answer: submittedAnswerText || '',
        is_correct: isCorrect,
        score_earned: scoreEarned,
        isDirty: false
      };
    }
    setStudentAnswers(formattedAnswers);
    return formattedAnswers;
  };

  const saveQuizAsOffline = async (
    userEmail: string | undefined, 
    assessmentId: string | string[] | undefined, 
    isAutoSubmission: boolean,
    formattedAnswers: StudentAnswers
  ) => {
    if (userEmail && assessmentId) {
      try {
        await submitOfflineQuiz(parseInt(assessmentId as string), userEmail, formattedAnswers);
        await deleteOfflineQuizAttempt(Number(assessmentId), userEmail);
        setSubmittedAssessment(prev => prev ? { ...prev, status: 'completed', completed_at: new Date().toISOString() } : null);
        
        if (!isAutoSubmission) {
          Alert.alert(
            `✅ ${assessmentTypeCapitalized} Completed Offline`,
            `Your ${assessmentType} has been saved locally and marked as completed.\n\n⚠️ The app needs to restart to properly save your offline progress.\n\nPress OK to restart the app now.`,
            [
              {
                text: 'OK',
                onPress: () => {
                  console.log(`🔄 Restarting app to save offline ${assessmentType}...`);
                  restartApp();
                }
              }
            ],
            { cancelable: false }
          );
        } else {
          console.log('🔄 Auto-submission complete, restarting app...');
          restartApp();
        }
      } catch (dbError) {
        console.error("❌ Failed to save quiz offline:", dbError);
        if (!isAutoSubmission) {
           Alert.alert('Save Error', `Failed to save your ${assessmentType} locally. Please try again.`);
        }
      }
    }
  };

  const handleFinalizeQuiz = async (isAutoSubmission: boolean = false) => {
    try {
      setSubmitting(true);
      const user = await getUserData();
      const userEmail = user?.email;
      
      if (!isAutoSubmission) {
        const unansweredQuestions: string[] = [];
        
        for (let i = 0; i < shuffledQuestions.length; i++) {
          const question = shuffledQuestions[i];
          const answerData = studentAnswers[question.id];
          
          let isAnswered = false;
          if (answerData) {
            if (answerData.type === 'multiple_choice' || answerData.type === 'true_false') {
              isAnswered = (answerData.answer as number[]).length > 0;
            } else {
              isAnswered = (answerData.answer as string).trim() !== '';
            }
          }
          
          if (!isAnswered) {
            unansweredQuestions.push(`Q${i + 1}`);
          }
        }

        if (unansweredQuestions.length > 0) {
          Alert.alert(
            'Incomplete Assessment',
            `Please answer all questions before submitting. You are missing: \n\n${unansweredQuestions.join(', ')}`,
            [{ text: 'OK' }]
          );
          setSubmitting(false);
          return;
        }
      }
      
      if (userEmail && !isAutoSubmission) {
        const timeCheck = await detectTimeManipulation(userEmail);
        if (!timeCheck.isValid) {
          console.error(`❌ Time manipulation detected during ${assessmentType} submission:`, timeCheck.reason);
          Alert.alert(
            "Submission Blocked",
            `Time manipulation detected. ${assessmentTypeCapitalized} submission cannot proceed for security reasons.`,
            [{ text: "OK", onPress: () => router.back() }]
          );
          setSubmitting(false);
          return;
        }
      }
      
      const formattedAnswers = getFormattedAnswers();

      if (isOffline === 'true' && netInfo?.isInternetReachable) {
        console.log(isAutoSubmission ? `Auto-submitting ONLINE (from offline-first mode)...` : `Submitting ONLINE (from offline-first mode)...`);
        
        if (userEmail && assessmentId && submittedAssessment) {
          const answersJson = JSON.stringify(formattedAnswers);
          const startTime = submittedAssessment.started_at;
          const endTime = new Date().toISOString();

          const syncSuccess = await syncOfflineQuiz(
            parseInt(assessmentId as string),
            answersJson,
            startTime,
            endTime
          );

          if (syncSuccess) {
            console.log(`✅ Direct online sync successful for ${assessmentType} ${assessmentId}`);
            
            await deleteOfflineQuizAttempt(Number(assessmentId), userEmail);
            
            if (!isAutoSubmission) {
              setJustSubmittedOnline(true);
              Alert.alert(
                `${assessmentTypeCapitalized} Submitted!`, 
                `Your ${assessmentType} has been successfully submitted.`, 
                [{ text: 'OK', onPress: () => router.replace(`/courses/assessments/${assessmentId}`) }]
              );
            }
          } else {
            console.warn(`⚠️ Direct online sync failed. Falling back to offline save for ${assessmentType} ${assessmentId}.`);
            await saveQuizAsOffline(userEmail, assessmentId, isAutoSubmission, formattedAnswers);
          }
        } else {
          console.error("❌ Missing user/assessment data during online submit. Saving offline.");
          await saveQuizAsOffline(userEmail, assessmentId, isAutoSubmission, formattedAnswers);
        }
      } 
      else if (isOffline === 'true') {
        console.log(isAutoSubmission ? `Auto-submitting OFFLINE...` : `Submitting OFFLINE...`);
        await saveQuizAsOffline(userEmail, assessmentId, isAutoSubmission, formattedAnswers);
      } 
      else {
        console.log(isAutoSubmission ? `Auto-submitting (original online mode)...` : `Submitting (original online mode)...`);
        if (!netInfo?.isInternetReachable) {
           Alert.alert('No Internet', `Cannot submit ${assessmentType} while offline. Please connect to the internet and try again.`);
           return;
        }
        const response = await api.post(`/submitted-assessments/${submittedAssessmentId}/finalize-quiz`);
        if (response.status === 200 && response.data.submitted_assessment) {
          const reviewData = response.data.submitted_assessment;
          if (userEmail && assessmentId) {
            await saveAssessmentReviewToDb(Number(assessmentId), userEmail, reviewData);
            await deleteOfflineQuizAttempt(Number(assessmentId), userEmail);
          }
          if (!isAutoSubmission) {
            setJustSubmittedOnline(true);
            Alert.alert(`${assessmentTypeCapitalized} Submitted!`, `Your ${assessmentType} has been successfully submitted.`, [
              { text: 'OK', onPress: () => router.replace(`/courses/assessments/${assessmentId}`) }
            ]);
          }
          fetchQuizData(Number(submittedAssessmentId));
        } else {
          if (!isAutoSubmission) Alert.alert('Error', `There was a problem submitting your ${assessmentType}.`);
        }
      }
    } catch (error) {
      if (netInfo?.isInternetReachable) {
        console.error(`Error submitting ${assessmentType}:`, error);
      }
      if (!isAutoSubmission) {
        Alert.alert('Error', `Failed to submit ${assessmentType}. Please try again.`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (totalSeconds: number | null) => {
    if (totalSeconds === null || totalSeconds < 0) return 'N/A';
    const minutes = Math.ceil(totalSeconds / 60);
    return `${minutes.toString()} min`;
  };

  // NOTE: The handleStartQuizAttempt function has been removed from this file (attempt-quiz.tsx)
  // as it belongs in the parent file ([assessmentId].tsx).

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading {assessmentType}...</Text>
      </View>
    );
  }

  if (error || !submittedAssessment) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error || `${assessmentTypeCapitalized} not found.`}</Text>
        <TouchableOpacity onPress={() => fetchQuizData(Number(assessmentId))} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const assessment = submittedAssessment.assessment;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollViewContent}>
      <Stack.Screen 
        options={{ title: isReview === 'true' ? `${assessment.title} - Review` : `${assessment.title} - Attempt` }} 
      />

      <View style={[styles.headerCard, timeManipulationDetected && styles.warningCard]}>
        <Text style={styles.quizTitle}>{assessment.title}</Text>
        <Text style={styles.quizInfo}>{assessment.description}</Text>
        
        {/* Show duration info */}
        {assessment.duration_minutes && (
          <Text style={styles.quizInfo}>
            Duration: {assessment.duration_minutes} minutes
          </Text>
        )}
        
        {assessment.duration_minutes && submittedAssessment.status === 'in_progress' && !timeManipulationDetected && (
          <View style={styles.timerContainer}>
            <View style={styles.timerHeader}>
              <Text style={styles.timerLabel}>⏱️ Time Remaining</Text>
              <Text style={[
                styles.timerText, 
                timeLeft !== null && timeLeft < 300 && styles.timeWarning
              ]}>
                {formatTime(timeLeft)}
              </Text>
            </View>
            
            {/* Animated Progress Bar */}
            <View style={styles.progressBarContainer}>
              <Animated.View 
                style={[
                  styles.progressBarFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%']
                    }),
                    backgroundColor: timeLeft !== null && timeLeft < 300 
                      ? '#d93025' // Red when less than 5 minutes
                      : timeLeft !== null && timeLeft < 600
                        ? '#e37400' // Orange when less than 10 minutes
                        : '#1967d2' // Blue otherwise
                  }
                ]}
              />
            </View>
          </View>
        )}
        
        {/* Show auto-submission indicator */}
        {autoSubmitting && (
          <Text style={styles.autoSubmittingText}>
            🔄 Auto-submitting {assessmentType}...
          </Text>
        )}
        
        {/* Show timer even if completed for reference */}
        {assessment.duration_minutes && submittedAssessment.status !== 'in_progress' && (
          <Text style={styles.quizInfo}>
            ⏰ Duration was: {assessment.duration_minutes} minutes
          </Text>
        )}
        
        {/* Time manipulation warning */}
        {timeManipulationDetected && (
          <Text style={styles.timeManipulationWarning}>
            ⚠️ TIME MANIPULATION DETECTED - {assessmentTypeCapitalized} access restricted for security
          </Text>
        )}
        
        <Text style={styles.quizStatus}>Status: {submittedAssessment.status.replace('_', ' ')}</Text>
        {!netInfo?.isInternetReachable && (
          <Text style={styles.offlineStatus}>⚠️ You are currently in Offline Mode</Text>
        )}
      </View>

      {shuffledQuestions.map((question, qIndex) => (
        <View key={question.id} style={[styles.questionCard, (timeManipulationDetected || autoSubmitting) && styles.disabledCard]}>
          <View style={styles.questionHeader}>
            <Text style={styles.questionText}>
              Q{qIndex + 1}. {question.question_text}
            </Text>
            {/* REMOVED: Saving indicator from here */}
          </View>

          {(question.question_type === 'multiple_choice' || question.question_type === 'true_false') && (
            <View style={styles.optionsContainer}>
              {(question.submitted_options || []).map((option) => {
                
                const isSelectedByUser = isReview === 'true' 
                    ? option.is_selected 
                    : (studentAnswers[question.id]?.answer as number[] || []).includes(option.question_option_id);
                
                const isCorrectOption = option.is_correct_option;
                const reviewStyles = [];
                if (isReview === 'true') {
                    if (isCorrectOption) reviewStyles.push(styles.correctOption);
                    if (isSelectedByUser && !isCorrectOption) reviewStyles.push(styles.incorrectOption);
                }

                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.optionButton,
                      isSelectedByUser && isReview !== 'true' && styles.optionSelected,
                      (timeManipulationDetected || autoSubmitting) && styles.disabledOption,
                      ...reviewStyles,
                    ]}
                    onPress={() => {
                      if (isReview === 'true' || timeManipulationDetected || autoSubmitting) return;
                      
                      let newSelection: number[];
                      if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
                        newSelection = [option.question_option_id];
                      } else {
                        const currentSelection = (studentAnswers[question.id]?.answer as number[] || []);
                        if (currentSelection.includes(option.question_option_id)) {
                          newSelection = currentSelection.filter(id => id !== option.question_option_id);
                        } else {
                          newSelection = [...currentSelection, option.question_option_id];
                        }
                      }
                      handleAnswerChange(question.id, question.question_type, newSelection);
                    }}
                    disabled={submittedAssessment.status !== 'in_progress' || timeManipulationDetected || autoSubmitting || isReview === 'true'}
                  >
                    {question.question_type === 'true_false' ? (
                      <View style={styles.radioCircle}>{isSelectedByUser && <View style={styles.radioChecked} />}</View>
                    ) : (
                      <View style={styles.checkboxSquare}>{isSelectedByUser && <Text style={styles.checkboxCheck}>✓</Text>}</View>
                    )}

                    <Text style={[styles.optionText, isSelectedByUser && isReview !== 'true' && styles.optionTextSelected]}>
                      {option.option_text}
                    </Text>

                    {isReview === 'true' && isSelectedByUser && !isCorrectOption && <Ionicons name="close-circle" size={22} color="#d93025" style={styles.correctnessIcon} />}
                    {isReview === 'true' && isCorrectOption && <Ionicons name="checkmark-circle" size={22} color="#137333" style={styles.correctnessIcon} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}


          {['identification', 'essay'].includes(question.question_type) && (
            <>
              <TextInput
                style={[
                  styles.answerInput,
                  question.question_type === 'essay' && styles.essayInput,
                  (submittedAssessment.status !== 'in_progress' || timeManipulationDetected || autoSubmitting || isReview === 'true') && styles.disabledInput
                ]}
                placeholder={
                  timeManipulationDetected ? "Editing disabled due to time manipulation" 
                  : autoSubmitting ? `Auto-submitting ${assessmentType}...`
                  : isReview === 'true' ? "Your submitted answer"
                  : "Your answer..."
                }
                multiline={question.question_type === 'essay'}
                value={isReview === 'true' ? question.submitted_answer || '' : studentAnswers[question.id]?.answer as string || ''}
                onChangeText={(text) => handleAnswerChange(question.id, question.question_type, text)}
                editable={submittedAssessment.status === 'in_progress' && !timeManipulationDetected && !autoSubmitting && isReview !== 'true'}
              />
              {isReview === 'true' && question.question_type === 'identification' && question.original_question && (
                <View style={styles.correctAnswerContainer}>
                    <Text style={styles.correctAnswerLabel}>Correct Answer:</Text>
                    <Text style={styles.correctAnswerText}>{question.original_question.correct_answer}</Text>
                </View>
              )}
            </>
          )}
          
          {/* MOVED: Saving indicator to the bottom */}
          <View style={styles.pointsContainer}>
            <Text style={styles.pointsText}>Points: {question.max_points}</Text>
            {isReview === 'true' && question.score_earned !== null && (
                <Text style={[styles.scoreText, question.is_correct ? styles.correctScore : styles.incorrectScore]}>
                    Score: {question.score_earned} / {question.max_points}
                    {question.is_correct !== null && (question.is_correct ? ' ✓' : ' ✗')}
                </Text>
            )}
            {/* NEW LOCATION */}
            {savingAnswers.has(question.id) && isReview !== 'true' && (
              <View style={styles.savingIndicatorBottom}>
                <ActivityIndicator size="small" color="#1967d2" />
                <Text style={styles.savingText}>Saving...</Text>
              </View>
            )}
          </View>
        </View>
      ))}

      {submittedAssessment.status === 'in_progress' && !timeManipulationDetected && !autoSubmitting && isReview !== 'true' &&(
        <TouchableOpacity
          onPress={() => handleFinalizeQuiz(false)}
          style={styles.submitQuizButton}
          disabled={submitting || timeManipulationDetected || autoSubmitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitQuizButtonText}>Finalize & Submit {assessmentTypeCapitalized}</Text>
          )}
        </TouchableOpacity>
      )}

      {(submittedAssessment.status !== 'in_progress' || timeManipulationDetected || isReview === 'true') && (
        <View style={styles.completedContainer}>
          <Text style={styles.completedText}>
            {isReview === 'true' 
              ? 'Review Complete' 
              : timeManipulationDetected 
                ? `${assessmentTypeCapitalized} Blocked` 
                : `${assessmentTypeCapitalized} Completed`
            }
          </Text>
          {submittedAssessment.score !== null && !timeManipulationDetected && (
            <Text style={styles.finalScoreText}>
              Final Score: {submittedAssessment.score}/{assessment.points}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => router.replace(`/courses/assessments/${assessmentId}`)}
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
    padding: 16,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#5f6368',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f8f9fa',
  },
  errorText: {
    fontSize: 16,
    color: '#d93025',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#1967d2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  headerCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  warningCard: {
    borderColor: '#d93025',
    borderWidth: 2,
    backgroundColor: '#fef7f7',
  },
  quizTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 8,
  },
  quizInfo: {
    fontSize: 14,
    color: '#5f6368',
    marginBottom: 6,
    lineHeight: 20,
  },
  timeWarning: {
    color: '#d93025',
    fontWeight: '600',
    fontSize: 16,
  },
  autoSubmittingText: {
    fontSize: 14,
    color: '#e37400',
    fontWeight: '600',
    marginTop: 8,
  },
  timeManipulationWarning: {
    fontSize: 14,
    color: '#d93025',
    fontWeight: '700',
    marginTop: 8,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d93025',
  },
  quizStatus: {
    fontSize: 14,
    color: '#5f6368',
    marginTop: 8,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  offlineStatus: {
    fontSize: 14,
    color: '#e37400',
    marginTop: 6,
    fontWeight: '600',
  },
  questionCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  disabledCard: {
    opacity: 0.6,
    backgroundColor: '#f8f9fa',
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  questionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#202124',
    lineHeight: 24,
  },
  // REMOVED: Saving indicator style from here
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  savingIndicatorBottom: { // ADDED NEW STYLE for bottom indicator
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    marginTop: 8,
  },
  savingText: {
    fontSize: 12,
    color: '#1967d2',
    marginLeft: 6,
  },
  optionsContainer: {
    marginTop: 8,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  optionSelected: {
    backgroundColor: '#e8f0fe',
    borderColor: '#1967d2',
    borderWidth: 2,
  },
  disabledOption: {
    opacity: 0.5,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#5f6368',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  radioChecked: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1967d2',
  },
  checkboxSquare: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#5f6368',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxCheck: {
    color: '#1967d2',
    fontSize: 14,
    fontWeight: 'bold',
  },
  optionText: {
    flex: 1,
    fontSize: 15,
    color: '#202124',
    lineHeight: 22,
  },
  optionTextSelected: {
    fontWeight: '500',
    color: '#1967d2',
  },
  answerInput: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#202124',
    marginTop: 8,
  },
  essayInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  disabledInput: {
    backgroundColor: '#f1f3f4',
    color: '#5f6368',
  },
  pointsText: {
    fontSize: 13,
    color: '#5f6368',
    marginTop: 12,
    fontWeight: '500',
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  correctScore: {
    color: '#137333',
  },
  incorrectScore: {
    color: '#d93025',
  },
  submitQuizButton: {
    backgroundColor: '#1967d2',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  submitQuizButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  timerContainer: {
    marginTop: 16,
    marginBottom: 8,
  },
  timerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  timerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5f6368',
  },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1967d2',
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  correctOption: { borderColor: '#137333', backgroundColor: '#e6f4ea', borderWidth: 2 },
  incorrectOption: { borderColor: '#d93025', backgroundColor: '#fce8e6', borderWidth: 1.5 },
  correctnessIcon: { marginLeft: 'auto', paddingLeft: 10 },
  correctAnswerContainer: { marginTop: 12, padding: 10, backgroundColor: '#e6f4ea', borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#137333' },
  correctAnswerLabel: { fontSize: 13, fontWeight: 'bold', color: '#137333', marginBottom: 4 },
  correctAnswerText: { fontSize: 15, color: '#0d652d' },
  pointsContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginTop: 12 
  },
  completedContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 24,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  completedText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 12,
  },
  finalScoreText: {
    fontSize: 18,
    color: '#1967d2',
    fontWeight: '600',
    marginBottom: 16,
  },
  backButton: {
    backgroundColor: '#1967d2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});