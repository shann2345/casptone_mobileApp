// app/(app)/index.tsx
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react'; // Import useRef
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import api, { clearAuthToken, getUserData } from '../../lib/api';

interface Course {
  id: number;
  title: string;
  course_code: string;
  description: string;
  credits: number;
  program: {
    id: number;
    name: string;
  };
  instructor: {
    id: number;
    name: string;
  };
  status: string;
}

interface EnrolledCourse extends Course {
  pivot?: {
    status: string;
    enrollment_date: string;
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const [userName, setUserName] = useState<string>('Guest');
  const [isSearchModalVisible, setSearchModalVisible] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Course[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState<boolean>(false);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [isLoadingEnrolledCourses, setIsLoadingEnrolledCourses] = useState<boolean>(true);

  // Create a ref for the FlatList
  const enrolledCoursesFlatListRef = useRef<FlatList<EnrolledCourse>>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData = await getUserData();
        if (userData && userData.name) {
          setUserName(userData.name);
        } else {
          console.warn('User data or name not found in local storage. Redirecting to login.');
          await clearAuthToken();
          router.replace('/login');
        }
      } catch (error) {
        console.error('Error fetching user name:', error);
        await clearAuthToken();
        router.replace('/login');
      }

      try {
        setIsLoadingEnrolledCourses(true);
        const response = await api.get('/my-courses');
        setEnrolledCourses(response.data.courses);
        console.log('Enrolled Courses:', response.data.courses);
      } catch (error) {
        console.error('Error fetching enrolled courses:', error.response?.data || error.message);
        Alert.alert('Error', 'Failed to load your enrolled courses.');
      } finally {
        setIsLoadingEnrolledCourses(false);
      }
    };

