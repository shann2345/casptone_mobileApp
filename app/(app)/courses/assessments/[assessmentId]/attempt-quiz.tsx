// app/(app)/courses/assessments/[assessmentId]/attempt-quiz.tsx
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
import api from '../../../../../lib/api'; // Adjust path as necessary

interface Option {
  id: number;
  question_id: number;
  option_text: string;
  is_correct: boolean; // Note: For displaying, this might not be strictly needed by student
  order: number;
}

interface Question {
  id: number;
  assessment_id: number;
  question_text: string;
  question_type: 'multiple_choice' | 'true_false' | 'short_answer' | 'essay';
  order: number;
  options?: Option[];
}

interface AssessmentDetailWithQuestions {
  id: number;
  title: string;
  description?: string;
  type: 'quiz' | 'exam';
  duration_minutes?: number;
  questions: Question[]; // Questions are now required here
}

// Define a type for student answers
type StudentAnswers = {
  [questionId: number]: {
    type: 'multiple_choice' | 'true_false' | 'short_answer' | 'essay';
    answer: string | number | number[]; // Can be option ID(s) or text
  };
};

export default function AttemptQuizScreen() {
  const { assessmentId } = useLocalSearchParams();
  const router = useRouter();
  const [assessment, setAssessment] = useState<AssessmentDetailWithQuestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studentAnswers, setStudentAnswers] = useState<StudentAnswers>({});
  // You might want to add a timer state here for duration_minutes

  useEffect(() => {
    if (assessmentId) {
      fetchQuizQuestions();
    }
  }, [assessmentId]);

  const fetchQuizQuestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/assessments/${assessmentId}`);
      if (response.status === 200) {
        if (response.data && response.data.assessment && (response.data.assessment.type === 'quiz' || response.data.assessment.type === 'exam') && response.data.assessment.questions) {
          setAssessment(response.data.assessment);
          // Initialize student answers
          const initialAnswers: StudentAnswers = {};
          response.data.assessment.questions.forEach((q: Question) => {
            initialAnswers[q.id] = { type: q.question_type, answer: '' }; // Default empty answer
          });
          setStudentAnswers(initialAnswers);
        } else {
          setError('Assessment not found or is not a quiz/exam with questions.');
        }
      } else {
        setError(response.data?.message || 'Failed to fetch quiz questions.');
      }
    } catch (err: any) {
      console.error("Error fetching quiz questions:", err);
      setError(err.response?.data?.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (questionId: number, type: Question['question_type'], value: string | number) => {
    setStudentAnswers((prevAnswers) => ({
      ...prevAnswers,
      [questionId]: { type, answer: value },
    }));
  };

  const handleSubmitQuiz = async () => {
    Alert.alert(
      'Confirm Submission',
      'Are you sure you want to submit your answers?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            setLoading(true); // Set loading for submission
            try {
              // Prepare data for submission
              const submissionData = {
                answers: Object.entries(studentAnswers).map(([qId, data]) => ({
                  question_id: parseInt(qId),
                  answer_type: data.type,
                  answer_content: data.answer, // This will vary based on question type
                })),
                // You might also send start_time, end_time, etc.
              };

              const response = await api.post(`/assessments/${assessmentId}/submit-quiz`, submissionData);

              if (response.status === 200) {
                Alert.alert('Success', 'Quiz submitted successfully!');
                router.replace(`/courses/assessments/${assessmentId}`); // Go back to assessment details or a results page
              } else {
                Alert.alert('Submission Failed', response.data?.message || 'Could not submit quiz.');
              }
            } catch (err: any) {
              console.error('Quiz submission error:', err);
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading quiz...</Text>
      </View>
    );
  }

  if (error || !assessment) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error || 'Quiz not found or invalid type.'}</Text>
        <TouchableOpacity onPress={fetchQuizQuestions} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollViewContent}>
      <Stack.Screen options={{ title: `${assessment.title} - Attempt` }} />

      <View style={styles.headerCard}>
        <Text style={styles.quizTitle}>{assessment.title}</Text>
        <Text style={styles.quizInfo}>{assessment.description}</Text>
        {assessment.duration_minutes && (
          <Text style={styles.quizInfo}>Duration: {assessment.duration_minutes} minutes</Text>
        )}
        {/* You could add a live timer here */}
      </View>

      {assessment.questions.map((question, qIndex) => (
  <View key={question.id} style={styles.questionCard}>
    <Text style={styles.questionText}>
      Q{qIndex + 1}.
      <Text> [{question.question_type}] </Text>
      {question.question_text}
    </Text>

    {question.question_type === 'multiple_choice' && question.options && (
  <View style={styles.optionsContainer}>
    {question.options.map((option) => {
      const isSelected = studentAnswers[question.id]?.answer === option.id;
      return (
        <TouchableOpacity
          key={option.id}
          style={[
            styles.optionButton,
            isSelected && styles.optionSelected,
          ]}
          onPress={() =>
            handleAnswerChange(question.id, question.question_type, option.id)
          }
        >
          <View style={styles.radioCircle}>
            {isSelected && <View style={styles.radioChecked} />}
          </View>
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
  </View>
)}

{question.question_type === 'true_false' && (
  <View style={styles.optionsContainer}>
    {['true', 'false'].map((value) => {
      const isSelected = studentAnswers[question.id]?.answer === value;
      return (
        <TouchableOpacity
          key={value}
          style={[
            styles.optionButton,
            isSelected && styles.optionSelected,
          ]}
          onPress={() =>
            handleAnswerChange(question.id, question.question_type, value)
          }
        >
          <View style={styles.radioCircle}>
            {isSelected && <View style={styles.radioChecked} />}
          </View>
          <Text
            style={[
              styles.optionText,
              isSelected && styles.optionTextSelected,
            ]}
          >
            {value === 'true' ? 'True' : 'False'}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
)}


    {['short_answer', 'identification'].includes(question.question_type) && (
      <View style={styles.shortAnswerContainer}>
        <TextInput
          style={styles.answerInput}
          placeholder="Your answer..."
          value={studentAnswers[question.id]?.answer as string || ''}
          onChangeText={(text) =>
            handleAnswerChange(question.id, question.question_type, text)
          }
        />
        {question.question_type === 'short_answer' && (
          <View style={styles.uploadBox}>
            <Text style={styles.uploadLabel}>Attach File (optional):</Text>
            <TouchableOpacity style={styles.uploadButton}>
              <Text style={styles.uploadButtonText}>Upload File</Text>
              {/* Implement File Upload logic using DocumentPicker or ImagePicker */}
            </TouchableOpacity>
          </View>
        )}
      </View>
    )}

    {question.question_type === 'essay' && (
      <TextInput
        style={[styles.answerInput, { minHeight: 120 }]}
        placeholder="Write your essay here..."
        multiline
        value={studentAnswers[question.id]?.answer as string || ''}
        onChangeText={(text) => handleAnswerChange(question.id, question.question_type, text)}
      />
    )}
  </View>
))}

      <TouchableOpacity onPress={handleSubmitQuiz} style={styles.submitQuizButton} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitQuizButtonText}>Submit Quiz</Text>
        )}
      </TouchableOpacity>
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
    paddingBottom: 50, // Give some space at the bottom for the submit button
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
  questionText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#343a40',
    marginBottom: 15,
    lineHeight: 25,
  },
  optionsContainer: {
    marginTop: 10,
  },
  optionButton: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  optionSelected: {
    backgroundColor: '#d1ecf1', // Light blue for selected
    borderColor: '#007bff',
  },
  optionText: {
    fontSize: 16,
    color: '#495057',
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
    textAlignVertical: 'top', // For multiline input
    marginTop: 10,
  },
  submitQuizButton: {
    backgroundColor: '#28a745', // Green for submit
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
  shortAnswerContainer: {
  marginTop: 10,
},

uploadBox: {
  marginTop: 10,
  backgroundColor: '#f1f3f5',
  borderRadius: 8,
  padding: 12,
  borderWidth: 1,
  borderColor: '#ccc',
},

uploadLabel: {
  fontSize: 14,
  color: '#495057',
  marginBottom: 6,
},

uploadButton: {
  backgroundColor: '#007bff',
  paddingVertical: 10,
  borderRadius: 6,
  alignItems: 'center',
},

uploadButtonText: {
  color: '#fff',
  fontSize: 14,
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

});