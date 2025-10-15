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
import { useApp } from '../../../../../context/AppContext';
import { useNetworkStatus } from '../../../../../context/NetworkContext';
import api, { getUserData, syncOfflineQuiz } from '../../../../../lib/api';
import { deleteOfflineQuizAttempt, detectTimeManipulation, getCompletedOfflineQuizzes, getCurrentServerTime, getDb, getOfflineQuizAnswers, getOfflineQuizAttempt, getOfflineQuizAttemptStatus, getQuizQuestionsFromDb, submitOfflineQuiz, updateOfflineQuizAnswers, updateTimeSync } from '../../../../../lib/localDb';

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
  unavailable_at?: string | null;
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
  const [autoSubmitting, setAutoSubmitting] = useState(false); // Track auto-submission
  const [shuffledQuestions, setShuffledQuestions] = useState<SubmittedQuestion[]>([]);
  const { restartApp } = useApp();

  // Update the ref whenever studentAnswers state changes
  useEffect(() => {
    studentAnswersRef.current = studentAnswers;
  }, [studentAnswers]);

  useEffect(() => {
    if (submittedAssessment && submittedAssessment.submitted_questions.length > 0 && shuffledQuestions.length === 0) {
      // Fisher-Yates shuffle algorithm to randomize for UX only
      const shuffleArray = (array: SubmittedQuestion[]) => {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
      };
      const shuffled = shuffleArray(submittedAssessment.submitted_questions);
      setShuffledQuestions(shuffled);
    }
  }, [submittedAssessment]);

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

  // Enhanced timer effect with time manipulation detection and auto-submission
  useEffect(() => {
    console.log("🕐 Timer effect triggered", {
      hasAssessment: !!submittedAssessment,
      hasDuration: !!submittedAssessment?.assessment?.duration_minutes,
      status: submittedAssessment?.status,
      duration: submittedAssessment?.assessment?.duration_minutes,
      timeManipulationDetected
    });

    let unavailableCheckInterval: ReturnType<typeof setInterval> | null = null;

    // FIRST: Immediate unavailable_at check regardless of duration or timer
    const checkUnavailableTime = async () => {
      if (!submittedAssessment || submittedAssessment.status !== 'in_progress' || timeManipulationDetected || autoSubmitting) {
        return;
      }

      const user = await getUserData();
      if (!user?.email) return;

      try {
        let currentTime;
        
        if (isOffline === 'true') {
          const serverTimeString = await getCurrentServerTime(user.email);
          if (serverTimeString) {
            currentTime = new Date(serverTimeString).getTime();
          } else {
            currentTime = new Date().getTime();
          }
        } else {
          currentTime = new Date().getTime();
        }

        // Check if assessment has reached its unavailable_at time
        if (submittedAssessment.assessment.unavailable_at) {
          const unavailableTime = new Date(submittedAssessment.assessment.unavailable_at).getTime();
          console.log("🔍 Checking unavailable time:", {
            currentTime: new Date(currentTime).toISOString(),
            unavailableAt: submittedAssessment.assessment.unavailable_at,
            unavailableTime: new Date(unavailableTime).toISOString(),
            isUnavailable: currentTime >= unavailableTime
          });
          
          if (currentTime >= unavailableTime) {
            console.log("🚨 Assessment unavailable time reached during quiz taking, auto-submitting");
            await handleAutoSubmit('assessment_unavailable');
            return;
          }
        }
      } catch (error) {
        console.error("❌ Error checking unavailable time:", error);
      }
    };

    // Run immediate check
    checkUnavailableTime();

    // Set up periodic unavailable_at check (every 5 seconds) regardless of timer
    unavailableCheckInterval = setInterval(checkUnavailableTime, 5000);

    if (submittedAssessment && submittedAssessment.assessment.duration_minutes && submittedAssessment.status === 'in_progress' && !timeManipulationDetected) {
      const startTime = new Date(submittedAssessment.started_at).getTime();
      const durationMs = submittedAssessment.assessment.duration_minutes * 60 * 1000;
      const endTime = startTime + durationMs;

      console.log("⏰ Setting up timer", {
        startTime: new Date(startTime).toISOString(),
        durationMinutes: submittedAssessment.assessment.duration_minutes,
        endTime: new Date(endTime).toISOString(),
        isOffline: isOffline
      });

      const calculateTimeLeft = async () => {
        try {
          const user = await getUserData();
          if (!user?.email) {
            console.error('❌ User email not found for time calculation');
            setTimeLeft(0);
            return;
          }

          // First, detect time manipulation
          const timeCheck = await detectTimeManipulation(user.email);
          
          if (!timeCheck.isValid) {
            console.error('❌ Time manipulation detected:', timeCheck.reason);
            setTimeManipulationDetected(true);
            setTimeLeft(0);
            
            // Auto-submit the quiz due to time manipulation
            await handleAutoSubmit('time_manipulation');
            
            if (timerInterval) clearInterval(timerInterval);
            return;
          }

          let currentTime;
          
          if (isOffline === 'true') {
            // For offline mode, use the calculated server time from localDb
            const serverTimeString = await getCurrentServerTime(user.email);
            if (serverTimeString) {
              currentTime = new Date(serverTimeString).getTime();
              console.log("🕐 Using offline calculated server time:", new Date(currentTime).toISOString());
            } else {
              console.warn("⚠️ No server time available, quiz cannot continue safely");
              setTimeLeft(0);
              await handleAutoSubmit('no_server_time');
              if (timerInterval) clearInterval(timerInterval);
              return;
            }
          } else {
            // For online mode, we can trust the device time more, but still validate
            currentTime = new Date().getTime();
            console.log("🕐 Using online device time:", new Date(currentTime).toISOString());
          }
          
          // Check if assessment has reached its unavailable_at time
          if (submittedAssessment.assessment.unavailable_at) {
            const unavailableTime = new Date(submittedAssessment.assessment.unavailable_at).getTime();
            if (currentTime >= unavailableTime) {
              console.log("🚨 Assessment unavailable time reached, auto-submitting");
              setTimeLeft(0);
              if (timerInterval) clearInterval(timerInterval);
              
              if (submittedAssessment.status === 'in_progress' && !autoSubmitting) {
                await handleAutoSubmit('assessment_unavailable');
              }
              return;
            }
          }
          
          const remainingMs = endTime - currentTime;
          const remainingSeconds = Math.floor(remainingMs / 1000);
          
          // If assessment has unavailable_at, also consider that as a time limit
          let effectiveTimeLeft = remainingSeconds;
          if (submittedAssessment.assessment.unavailable_at) {
            const unavailableTime = new Date(submittedAssessment.assessment.unavailable_at).getTime();
            const timeUntilUnavailable = Math.floor((unavailableTime - currentTime) / 1000);
            effectiveTimeLeft = Math.min(remainingSeconds, timeUntilUnavailable);
          }
          
          console.log("⏰ Time calculation", {
            currentTime: new Date(currentTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            unavailableAt: submittedAssessment.assessment.unavailable_at,
            remainingMs,
            remainingSeconds,
            effectiveTimeLeft
          });
          
          if (remainingMs <= 0) {
            setTimeLeft(0);
            if (timerInterval) clearInterval(timerInterval);
            
            // Auto-submit when time is up
            if (submittedAssessment.status === 'in_progress' && !autoSubmitting) {
              await handleAutoSubmit('time_up');
            }
          } else {
            setTimeLeft(effectiveTimeLeft);
            
            // Update time sync for offline mode to prevent manipulation
            if (isOffline === 'true') {
              await updateTimeSync(user.email);
            }
          }
        } catch (error) {
          console.error("❌ Error calculating time left:", error);
          
          // In case of any error, be conservative and auto-submit
          setTimeLeft(0);
          setTimeManipulationDetected(true);
          
          await handleAutoSubmit('timer_error');
          
          if (timerInterval) clearInterval(timerInterval);
        }
      };

      calculateTimeLeft();
      const interval = setInterval(calculateTimeLeft, 1000); // Check every second
      setTimerInterval(interval);

      return () => {
        if (interval) clearInterval(interval);
        if (unavailableCheckInterval) clearInterval(unavailableCheckInterval);
      };
    } else {
      console.log("⏰ Timer not started", {
        hasAssessment: !!submittedAssessment,
        hasDuration: !!submittedAssessment?.assessment?.duration_minutes,
        status: submittedAssessment?.status,
        timeManipulationDetected
      });
      
      // If time manipulation is detected, show warning
      if (timeManipulationDetected) {
        setTimeLeft(0);
      }
      
      // Still return cleanup for unavailable check interval
      return () => {
        if (unavailableCheckInterval) clearInterval(unavailableCheckInterval);
      };
    }
  }, [submittedAssessment, isOffline, timeManipulationDetected, autoSubmitting]);

  // Add time manipulation check on component mount and periodically
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

    // Periodic time manipulation check every 30 seconds
    const timeCheckInterval = setInterval(checkTimeManipulation, 30000);

    return () => {
      clearInterval(timeCheckInterval);
    };
  }, []);

  // New function to handle automatic submission
  const handleAutoSubmit = async (reason: 'time_up' | 'time_manipulation' | 'no_server_time' | 'timer_error' | 'assessment_unavailable') => {
    if (autoSubmitting) {
      console.log('Auto-submission already in progress, skipping...');
      return;
    }

    console.log(`🚨 Auto-submitting quiz due to: ${reason}`);
    setAutoSubmitting(true);

    try {
      // Show appropriate alert based on reason
      let alertTitle = "Quiz Auto-Submitted";
      let alertMessage = "";
      
      switch (reason) {
        case 'time_up':
          alertTitle = "Time's Up!";
          alertMessage = "Your quiz time has expired and has been automatically submitted.";
          break;
        case 'time_manipulation':
          alertTitle = "Security Alert";
          alertMessage = "Time manipulation detected. Quiz has been automatically submitted for security reasons.";
          break;
        case 'no_server_time':
          alertTitle = "System Error";
          alertMessage = "Unable to verify time. Quiz has been automatically submitted for security.";
          break;
        case 'timer_error':
          alertTitle = "Timer Error";
          alertMessage = "Timer error detected. Quiz has been automatically submitted for security.";
          break;
        case 'assessment_unavailable':
          alertTitle = "Assessment Unavailable";
          alertMessage = "The assessment time window has closed and has been automatically submitted.";
          break;
      }

      // Automatically submit without user confirmation for security reasons
      await handleFinalizeQuiz(true); // Pass true to indicate auto-submission

      // Show alert after submission
      Alert.alert(alertTitle, alertMessage, [
        { 
          text: "OK", 
          onPress: () => {
            router.replace(`/courses/assessments/${assessmentId}`);
          }
        }
      ]);

    } catch (error) {
      console.error('❌ Error during auto-submission:', error);
      // Even if submission fails, mark as completed locally to prevent further attempts
      setSubmittedAssessment(prev => prev ? { 
        ...prev, 
        status: 'completed', 
        completed_at: new Date().toISOString() 
      } : null);
      
      Alert.alert(
        "Submission Error",
        "There was an error auto-submitting your quiz. Please contact support.",
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

    // Check for time manipulation before loading quiz data
    try {
      const timeCheck = await detectTimeManipulation(userEmail);
      if (!timeCheck.isValid) {
        console.error('❌ Time manipulation detected during quiz load:', timeCheck.reason);
        setTimeManipulationDetected(true);
        setError('Time manipulation detected. Quiz cannot be loaded for security reasons.');
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
        console.log("Offline: Fetching quiz attempt from local DB.");
        
        const localQuestions = await getQuizQuestionsFromDb(id, userEmail);
        const localAnswers = await getOfflineQuizAnswers(id, userEmail);
        const attemptStatusString = await getOfflineQuizAttemptStatus(id, userEmail);
        const isCompleted = attemptStatusString === 'completed' || attemptStatusString === 'error';

        // Get the actual start time from the offline attempt
        const offlineAttempt = await getOfflineQuizAttempt(id, userEmail);
        const startTime = offlineAttempt?.start_time || new Date().toISOString();

        if (localQuestions.length > 0) {
          // Get duration and unavailable_at from the assessment data in the database
          const db = await getDb();
          const assessmentResult = await db.getFirstAsync(
            `SELECT duration_minutes, unavailable_at FROM offline_assessments WHERE id = ? AND user_email = ?;`,
            [id, userEmail]
          ) as any;
          const durationMinutes = assessmentResult?.duration_minutes || null;
          const unavailableAt = assessmentResult?.unavailable_at || null;
          
          console.log("📊 Assessment data found:", { durationMinutes, unavailableAt });
          
          const processedQuestions = localQuestions.map(q => {
            let parsedOptions: any[] = [];
            
            // Special handling for true_false questions
            if (q.question_type === 'true_false') {
              // If options exist, parse them
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
              
              // If no options or empty options, create default True/False options
              if (parsedOptions.length === 0) {
                console.log(`Creating default True/False options for question ${q.id}`);
                parsedOptions = [
                  { id: 1, text: 'True', option_text: 'True', is_correct: false },
                  { id: 2, text: 'False', option_text: 'False', is_correct: false }
                ];
              }
            } else {
              // Handle other question types (existing logic)
              if (q.options) {
                try {
                  if (typeof q.options === 'string') {
                    const trimmed = q.options.trim();
                    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                      parsedOptions = JSON.parse(q.options);
                    } else {
                      console.warn(`Question ${q.id} has non-JSON options string:`, q.options);
                      parsedOptions = [];
                    }
                  } else if (Array.isArray(q.options)) {
                    parsedOptions = q.options;
                  } else if (typeof q.options === 'object' && q.options !== null) {
                    parsedOptions = Object.values(q.options);
                  }
                } catch (e) {
                  console.error('Failed to parse options for question', q.id, 'Error:', e);
                  console.error('Problematic options value:', q.options);
                  parsedOptions = [];
                }
              }
            }

            const submittedAnswer = localAnswers[q.id]?.answer;
            const submittedOptions = parsedOptions.map((option, index) => {
              const optionId = option.id || index + 1;
              let isSelected = false;

              // Check if this option was selected in the saved answers
              if (q.question_type === 'multiple_choice' || q.question_type === 'true_false') {
                if (Array.isArray(submittedAnswer)) {
                  isSelected = submittedAnswer.includes(optionId);
                } else if (submittedAnswer !== undefined && submittedAnswer !== null) {
                  // For single-select, submittedAnswer will be a number, not an array.
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
            };
          });

          const offlineSubmittedAssessment: SubmittedAssessmentData = {
            id: id,
            assessment_id: id,
            student_id: -1,
            score: null,
            status: isCompleted ? 'completed' : 'in_progress',
            started_at: startTime,
            completed_at: isCompleted ? new Date().toISOString() : null,
            submitted_file_path: null,
            submitted_questions: processedQuestions,
            assessment: {
              id: id,
              course_id: -1,
              title: localQuestions[0]?.question_data ? JSON.parse(localQuestions[0].question_data).assessment_title || 'Offline Quiz' : 'Offline Quiz',
              type: 'quiz',
              duration_minutes: durationMinutes,
              points: processedQuestions.reduce((sum, q) => sum + q.max_points, 0),
              unavailable_at: unavailableAt,
            }
          };

          setSubmittedAssessment(offlineSubmittedAssessment);
          initializeStudentAnswers(processedQuestions);
          console.log("✅ Offline Quiz Data Loaded Successfully with duration:", durationMinutes);
          
          console.log("🔍 Assessment data debug:", {
            id: offlineSubmittedAssessment.id,
            title: offlineSubmittedAssessment.assessment.title,
            duration_minutes: offlineSubmittedAssessment.assessment.duration_minutes,
            unavailable_at: offlineSubmittedAssessment.assessment.unavailable_at,
            status: offlineSubmittedAssessment.status,
            started_at: offlineSubmittedAssessment.started_at
          });
        } else {
          setError('Offline: Quiz questions not found locally. Please start the quiz first while online.');
          Alert.alert(
            'Quiz Not Found',
            'This quiz attempt was not found in local storage. Please connect to the internet and start the quiz again.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }
      } else {
        // ONLINE MODE - only fetch if online
        if (!netInfo?.isInternetReachable) {
          setError('No internet connection. Please connect to the internet to load this quiz.');
          setLoading(false);
          return;
        }
        console.log("Online: Fetching submitted quiz details from API.");
        try {
          const response = await api.get(`/submitted-assessments/${id}`);
          if (response.status === 200) {
            const fetchedSubmittedAssessment = response.data.submitted_assessment;
            setSubmittedAssessment(fetchedSubmittedAssessment);
            initializeStudentAnswers(fetchedSubmittedAssessment.submitted_questions);
            console.log("API Response for Submitted Quiz Details:", JSON.stringify(response.data, null, 2));
          } else {
            setError('Failed to fetch submitted quiz details.');
          }
        } catch (err: any) {
          // Only log error if online, otherwise suppress
          if (netInfo?.isInternetReachable) {
            console.error("Failed to fetch quiz data:", err.response?.data || err.message);
          }
          setError('Failed to load quiz data.');
        }
      }
    } catch (err: any) {
      // Only log error if online, otherwise suppress
      if (netInfo?.isInternetReachable) {
        console.error("Failed to fetch quiz data:", err.response?.data || err.message);
      }
      setError('Failed to load quiz data.');
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

  // Add this useEffect hook to your component to attempt sync when connection is restored
  useEffect(() => {
    let mounted = true;
    
    // Check for connection and sync if online
    if (netInfo?.isInternetReachable && isOffline === 'true' && mounted) {
      console.log('🔄 Connection restored, attempting to sync offline quizzes...');
      syncCompletedOfflineQuiz();
    }
    
    return () => {
      mounted = false;
    };
  }, [netInfo?.isInternetReachable]);

  const saveAnswer = async (submittedQuestionId: number) => {
    // Check for time manipulation before saving
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
        // ONLINE MODE - existing logic
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
          // Only log error if online, otherwise suppress
          if (netInfo?.isInternetReachable) {
            console.error('Error saving answer:', err.response?.data || err);
          }
        }
      } else {
        // OFFLINE MODE - Save answers to local database
        if (user && user.email && submittedAssessment) {
          const updatedAnswers = {
            ...studentAnswersRef.current,
            [submittedQuestionId]: answerData,
          };
          // Use the new localDb function to update answers
          await updateOfflineQuizAnswers(submittedAssessment.assessment_id, user.email, updatedAnswers);
          setStudentAnswers(prev => ({
            ...prev,
            [submittedQuestionId]: { ...prev[submittedQuestionId], isDirty: false }
          }));
        }
      }
    } catch (err: any) {
      // Only log error if online, otherwise suppress
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
    // Prevent answer changes if time manipulation is detected
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

    // Clear existing debounce timer
    if (debounceTimers.current[submittedQuestionId]) {
      clearTimeout(debounceTimers.current[submittedQuestionId] as unknown as NodeJS.Timeout);
    }

    // Set up debounced saving for both online and offline modes
    debounceTimers.current[submittedQuestionId] = setTimeout(() => {
      saveAnswer(submittedQuestionId);
    }, 1000);
  };

  const syncCompletedOfflineQuiz = async () => {
  if (!netInfo?.isInternetReachable || !submittedAssessment || !assessmentId) return;
  
  setIsSyncing(true);
  try {
    if (isOffline === 'true' && submittedAssessment.status === 'completed') {
      console.log('🔄 Attempting to sync completed offline quiz...');
      
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
        console.log('✅ No offline quiz data found to sync for this assessment');
        return;
      }
      
      if (savingAnswers.has(-1)) {
        console.log('⏳ Sync already in progress, skipping...');
        return;
      }
      
      setSavingAnswers(new Set([...Array.from(savingAnswers), -1]));
      
      const formattedAnswersForSync = Object.keys(studentAnswers).reduce((acc, questionId) => {
        const questionData = studentAnswers[questionId];
        acc[questionId] = {
          ...questionData,
          submitted_answer: questionData.submitted_answer || questionData.answer?.toString() || ''
        };
        return acc;
      }, {} as any);
      
      const answersJson = JSON.stringify(formattedAnswersForSync);
      const startTime = submittedAssessment.started_at;
      const endTime = submittedAssessment.completed_at || new Date().toISOString();
      
      const syncSuccess = await syncOfflineQuiz(
        parseInt(assessmentId as string),
        answersJson,
        startTime,
        endTime
      );
      
      if (syncSuccess) {
        console.log('✅ Offline quiz successfully synced with server');
        
        // ✅ DELETE LOCAL DATA
        await deleteOfflineQuizAttempt(parseInt(assessmentId as string), userEmail);
        console.log('🧹 Local offline attempt data cleaned up after sync');
        
        // ✅ IMPORTANT: Show success message and navigate back
        Alert.alert(
          'Sync Complete',
          'Your offline quiz has been successfully synced with the server.',
          [
            { 
              text: 'OK', 
              onPress: () => {
                // Navigate back to assessment details page
                // This will trigger a refresh and show the updated status
                router.replace(`/courses/assessments/${assessmentId}`);
              }
            }
          ]
        );
      } else {
        console.error('❌ Failed to sync offline quiz');
        Alert.alert(
          'Sync Failed',
          'Failed to sync your offline quiz. Please try again.',
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
    console.error('Error syncing completed offline quiz:', error);
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

  // Add this effect to automatically sync when connection is restored
  useEffect(() => {
    if (netInfo?.isInternetReachable && isOffline === 'true' && submittedAssessment?.status === 'completed') {
      syncCompletedOfflineQuiz();
    }
  }, [netInfo?.isInternetReachable, submittedAssessment?.status]);

  // Updated handleFinalizeQuiz to support auto-submission
  const handleFinalizeQuiz = async (isAutoSubmission: boolean = false) => {
    try {
      setSubmitting(true);
      const user = await getUserData();
      const userEmail = user?.email;
      
      // Final time manipulation check before submission (skip for auto-submission due to time manipulation)
      if (userEmail && !isAutoSubmission) {
        const timeCheck = await detectTimeManipulation(userEmail);
        if (!timeCheck.isValid) {
          console.error('❌ Time manipulation detected during quiz submission:', timeCheck.reason);
          Alert.alert(
            "Submission Blocked",
            "Time manipulation detected. Quiz submission cannot proceed for security reasons.",
            [{ text: "OK", onPress: () => router.back() }]
          );
          return;
        }
      }
      
      if (isOffline === 'true') {
        // OFFLINE MODE - Save to local DB
        console.log(isAutoSubmission ? 'Auto-submitting offline quiz...' : 'Submitting offline quiz...');
        
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

          // ✅ ENSURE ALL REQUIRED FIELDS ARE PRESENT
          formattedAnswers[questionId] = {
            type: answerData.type,
            answer: answerData.answer,
            submitted_answer: submittedAnswerText || '', // ✅ Always provide a string
            is_correct: isCorrect,
            score_earned: scoreEarned,
            isDirty: false
          };
        }
        
        // Update the component's state with the formatted answers
        setStudentAnswers(formattedAnswers);
        
        if (user?.email && assessmentId) {
          await submitOfflineQuiz(parseInt(assessmentId as string), user.email, formattedAnswers);
          await deleteOfflineQuizAttempt(Number(assessmentId), userEmail);
          setSubmittedAssessment(prev => prev ? { ...prev, status: 'completed', completed_at: new Date().toISOString() } : null);
          
          if (!isAutoSubmission) {
            // Show alert requiring app restart for offline completion
            Alert.alert(
              '✅ Quiz Completed Offline',
              'Your quiz has been saved locally and marked as completed.\n\n⚠️ The app needs to restart to properly save your offline progress.\n\nPress OK to restart the app now.',
              [
                {
                  text: 'OK',
                  onPress: () => {
                    console.log('🔄 Restarting app to save offline quiz...');
                    // Use the restartApp function from AppContext to force app restart
                    restartApp();
                  }
                }
              ],
              { cancelable: false } // Prevent dismissing the alert
            );
          } else {
            // For auto-submission, restart without additional alert
            console.log('🔄 Auto-submission complete, restarting app...');
            restartApp();
          }
        }
      } else {
        // ONLINE MODE - only submit if online
        if (!netInfo?.isInternetReachable) {
          Alert.alert('No Internet', 'Cannot submit quiz while offline. Please connect to the internet and try again.');
          return;
        }
        console.log(isAutoSubmission ? 'Auto-submitting quiz online...' : 'Submitting quiz online...');
        try {
          const response = await api.post(`/submitted-assessments/${submittedAssessmentId}/finalize-quiz`);
          if (response.status === 200) {
            // ✅ CLEAN UP LOCAL DATABASE AFTER SUCCESSFUL ONLINE SUBMISSION
            if (userEmail && assessmentId) {
              console.log('🧹 Cleaning up local database after successful online submission...');
              try {
                // Delete any existing offline attempt for this assessment
                await deleteOfflineQuizAttempt(Number(assessmentId), userEmail);
                console.log('✅ Local offline attempt data cleaned up successfully');
              } catch (cleanupError) {
                console.warn('⚠️ Failed to clean up local data, but online submission was successful:', cleanupError);
              }
            }
            
            if (!isAutoSubmission) {
              Alert.alert('Quiz Submitted!', 'Your quiz has been successfully submitted.', [
                { text: 'OK', onPress: () => router.replace(`/courses/assessments/${assessmentId}`) }
              ]);
            }
            
            fetchQuizData(Number(submittedAssessmentId));
          } else {
            if (!isAutoSubmission) {
              Alert.alert('Error', 'There was a problem submitting your quiz.');
            }
          }
        } catch (error) {
          // Only log error if online, otherwise suppress
          if (netInfo?.isInternetReachable) {
            console.error('Error submitting quiz:', error);
          }
          if (!isAutoSubmission) {
            Alert.alert('Error', 'Failed to submit quiz. Please try again.');
          }
        }
      }
    } catch (error) {
      // Only log error if online, otherwise suppress
      if (netInfo?.isInternetReachable) {
        console.error('Error submitting quiz:', error);
      }
      if (!isAutoSubmission) {
        Alert.alert('Error', 'Failed to submit quiz. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
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

      <View style={[styles.headerCard, timeManipulationDetected && styles.warningCard]}>
        <Text style={styles.quizTitle}>{quiz.title}</Text>
        <Text style={styles.quizInfo}>{quiz.description}</Text>
        
        {/* Show duration info */}
        {quiz.duration_minutes && (
          <Text style={styles.quizInfo}>
            Duration: {quiz.duration_minutes} minutes
          </Text>
        )}
        
        {/* Show timer if quiz has duration and is in progress */}
        {quiz.duration_minutes && submittedAssessment.status === 'in_progress' && !timeManipulationDetected && (
          <Text style={[styles.quizInfo, timeLeft !== null && timeLeft < 300 && styles.timeWarning]}>
            ⏰ Time Left: {formatTime(timeLeft)}
          </Text>
        )}
        
        {/* Show auto-submission indicator */}
        {autoSubmitting && (
          <Text style={styles.autoSubmittingText}>
            🔄 Auto-submitting quiz...
          </Text>
        )}
        
        {/* Show timer even if completed for reference */}
        {quiz.duration_minutes && submittedAssessment.status !== 'in_progress' && (
          <Text style={styles.quizInfo}>
            ⏰ Duration was: {quiz.duration_minutes} minutes
          </Text>
        )}
        
        {/* Time manipulation warning */}
        {timeManipulationDetected && (
          <Text style={styles.timeManipulationWarning}>
            ⚠️ TIME MANIPULATION DETECTED - Quiz access restricted for security
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
                      (timeManipulationDetected || autoSubmitting) && styles.disabledOption,
                    ]}
                    onPress={() => {
                      if (timeManipulationDetected || autoSubmitting) return;
                      
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
                    disabled={submittedAssessment.status !== 'in_progress' || timeManipulationDetected || autoSubmitting}
                  >
                    {question.question_type === 'true_false' ? (
                      <View style={styles.radioCircle}>
                        {isSelected && <View style={styles.radioChecked} />}
                      </View>
                    ) : (
                      <View style={styles.checkboxSquare}>
                        {isSelected && <Text style={styles.checkboxCheck}>✓</Text>}
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
                (submittedAssessment.status !== 'in_progress' || timeManipulationDetected || autoSubmitting) && styles.disabledInput
              ]}
              placeholder={
                timeManipulationDetected 
                  ? "Editing disabled due to time manipulation" 
                  : autoSubmitting 
                    ? "Auto-submitting quiz..." 
                    : question.question_type === 'essay' 
                      ? "Write your essay here..." 
                      : "Your answer..."
              }
              multiline={question.question_type === 'essay'}
              value={studentAnswers[question.id]?.answer as string || ''}
              onChangeText={(text) =>
                handleAnswerChange(question.id, question.question_type, text)
              }
              editable={submittedAssessment.status === 'in_progress' && !timeManipulationDetected && !autoSubmitting}
            />
          )}

          <Text style={styles.pointsText}>Points: {question.max_points}</Text>

          {question.score_earned !== null && (
            <Text style={[styles.scoreText, question.is_correct ? styles.correctScore : styles.incorrectScore]}>
              {question.is_correct !== null && (question.is_correct ? ' ✓' : ' ✗')}
            </Text>
          )}
        </View>
      ))}

      {submittedAssessment.status === 'in_progress' && !timeManipulationDetected && !autoSubmitting && (
        <TouchableOpacity
          onPress={() => handleFinalizeQuiz(false)}
          style={styles.submitQuizButton}
          disabled={submitting || timeManipulationDetected || autoSubmitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitQuizButtonText}>Finalize & Submit Quiz</Text>
          )}
        </TouchableOpacity>
      )}

      {(submittedAssessment.status !== 'in_progress' || timeManipulationDetected) && (
        <View style={styles.completedContainer}>
          <Text style={styles.completedText}>
            {timeManipulationDetected ? 'Quiz Blocked' : 'Quiz Completed'}
          </Text>
          {submittedAssessment.score !== null && !timeManipulationDetected && (
            <Text style={styles.finalScoreText}>
              Final Score: {submittedAssessment.score}/{quiz.points}
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
  // ... existing styles ...
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollViewContent: {
    padding: 24,
    paddingBottom: 60,
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 18,
    color: '#667eea',
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f8f9fa',
  },
  errorText: {
    fontSize: 18,
    color: '#dc3545',
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '600',
  },
  retryButton: {
    backgroundColor: '#667eea',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 25,
    width: '100%',
    maxWidth: 700,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    marginBottom: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  warningCard: {
    backgroundColor: '#fff5f5',
    borderColor: '#e74c3c',
    borderWidth: 2,
  },
  quizTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#667eea',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  quizInfo: {
    fontSize: 16,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 22,
  },
  timeWarning: {
    color: '#dc3545',
    fontWeight: 'bold',
  },
  timeManipulationWarning: {
    color: '#e74c3c',
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 12,
    lineHeight: 20,
  },
  autoSubmittingText: {
    color: '#ffa500',
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  quizStatus: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#28a745',
    marginTop: 12,
    letterSpacing: 0.3,
  },
  questionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 22,
    width: '100%',
    maxWidth: 700,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  disabledCard: {
    backgroundColor: '#f8f9fa',
    opacity: 0.75,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2c3e50',
    lineHeight: 26,
    flex: 1,
    letterSpacing: 0.2,
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  savingText: {
    fontSize: 12,
    color: '#667eea',
    marginLeft: 6,
    fontWeight: '600',
  },
  optionsContainer: {
    marginTop: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  optionSelected: {
    backgroundColor: '#e3f2fd',
    borderColor: '#667eea',
    shadowColor: '#667eea',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  disabledOption: {
    backgroundColor: '#f8f9fa',
    opacity: 0.7,
  },
  optionText: {
    fontSize: 16,
    color: '#495057',
    flex: 1,
    lineHeight: 22,
  },
  optionTextSelected: {
    fontWeight: '700',
    color: '#667eea',
  },
  answerInput: {
    borderWidth: 2,
    borderColor: '#e9ecef',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#2c3e50',
    minHeight: 50,
    textAlignVertical: 'top',
    marginTop: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  essayInput: {
    minHeight: 140,
  },
  disabledInput: {
    backgroundColor: '#f8f9fa',
    color: '#6c757d',
    borderColor: '#dee2e6',
  },
  pointsText: {
    fontSize: 14,
    color: '#6c757d',
    marginTop: 12,
    fontStyle: 'italic',
    fontWeight: '500',
  },
  scoreText: {
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 8,
  },
  correctScore: {
    color: '#28a745',
  },
  incorrectScore: {
    color: '#dc3545',
  },
  submitQuizButton: {
    backgroundColor: '#28a745',
    paddingVertical: 18,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 35,
    width: '100%',
    maxWidth: 350,
    alignSelf: 'center',
    shadowColor: '#28a745',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  submitQuizButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  completedContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 450,
    alignItems: 'center',
    marginTop: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  completedText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#28a745',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  finalScoreText: {
    fontSize: 20,
    color: '#667eea',
    fontWeight: 'bold',
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: '#6c757d',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
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