    fetchData();
  }, []);

  const handleSearchPress = () => {
    setSearchModalVisible(true);
    setSearchResults([]);
    setSearchQuery('');
    setHasSearched(false);
  };

  const handleSearchSubmit = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    setIsLoadingSearch(true);
    setHasSearched(true);
    try {
      const response = await api.get(`/courses/search?query=${searchQuery}`);
      setSearchResults(response.data.courses);
      console.log('Search Results:', response.data.courses);
    } catch (error) {
      console.error('Error searching courses:', error);
      Alert.alert('Search Error', 'Failed to fetch search results. Please try again.');
      setSearchResults([]);
    } finally {
      setIsLoadingSearch(false);
    }
  };

  const handleEnrollCourse = async (courseId: number, courseTitle: string) => {
    try {
      const response = await api.post('/enroll', { course_id: courseId });
      Alert.alert('Success', response.data.message || `Successfully enrolled in ${courseTitle}`);
      setSearchModalVisible(false);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      try {
        setIsLoadingEnrolledCourses(true);
        const updatedEnrolledCourses = await api.get('/my-courses');
        setEnrolledCourses(updatedEnrolledCourses.data.courses);
      } catch (refreshError) {
        console.error('Error refreshing enrolled courses after enrollment:', refreshError);
      } finally {
        setIsLoadingEnrolledCourses(false);
      }

    } catch (error: any) {
      console.error('Enrollment error:', error.response?.data || error.message);
      Alert.alert('Enrollment Failed', error.response?.data?.message || 'Could not enroll in the course. Please try again.');
    }
  };

  const renderCourseItem = ({ item }: { item: Course }) => (
    <View style={styles.courseResultCard}>
      <Text style={styles.courseResultTitle}>{item.title}</Text>
      <Text style={styles.courseResultCode}>Description: {item.description}</Text>
      <Text style={styles.courseResultDetails}>Program: {item.program.name}</Text>
      <Text style={styles.courseResultDetails}>Instructor: {item.instructor ? item.instructor.name : 'N/A'}</Text>

      <TouchableOpacity
        style={styles.enrollButton}
        onPress={() => handleEnrollCourse(item.id, item.title)}
      >
        <Text style={styles.enrollButtonText}>Enroll Course</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEnrolledCourseCard = ({ item }: { item: EnrolledCourse }) => (
    <TouchableOpacity
      style={styles.enrolledCourseCard}
      onPress={() => {
        console.log('Viewing enrolled course:', item.title);
        // router.push(`/course-details/${item.id}`);
      }}
    >
      <Ionicons name="book-outline" size={30} color="#007bff" />
      <Text style={styles.enrolledCourseCardTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.enrolledCourseCardCode}>{item.description}</Text>
      {item.pivot && (
        <Text style={styles.enrolledCourseCardStatus}>Status: {item.pivot.status}</Text>
      )}
    </TouchableOpacity>
  );

  // Function to scroll the FlatList
  const scrollEnrolledCoursesRight = () => {
    if (enrolledCoursesFlatListRef.current) {
      enrolledCoursesFlatListRef.current.scrollToEnd({ animated: true });
    }
  };
  const scrollEnrolledCoursesLeft = () => {
    if (enrolledCoursesFlatListRef.current) {
      enrolledCoursesFlatListRef.current.scrollToOffset({ offset: 0, animated: true }); // Scrolls to the beginning
    }
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcomeText}>Welcome, {userName}!</Text>
        <Text style={styles.subText}>Start learning something new today.</Text>
      </View>

      <TouchableOpacity style={styles.searchButton} onPress={handleSearchPress}>
        <Ionicons name="search" size={20} color="#fff" style={styles.searchIcon} />
        <Text style={styles.searchButtonText}>Search for Courses, Topics, etc.</Text>
      </TouchableOpacity>

      <View style={styles.newSection}>
        <Text style={styles.newSectionTitle}>Featured Content</Text>
        <Text style={styles.newSectionText}>
          Explore popular courses and trending topics designed for you.
        </Text>
      </View>

      <View style={styles.otherContent}>
        <View style={styles.sectionHeader}>
          <Text style={styles.quickAccessTitle}>My Courses</Text>
          <TouchableOpacity onPress={scrollEnrolledCoursesLeft}> 
            <Ionicons name="arrow-back-circle-outline" size={30} color="#007bff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={scrollEnrolledCoursesRight}> 
            <Ionicons name="arrow-forward-circle-outline" size={30} color="#007bff" />
          </TouchableOpacity>
        </View>
        {isLoadingEnrolledCourses ? (
          <ActivityIndicator size="large" color="#007bff" />
        ) : enrolledCourses.length > 0 ? (
          <FlatList
            ref={enrolledCoursesFlatListRef} // Attach the ref here
            data={enrolledCourses}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderEnrolledCourseCard}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalFlatListContent}
          />
        ) : (
          <View style={styles.noCoursesEnrolledContainer}>
            <Text style={styles.noCoursesEnrolledText}>You haven't enrolled in any courses yet.</Text>
            <Text style={styles.noCoursesEnrolledSubText}>Search for courses above to get started!</Text>
          </View>
        )}
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isSearchModalVisible}
        onRequestClose={() => {
          setSearchModalVisible(false);
          setHasSearched(false);
          setSearchQuery('');
          setSearchResults([]);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => {
              setSearchModalVisible(false);
              setHasSearched(false);
              setSearchQuery('');
              setSearchResults([]);
            }} style={styles.closeButton}>
              <Ionicons name="close-circle-outline" size={30} color="#6c757d" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Search</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Enter course title or code"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearchSubmit}
              returnKeyType="search"
            />
            <TouchableOpacity style={styles.modalSearchButton} onPress={handleSearchSubmit}>
              {isLoadingSearch ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalSearchButtonText}>Search</Text>
              )}
            </TouchableOpacity>

            {!isLoadingSearch && hasSearched && searchResults.length > 0 && (
              <View style={styles.searchResultsContainer}>
                <Text style={styles.searchResultsTitle}>Matching Courses:</Text>
                <FlatList
                  data={searchResults}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={renderCourseItem}
                  contentContainerStyle={styles.flatListContent}
                />
              </View>
            )}

            {isLoadingSearch && (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#007bff" />
                    <Text style={styles.loadingText}>Searching...</Text>
                </View>
            )}
            {!isLoadingSearch && hasSearched && searchResults.length === 0 && (
                <View style={styles.noResultsContainer}>
                    <Text style={styles.noResultsText}>No courses found for "{searchQuery}".</Text>
                </View>
            )}

          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
    padding: 20,
  },
  header: {
    marginBottom: 25,
  },
  welcomeText: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  subText: {
    fontSize: 16,
    color: '#7f8c8d',
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007bff',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 10,
    marginBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  newSection: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  newSectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 10,
  },
  newSectionText: {
    fontSize: 15,
    color: '#7f8c8d',
    lineHeight: 22,
  },
  quickAccessContainer: {
    marginBottom: 20,
  },
  quickAccessTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#34495e',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    width: '48%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 3,
  },
  cardText: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '600',
    color: '#34495e',
  },
  otherContent: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    alignItems: 'flex-start',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
   modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    width: '90%',
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  closeButton: {
    alignSelf: 'flex-end',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 20,
    textAlign: 'center',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 15,
  },
  modalSearchButton: {
    backgroundColor: '#007bff',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
  },
  modalSearchButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  searchResultsContainer: {
    marginTop: 10,
  },
  searchResultsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 10,
  },
  flatListContent: {
    paddingBottom: 20,
  },
  courseResultCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  courseResultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: 5,
  },
  courseResultCode: {
    fontSize: 14,
    color: '#555',
    marginBottom: 3,
  },
  courseResultDetails: {
    fontSize: 13,
    color: '#777',
    marginBottom: 2,
  },
  enrollButton: {
    backgroundColor: '#28a745',
    padding: 10,
    borderRadius: 5,
    marginTop: 10,
    alignItems: 'center',
  },
  enrollButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  noResultsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noResultsText: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#7f8c8d',
  },
  horizontalFlatListContent: {
    paddingHorizontal: 5,
    paddingVertical: 10,
  },
  enrolledCourseCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 15,
    width: 160,
    height: 160,
    marginRight: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  enrolledCourseCardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#34495e',
    marginTop: 10,
    textAlign: 'center',
    height: 40,
    overflow: 'hidden',
  },
  enrolledCourseCardCode: {
    fontSize: 13,
    color: '#7f8c8d',
    marginTop: 5,
  },
  enrolledCourseCardStatus: {
    fontSize: 12,
    color: '#28a745',
    marginTop: 5,
    fontWeight: '600',
  },
  noCoursesEnrolledContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: '#e9ecef',
    borderRadius: 10,
    paddingHorizontal: 15,
  },
  noCoursesEnrolledText: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    marginBottom: 5,
    fontWeight: 'bold',
  },
  noCoursesEnrolledSubText: {
    fontSize: 14,
    color: '#95a5a6',
    textAlign: 'center',
  },
});