// This is the modified code for `index.tsx`.
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNetworkStatus } from '../../context/NetworkContext';
import api, { clearAuthToken, getAuthToken, getServerTime, getUserData } from '../../lib/api';
import { downloadAllAssessmentDetails, getAssessmentsWithoutDetails, getDb, getEnrolledCoursesFromDb, initDb, resetTimeCheckData, saveCourseDetailsToDb, saveCourseToDb, saveServerTime, updateTimeSync } from '../../lib/localDb';


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
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [isDownloadingData, setIsDownloadingData] = useState(false);
  const [assessmentsNeedingDetails, setAssessmentsNeedingDetails] = useState<number>(0);
  const [isAdVisible, setIsAdVisible] = useState<boolean>(false);
  const adContentHeight = 60;
  const adHeight = useRef(new Animated.Value(0)).current;
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

  useEffect(() => {
    const checkAssessmentsNeedingDetails = async () => {
      if (!isInitialized) return;
      
      try {
        const userData = await getUserData();
        if (userData?.email) {
          const assessmentIds = await getAssessmentsWithoutDetails(userData.email);
          setAssessmentsNeedingDetails(assessmentIds.length);
        }
      } catch (error) {
        console.error('Error checking assessments needing details:', error);
      }
    };
    
    checkAssessmentsNeedingDetails();
  }, [enrolledCourses, isInitialized]);

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

      setIsLoadingEnrolledCourses(true);

      try {
        if (isConnected) {
          // ONLINE MODE: Fetch from API and sync to local DB
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
          
          await resetTimeCheckData(userEmail);
          // --- ADDED CODE END ---
          
          try {
            const apiServerTime = await getServerTime();
            if (apiServerTime) {
              const currentDeviceTime = new Date().toISOString();
              await saveServerTime(userEmail, apiServerTime, currentDeviceTime);
              console.log('✅ Server time synced and saved locally.');
            }
          } catch (timeError) {
            console.error('❌ Failed to fetch or save server time:', timeError);
          }

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
          // OFFLINE MODE: Fetch from local DB
          console.log('⚠️ Offline: Fetching courses from local DB.');
          const offlineCourses = await getEnrolledCoursesFromDb(userEmail);
          setEnrolledCourses(offlineCourses as EnrolledCourse[]);
        }
      } catch (error: any) {
        console.error('Error fetching enrolled courses:', error.response?.data || error.message);

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

  useEffect(() => {
  if (!isConnected || !isInitialized) return;

  // Set up periodic time sync while online and on home screen
  const timeSyncInterval = setInterval(async () => {
    try {
      const userData = await getUserData();
      if (userData && userData.email) {
        // Update the time sync periodically to prevent stale time issues
        await updateTimeSync(userData.email);
        
        // Optionally, fetch fresh server time every 10 minutes
        const now = Date.now();
        
        // Get the last sync time from the database
        const db = await getDb();
        const result = await db.getFirstAsync(
          `SELECT last_time_check FROM offline_users WHERE email = ?;`,
          [userData.email]
        ) as any;
        
        const lastSync = result?.last_time_check;
        if (!lastSync || (now - lastSync) > 600000) { // 10 minutes
          try {
            const apiServerTime = await getServerTime();
            if (apiServerTime) {
              await saveServerTime(userData.email, apiServerTime, new Date().toISOString());
            }
          } catch (timeError) {
            console.error('⚠️ Periodic server time sync failed:', timeError);
          }
        }
      }
    } catch (error) {
      console.error('❌ Periodic time sync error:', error);
    }
    }, 60000); // Run every minute

    return () => clearInterval(timeSyncInterval);
  }, [isConnected, isInitialized]);

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

    if (!isConnected) {
      Alert.alert('Offline', 'You must be connected to the internet to search for courses.');
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
      Alert.alert('Search Error', 'Failed to fetch search results. Please try again.');
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
      Alert.alert('Enrollment Failed', error.response?.data?.message || 'Could not enroll in the course. Please try again.');
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
          !isConnected && styles.disabledButton
        ]}
        onPress={() => handleEnrollCourse(item)}
        disabled={!isConnected}
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
        router.navigate({
          pathname: '/courses',
          params: { courseId: item.id.toString() },
        });
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

  const toggleAd = () => {
    setIsAdVisible(!isAdVisible);
    Animated.timing(adHeight, {
      toValue: isAdVisible ? 0 : adContentHeight, // Animate to 0 or content height
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const handleAdButtonPress = async () => {
    if (!isConnected) {
      Alert.alert('Offline Mode', 'You must be online to download assessment details.');
      return;
    }

    try {
      const userData = await getUserData();
      if (!userData?.email) {
        Alert.alert('Error', 'User data not found. Please log in again.');
        return;
      }

      const assessmentIds = await getAssessmentsWithoutDetails(userData.email);
      
      if (assessmentIds.length === 0) {
        Alert.alert(
          'Already Up to Date', 
          'All assessment details are already downloaded for offline use.',
          [{ text: 'OK', onPress: toggleAd }]
        );
        return;
      }

      Alert.alert(
        'Download Assessment Details',
        `Found ${assessmentIds.length} assessments that need detailed data (attempts, submissions, etc.). This will download all missing details for offline use.\n\nProceed with download?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Download',
            onPress: async () => {
              setIsDownloadingData(true);
              setDownloadProgress({ current: 0, total: assessmentIds.length });

              try {
                // Pass api instance as parameter
                const result = await downloadAllAssessmentDetails(
                  userData.email,
                  api, // Pass the api instance here
                  (current, total) => {
                    setDownloadProgress({ current, total });
                  }
                );

                Alert.alert(
                  'Download Complete',
                  `Successfully downloaded details for ${result.success} assessments.${
                    result.failed > 0 ? `\n${result.failed} assessments failed to download.` : ''
                  }\n\nAll data is now available offline!`,
                  [{ text: 'OK', onPress: toggleAd }]
                );

                // Update the count of assessments needing details
                setAssessmentsNeedingDetails(0);

              } catch (error) {
                console.error('Download failed:', error);
                Alert.alert(
                  'Download Failed',
                  'Failed to download assessment details. Please check your internet connection and try again.',
                  [{ text: 'OK' }]
                );
              } finally {
                setIsDownloadingData(false);
                setDownloadProgress({ current: 0, total: 0 });
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error in handleAdButtonPress:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
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
      {/* Ad-style dropdown at the very top */}
      <View style={styles.adContainer}>
        <Animated.View style={[styles.adContent, { height: adHeight }]}>
          <TouchableOpacity 
            style={[
              styles.adButton, 
              isDownloadingData && styles.adButtonDownloading,
              !isConnected && styles.disabledButton
            ]} 
            onPress={handleAdButtonPress}
            disabled={isDownloadingData || !isConnected}
          >
            {isDownloadingData ? (
              <View style={styles.downloadProgressContainer}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.adButtonText}>
                  Downloading... ({downloadProgress.current}/{downloadProgress.total})
                </Text>
              </View>
            ) : (
              <Text style={styles.adButtonText}>
                {assessmentsNeedingDetails > 0 
                  ? `Download All Data (${assessmentsNeedingDetails} assessments need details)`
                  : 'Download All Data for Offline Use'
                }
                {!isConnected && ' - Offline'}
              </Text>
            )}
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity style={styles.adToggle} onPress={toggleAd}>
          <Ionicons
            name={isAdVisible ? 'chevron-up' : 'chevron-down'}
            size={24}
            color="#fff"
          />
        </TouchableOpacity>
      </View>

      <View style={styles.header}>
        <Text style={styles.welcomeText}>Welcome, {userName}!</Text>
        <Text style={styles.subText}>Start learning something new today.</Text>
        {!isConnected && (
          <View style={styles.offlineNotice}>
            <Ionicons name="cloud-offline-outline" size={18} color="#fff" />
            <Text style={styles.offlineText}>Offline Mode</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[
          styles.searchButton,
          !isConnected && styles.disabledButton
        ]}
        onPress={handleSearchPress}
        disabled={!isConnected}
      >
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
          <View style={styles.scrollButtons}>
            <TouchableOpacity onPress={scrollEnrolledCoursesLeft}>
              <Ionicons name="arrow-back-circle-outline" size={30} color={"#007bff"} />
            </TouchableOpacity>
            <TouchableOpacity onPress={scrollEnrolledCoursesRight}>
              <Ionicons name="arrow-forward-circle-outline" size={30} color={"#007bff"} />
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
              {isConnected
                ? 'Search for courses above to get started!'
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
              editable={isConnected}
            />
            <TouchableOpacity
              style={[
                styles.modalSearchButton,
                !isConnected && styles.disabledButton
              ]}
              onPress={handleSearchSubmit}
              disabled={isLoadingSearch || !isConnected}
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
  adContainer: {
    backgroundColor: '#007bff',
    overflow: 'hidden',
    position: 'relative',
    top: 0,
    width: '100%',
    zIndex: 10,
  },
  adContent: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  adButton: {
    backgroundColor: '#28a745',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginBottom: 5, // Adds a little space between the button and the arrow
  },
  adButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  adToggle: {
    height: 40,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#007bff',
  },
  header: {
    backgroundColor: '#007bff',
    top: -20,
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
    backgroundColor: '#007bff',
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
  disabledButton: {
    backgroundColor: '#ccc',
    shadowColor: 'transparent',
  },
  adButtonDownloading: {
  backgroundColor: '#17a2b8', // Different color when downloading
  },
  downloadProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});