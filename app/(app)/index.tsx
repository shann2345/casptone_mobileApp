import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNetworkStatus } from '../../context/NetworkContext';
import api, { clearAuthToken, getAuthToken, getServerTime, getUserData } from '../../lib/api';
import { detectTimeManipulation, getEnrolledCoursesFromDb, initDb, saveCourseDetailsToDb, saveCourseToDb, saveServerTime } from '../../lib/localDb';

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
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [timeManipulationDetected, setTimeManipulationDetected] = useState<boolean>(false);

  // Use the custom hook to get network status
  const { isConnected, netInfo } = useNetworkStatus();
  const enrolledCoursesFlatListRef = useRef<FlatList<EnrolledCourse>>(null);

  useEffect(() => {
    let isMounted = true;
    const initialize = async () => {
      try {
        console.log('🔧 Initializing home screen...');
        await initDb();
        console.log('✅ Home screen database initialized');
        if (isMounted) setIsInitialized(true);
      } catch (error) {
        console.error('❌ Home screen initialization error:', error);
        Alert.alert(
          'Initialization Error',
          'Failed to initialize the app. Please restart the application.',
          [{ text: 'OK' }]
        );
      }
    };
    initialize();
    return () => { isMounted = false; };
  }, []);

  const fetchAndSaveCompleteCoursesData = async (courses: EnrolledCourse[], userEmail: string) => {
    console.log('📦 Starting to fetch complete course data for offline access...');

    for (const course of courses) {
      try {
        console.log(`🔄 Fetching complete details for course: ${course.title}`);
        
        // Fetch complete course details including materials and assessments
        const courseDetailResponse = await api.get(`/courses/${course.id}`);
        
        if (courseDetailResponse.status === 200) {
          const fullCourseData = courseDetailResponse.data.course;
          
          // This is the call to the function we just implemented
          await saveCourseDetailsToDb(fullCourseData, userEmail);
          console.log(`✅ Complete course data saved for: ${course.title}`);
        }
      } catch (saveError) {
        console.error(`⚠️ Failed to fetch/save complete data for course ${course.title}:`, saveError);
      }
    }
    console.log('✅ Completed fetching and saving all course data for offline access');
  };

  useEffect(() => {
    const fetchData = async () => {
      // Only proceed if DB is initialized
      if (!isInitialized || netInfo === null) return;

      // Always get user data from local storage first for a quick load
      let userEmail = '';
      try {
        const userData = await getUserData();
        if (userData && userData.name && userData.email) {
          setUserName(userData.name);
          userEmail = userData.email;
        } else {
          // If no user data, it's an invalid session, redirect to login
          console.warn('User data or name not found in local storage. Redirecting to login.');
          await clearAuthToken();
          router.replace('/login');
          return;
        }
      } catch (error) {
        console.error('❌ Error getting user data:', error);
        router.replace('/login');
        return;
      }

      // Check for time manipulation before proceeding
      try {
        const timeCheck = await detectTimeManipulation(userEmail);
        if (!timeCheck.isValid) {
          console.log('❌ Time manipulation detected on home screen:', timeCheck.reason);
          setTimeManipulationDetected(true);
          Alert.alert(
            'Time Manipulation Detected',
            `${timeCheck.reason}. Please connect to the internet to re-sync your time settings.`,
            [
              {
                text: 'OK',
                onPress: () => {
                  if (isConnected) {
                    // If online, force logout and re-login to re-sync time
                    clearAuthToken();
                    router.replace('/login');
                  }
                }
              }
            ]
          );
          setIsLoadingEnrolledCourses(false);
          return;
        } else {
          setTimeManipulationDetected(false);
        }
      } catch (timeError) {
        console.error('❌ Error checking time manipulation:', timeError);
        // Continue with normal flow if time check fails
      }

      setIsLoadingEnrolledCourses(true);
      
      try {
        if (isConnected) {
          // Check for a token first before attempting API call
          const token = await getAuthToken();
          if (!token) {
             // Redirect to login if no token exists after coming online
             Alert.alert(
               "Session Expired",
               "You were logged in offline. Please log in again to sync your data.",
               [{ text: "OK", onPress: () => router.replace('/login') }]
             );
             setIsLoadingEnrolledCourses(false);
             return;
          }
          try {
            const apiServerTime = await getServerTime();
            if (apiServerTime) {
              const currentDeviceTime = new Date().toISOString();
              await saveServerTime(userEmail, apiServerTime, currentDeviceTime);
              console.log('✅ Server time synced and saved locally.');
            }
          } catch (timeError) {
            console.error('❌ Failed to fetch or save server time:', timeError);
            // If time manipulation was detected, don't proceed with API calls
            if (timeError.message === 'Time manipulation detected') {
              Alert.alert(
                'Time Manipulation Detected',
                'Please restart the app and ensure your device time is correct.',
                [{ text: 'OK', onPress: () => router.replace('/login') }]
              );
              return;
            }
          }

          // ONLINE MODE: Fetch from API and sync to local DB
          console.log('✅ Online: Fetching courses from API.');
          const response = await api.get('/my-courses');
          const courses = response.data.courses || [];
          setEnrolledCourses(courses);

          // First, save basic course info to local DB
          for (const course of courses) {
            try {
              await saveCourseToDb(course, userEmail);
            } catch (saveError) {
              console.error('⚠️ Failed to save basic course to DB:', saveError);
              // Continue with other courses even if one fails
            }
          }
          console.log('📄 Basic course info synced to local DB.');

          // Then, fetch and save complete course details including materials and assessments
          await fetchAndSaveCompleteCoursesData(courses, userEmail);
          
        } else {
          // OFFLINE MODE: Fetch from local DB for the specific user
          console.log('⚠️ Offline: Fetching courses from local DB.');
          const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
          setEnrolledCourses(offlineCourses as EnrolledCourse[]);
        }
      } catch (error: any) {
        console.error('Error fetching enrolled courses:', error.response?.data || error.message);
        
        // If the error is due to time manipulation, handle it specifically
        if (error.message === 'Time manipulation detected. Please log in again.') {
          Alert.alert(
            'Time Manipulation Detected',
            'Please log in again to continue.',
            [{ text: 'OK', onPress: () => router.replace('/login') }]
          );
          return;
        }
        
        // If online request fails, try to load from local DB as fallback
        if (isConnected) {
          console.log('🔄 API failed, falling back to local DB...');
          try {
            const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
            setEnrolledCourses(offlineCourses as EnrolledCourse[]);
          } catch (localError) {
            console.error('❌ Local DB fallback also failed:', localError);
            Alert.alert('Error', 'Failed to load your enrolled courses.');
          }
        } else {
          Alert.alert('Error', 'Failed to load your enrolled courses from local storage.');
        }
      } finally {
        setIsLoadingEnrolledCourses(false);
      }
    };

    fetchData();
  }, [isConnected, netInfo, isInitialized]);
  
  const handleSearchPress = () => {
    if (timeManipulationDetected) {
      Alert.alert(
        'Time Manipulation Detected',
        'Please connect to the internet to re-sync your time settings before searching.',
        [{ text: 'OK' }]
      );
      return;
    }

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

    if (!isConnected) {
      Alert.alert('Offline', 'You must be connected to the internet to search for courses.');
      return;
    }

    if (timeManipulationDetected) {
      Alert.alert(
        'Time Manipulation Detected',
        'Please restart the app to re-sync your time settings before searching.',
        [{ text: 'OK' }]
      );
      return;
    }

    setIsLoadingSearch(true);
    setHasSearched(true);
    try {
      const response = await api.get(`/courses/search?query=${encodeURIComponent(searchQuery)}`);
      setSearchResults(response.data.courses || []);
      console.log('Search Results:', response.data.courses);
    } catch (error: any) {
      console.error('Error searching courses:', error);
      if (error.message === 'Time manipulation detected. Please log in again.') {
        Alert.alert(
          'Time Manipulation Detected',
          'Please log in again to continue.',
          [{ text: 'OK', onPress: () => router.replace('/login') }]
        );
      } else {
        Alert.alert('Search Error', 'Failed to fetch search results. Please try again.');
      }
      setSearchResults([]);
    } finally {
      setIsLoadingSearch(false);
    }
  };

  const handleEnrollCourse = async (course: Course) => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be connected to the internet to enroll in a course.');
      return;
    }

    if (timeManipulationDetected) {
      Alert.alert(
        'Time Manipulation Detected',
        'Please restart the app to re-sync your time settings before enrolling.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    let userEmail = '';
    try {
      const userData = await getUserData();
      if (userData && userData.email) {
        userEmail = userData.email;
      } else {
        Alert.alert('Error', 'User data not found. Please log in again.');
        router.replace('/login');
        return;
      }
    } catch (error) {
      console.error('❌ Error getting user data:', error);
      Alert.alert('Error', 'User data not found. Please log in again.');
      router.replace('/login');
      return;
    }

    try {
      const response = await api.post('/enroll', { course_id: course.id });
      Alert.alert('Success', response.data.message || `Successfully enrolled in ${course.title}`);

      // Save the course to the local SQLite database for the specific user
      try {
        await saveCourseToDb(course, userEmail);
        // Also fetch and save complete course details for the newly enrolled course
        const courseDetailResponse = await api.get(`/courses/${course.id}`);
        if (courseDetailResponse.status === 200) {
          await saveCourseDetailsToDb(courseDetailResponse.data.course, userEmail);
        }
      } catch (saveError) {
        console.error('⚠️ Failed to save enrolled course to local DB:', saveError);
        // Don't block the enrollment process if local save fails
      }

      setSearchModalVisible(false);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);

      // Refresh the enrolled courses list from the API
      try {
        setIsLoadingEnrolledCourses(true);
        const updatedEnrolledCoursesResponse = await api.get('/my-courses');
        const updatedCourses = updatedEnrolledCoursesResponse.data.courses || [];
        setEnrolledCourses(updatedCourses);
        
        // Also fetch complete details for all courses after enrollment
        await fetchAndSaveCompleteCoursesData(updatedCourses, userEmail);
        
      } catch (refreshError) {
        console.error('Error refreshing enrolled courses after enrollment:', refreshError);
        // Fallback to local DB if API refresh fails
        try {
          const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
          setEnrolledCourses(offlineCourses as EnrolledCourse[]);
        } catch (localError) {
          console.error('❌ Local DB fallback failed:', localError);
        }
      } finally {
        setIsLoadingEnrolledCourses(false);
      }
    } catch (error: any) {
      console.error('Enrollment error:', error.response?.data || error.message);
      if (error.message === 'Time manipulation detected. Please log in again.') {
        Alert.alert(
          'Time Manipulation Detected',
          'Please log in again to continue.',
          [{ text: 'OK', onPress: () => router.replace('/login') }]
        );
      } else {
        Alert.alert('Enrollment Failed', error.response?.data?.message || 'Could not enroll in the course. Please try again.');
      }
    }
  };

  const renderCourseItem = ({ item }: { item: Course }) => (
    <View style={styles.courseResultCard}>
      <Text style={styles.courseResultTitle}>{item.title}</Text>
      <Text style={styles.courseResultCode}>Description: {item.description}</Text>
      <Text style={styles.courseResultDetails}>Program: {item.program?.name || 'N/A'}</Text>
      <Text style={styles.courseResultDetails}>Instructor: {item.instructor?.name || 'N/A'}</Text>

      <TouchableOpacity
        style={[
          styles.enrollButton, 
          (!isConnected || timeManipulationDetected) && styles.disabledButton
        ]}
        onPress={() => handleEnrollCourse(item)}
        disabled={!isConnected || timeManipulationDetected}
      >
        <Text style={styles.enrollButtonText}>Enroll Course</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEnrolledCourseCard = ({ item }: { item: EnrolledCourse }) => (
    <TouchableOpacity
      style={[
        styles.enrolledCourseCard,
        timeManipulationDetected && styles.disabledCard
      ]}
      onPress={() => {
        if (timeManipulationDetected) {
          Alert.alert(
            'Time Manipulation Detected',
            'Please connect to the internet to re-sync your time settings before accessing courses.',
            [{ text: 'OK' }]
          );
          return;
        }
        console.log('Viewing enrolled course:', item.title);
        router.navigate({
          pathname: '/courses',
          params: { courseId: item.id.toString() },
        });
      }}
      disabled={timeManipulationDetected}
    >
      <Ionicons name="book-outline" size={30} color="#007bff" />
      <Text style={styles.enrolledCourseCardTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.enrolledCourseCardCode}>{item.description}</Text>
      {item.pivot && (
        <Text style={styles.enrolledCourseCardStatus}>Status: {item.pivot.status}</Text>
      )}
      {timeManipulationDetected && (
        <Text style={styles.disabledText}>Time Sync Required</Text>
      )}
    </TouchableOpacity>
  );

  const scrollEnrolledCoursesRight = () => {
    if (enrolledCoursesFlatListRef.current) {
      enrolledCoursesFlatListRef.current.scrollToEnd({ animated: true });
    }
  };
  
  const scrollEnrolledCoursesLeft = () => {
    if (enrolledCoursesFlatListRef.current) {
      enrolledCoursesFlatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  };

  // Show loading while initializing
  if (!isInitialized) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcomeText}>Welcome, {userName}!</Text>
        <Text style={styles.subText}>Start learning something new today.</Text>
        {!isConnected && (
          <View style={styles.offlineNotice}>
            <Ionicons name="cloud-offline-outline" size={18} color="#fff" />
            <Text style={styles.offlineText}>Offline Mode</Text>
          </View>
        )}
        {timeManipulationDetected && (
          <View style={styles.timeManipulationNotice}>
            <Ionicons name="warning-outline" size={18} color="#fff" />
            <Text style={styles.timeManipulationText}>Time Sync Required</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[
          styles.searchButton, 
          (!isConnected || timeManipulationDetected) && styles.disabledButton
        ]}
        onPress={handleSearchPress}
        disabled={!isConnected || timeManipulationDetected}
      >
        <Ionicons name="search" size={20} color="#fff" style={styles.searchIcon} />
        <Text style={styles.searchButtonText}>Search for Courses, Topics, etc.</Text>
      </TouchableOpacity>

      <View style={styles.newSection}>
        <Text style={styles.newSectionTitle}>Featured Content</Text>
        <Text style={styles.newSectionText}>
          Explore popular courses and trending topics designed for you.
        </Text>
        {timeManipulationDetected && (
          <Text style={styles.timeSyncWarning}>
            ⚠️ Connect to internet to sync time settings and access all features.
          </Text>
        )}
      </View>

      <View style={styles.otherContent}>
        <View style={styles.sectionHeader}>
          <Text style={styles.quickAccessTitle}>My Courses</Text>
          <View style={styles.scrollButtons}>
            <TouchableOpacity onPress={scrollEnrolledCoursesLeft} disabled={timeManipulationDetected}>
              <Ionicons name="arrow-back-circle-outline" size={30} color={timeManipulationDetected ? "#ccc" : "#007bff"} />
            </TouchableOpacity>
            <TouchableOpacity onPress={scrollEnrolledCoursesRight} disabled={timeManipulationDetected}>
              <Ionicons name="arrow-forward-circle-outline" size={30} color={timeManipulationDetected ? "#ccc" : "#007bff"} />
            </TouchableOpacity>
          </View>
        </View>
        {isLoadingEnrolledCourses ? (
          <ActivityIndicator size="large" color="#007bff" />
        ) : enrolledCourses.length > 0 ? (
          <FlatList
            ref={enrolledCoursesFlatListRef}
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
            <Text style={styles.noCoursesEnrolledSubText}>
              {isConnected && !timeManipulationDetected 
                ? 'Search for courses above to get started!' 
                : timeManipulationDetected 
                  ? 'Connect to internet to sync time and enroll in courses.'
                  : 'Connect to the internet to enroll in new courses.'
              }
            </Text>
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
              editable={isConnected && !timeManipulationDetected}
            />
            <TouchableOpacity
              style={[
                styles.modalSearchButton, 
                (!isConnected || timeManipulationDetected) && styles.disabledButton
              ]}
              onPress={handleSearchSubmit}
              disabled={isLoadingSearch || !isConnected || timeManipulationDetected}
            >
              {isLoadingSearch ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalSearchButtonText}>Search</Text>
              )}
            </TouchableOpacity>
            {!isConnected && (
              <Text style={styles.offlineModalHint}>
                You must be online to search for new courses.
              </Text>
            )}
            {timeManipulationDetected && (
              <Text style={styles.timeManipulationModalHint}>
                Time synchronization required to search for courses.
              </Text>
            )}
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
  },
  header: {
    backgroundColor: '#007bff',
    padding: 20,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 10,
    marginBottom: 5,
    textAlign: 'center',
  },
  subText: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: 15,
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0056b3',
    padding: 15,
    marginHorizontal: 20,
    marginTop: -25,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 4,
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
    margin: 20,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  newSectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 5,
  },
  newSectionText: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  timeSyncWarning: {
    fontSize: 12,
    color: '#e74c3c',
    marginTop: 10,
    fontStyle: 'italic',
  },
  otherContent: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  quickAccessTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
  },
  noCoursesEnrolledContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  noCoursesEnrolledText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#34495e',
    textAlign: 'center',
  },
  noCoursesEnrolledSubText: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 5,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 20,
    textAlign: 'center',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ced4da',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 15,
    color: '#343a40',
  },
  modalSearchButton: {
    backgroundColor: '#007bff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSearchButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  searchResultsContainer: {
    marginTop: 20,
    maxHeight: 400,
  },
  searchResultsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 10,
  },
  courseResultCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  courseResultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  courseResultCode: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 5,
  },
  courseResultDetails: {
    fontSize: 14,
    color: '#7f8c8d',
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
    fontWeight: 'bold',
  },
  noResultsContainer: {
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
    fontSize: 13,
    color: '#28a745',
    marginTop: 5,
    fontWeight: '600',
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc3545',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 15,
    marginTop: 10,
  },
  offlineText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  timeManipulationNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff6b35',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 15,
    marginTop: 5,
  },
  timeManipulationText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  flatListContent: {
    paddingBottom: 10,
  },
  scrollButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  offlineModalHint: {
    fontSize: 12,
    color: '#dc3545',
    textAlign: 'center',
    marginTop: 10,
  },
  timeManipulationModalHint: {
    fontSize: 12,
    color: '#ff6b35',
    textAlign: 'center',
    marginTop: 10,
  },
  disabledButton: {
    backgroundColor: '#ccc',
    shadowColor: 'transparent',
  },
  disabledCard: {
    opacity: 0.6,
    backgroundColor: '#f5f5f5',
  },
  disabledText: {
    fontSize: 11,
    color: '#dc3545',
    marginTop: 5,
    textAlign: 'center',
    fontWeight: 'bold',
  },
});