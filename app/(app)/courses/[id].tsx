import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { showOfflineModeWarningIfNeeded } from '../../../lib/offlineWarning';
// Import your API and database functions
import { useNetworkStatus } from '../../../context/NetworkContext';
import api, {
  getServerTime,
  getUserData,
} from '../../../lib/api';
import {
  canAccessOfflineContent,
  checkManipulationHistory,
  clearManipulationFlag,
  detectTimeManipulation,
  getCourseDetailsFromDb,
  getSavedServerTime,
  saveCourseDetailsToDb,
} from '../../../lib/localDb';

// Define interfaces for detailed course data
interface Material {
  id: number;
  title: string;
  file_path?: string;
  content?: string;
  type: 'material';
  created_at: string;
  available_at?: string;
  unavailable_at?: string;
  isNested?: boolean;
}

interface Assessment {
  id: number;
  title: string;
  type: 'assessment';
  created_at: string;
  available_at?: string;
  unavailable_at?: string;
  access_code?: string;
  isNested?: boolean;
}

interface Topic {
  id: number;
  title: string;
  description?: string;
  materials: Material[];
  assessments: Assessment[];
  type: 'topic';
  created_at: string;
  isNested?: boolean;
}

type CourseItem = Topic | Material | Assessment;

interface CourseDetail {
  id: number;
  title: string;
  course_code: string;
  description: string;
  credits: number;
  status: string;
  program: {
    id: number;
    name: string;
  };
  instructor: {
    id: number;
    name: string;
    email: string;
  };
  sorted_content: CourseItem[];
}

export default function CourseDetailsScreen() {
  const { id: courseId, scrollToAssessment, highlightAssessment } = useLocalSearchParams<{ id: string; scrollToAssessment?: string; highlightAssessment?: string; }>(); 
  const [courseDetail, setCourseDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { isConnected, netInfo } = useNetworkStatus();
  const [isAccessCodeModalVisible, setAccessCodeModalVisible] = useState(false);
  const [currentAssessment, setCurrentAssessment] = useState<Assessment | null>(null);
  const [enteredAccessCode, setEnteredAccessCode] = useState('');
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  const [serverTime, setServerTime] = useState<Date | null>(null);
  const [timeManipulationDetected, setTimeManipulationDetected] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState(false); 
  const [highlightedAssessmentId, setHighlightedAssessmentId] = useState<number | null>(null);
  const sectionListRef = useRef<SectionList<CourseItem>>(null);

  useEffect(() => {
    if (highlightAssessment && scrollToAssessment && courseDetail?.sorted_content) {
      const assessmentIdToFind = Number(scrollToAssessment);

      // Find the item index in the main list
      const itemIndex = courseDetail.sorted_content.findIndex(item => {
        if (item.type === 'assessment' && item.id === assessmentIdToFind) {
          return true; // It's a standalone assessment
        }
        if (item.type === 'topic') {
          // Check if the assessment is nested inside this topic
          return item.assessments.some(a => a.id === assessmentIdToFind);
        }
        return false;
      });

      if (itemIndex !== -1) {
        console.log(`🎯 Found assessment ${assessmentIdToFind} at index ${itemIndex}. Highlighting and scrolling...`);
        
        // Set the highlight state. It will now remain in this state.
        setHighlightedAssessmentId(assessmentIdToFind);

        // Scroll to the location
        sectionListRef.current?.scrollToLocation({
          sectionIndex: 0, 
          itemIndex: itemIndex,
          viewPosition: 0.3, 
          animated: true,
        });

        // The timer that cleared the highlight has been removed.
      } else {
          console.log(`⚠️ Could not find assessment with ID ${assessmentIdToFind} to highlight.`);
      }
    }
  }, [courseDetail, scrollToAssessment, highlightAssessment]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    // Create a Date object, which by default handles timezone conversions.
    const date = new Date(dateString);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return date.toLocaleDateString(undefined, options);
  };

  // Centralized availability check function that uses server time and detects manipulation
  const isAvailable = (item: Material | Assessment) => {
    // If time manipulation detected, disable all content
    if (timeManipulationDetected) {
      console.log('⚠️ Time manipulation detected, treating item as unavailable');
      return false;
    }

    // If server time isn't available, disable everything
    if (!serverTime) {
      console.log('⚠️ Server time not available, treating item as unavailable');
      return false;
    }

    const availableAt = 'available_at' in item ? item.available_at : null;
    const unavailableAt = 'unavailable_at' in item ? item.unavailable_at : null;

    const isAvailable = !availableAt || serverTime >= new Date(availableAt);
    const isNotUnavailable = !unavailableAt || serverTime < new Date(unavailableAt);

    const isItemAvailable = isAvailable && isNotUnavailable;

    console.log(`📅 Checking availability for "${item.title}":`, {
      serverTime: serverTime.toISOString(),
      availableAt: availableAt ? new Date(availableAt).toISOString() : 'N/A',
      unavailableAt: unavailableAt ? new Date(unavailableAt).toISOString() : 'N/A',
      isAvailable: isItemAvailable
    });
    
    return isItemAvailable;
  };

  useEffect(() => {
    if (courseId) {
      fetchCourseDetails();
    }
  }, [courseId, netInfo?.isInternetReachable]);

  const fetchCourseDetails = async () => {
  setLoading(true);
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
    // ALWAYS check for manipulation first, regardless of connection status
    const timeCheck = await detectTimeManipulation(userEmail);
    if (!timeCheck.isValid) {
      setTimeManipulationDetected(true);
      setServerTime(null);
      
      if (timeCheck.requiresOnlineSync) {
        Alert.alert(
          '🚨 Time Manipulation Detected',
          `${timeCheck.reason}\n\n⚠️ WARNING: Any attempt to manipulate device time will lock your access. You must connect to the internet to restore access.`,
          [
            {
              text: 'Understood',
              onPress: () => {
                setCourseDetail(null);
              }
            }
          ]
        );
        setLoading(false);
        return;
      }
    }

    if (netInfo?.isInternetReachable && !timeManipulationDetected) {
      // ONLINE MODE: Fetch fresh data and establish time baseline
      console.log('✅ Online: Fetching course details and establishing strict time baseline');
      
      try {
        const apiServerTime = await getServerTime(true);
        if (apiServerTime) {
          const serverTimeDate = new Date(apiServerTime);
          setServerTime(serverTimeDate);
          
          // Clear any previous manipulation flags since user is now online
          await clearManipulationFlag(userEmail);
          setTimeManipulationDetected(false);
          
          console.log('✅ Server time set and strict baseline established:', serverTimeDate.toISOString());
          
          // Show success message if this is a recovery from manipulation
          const manipulationHistory = await checkManipulationHistory(userEmail);
          if (manipulationHistory) {
            Alert.alert(
              '✅ Access Restored',
              'Your access has been restored. Remember: any time manipulation will immediately lock your access again.',
              [{ text: 'Understood' }]
            );
          }
        } else {
          setServerTime(null);
          Alert.alert('Network Error', 'Could not sync server time. Some content may be unavailable.');
        }
      } catch (timeError) {
        console.error('❌ Error establishing time baseline:', timeError);
        setServerTime(null);
      }

      // Fetch course data
      const response = await api.get(`/courses/${courseId}`);
      if (response.status === 200) {
        const courseData = response.data.course;
        setCourseDetail(courseData);
        await saveCourseDetailsToDb(courseData, userEmail);
        console.log('✅ Course details fetched and saved for offline use');
      } else {
        // Fallback to offline data
        const offlineData = await getCourseDetailsFromDb(Number(courseId), userEmail);
        if (offlineData) {
          setCourseDetail(offlineData);
          Alert.alert('Network Error', 'Failed to load live data, showing offline content.');
        }
      }
    } else {
      // OFFLINE MODE: Show proactive warning and use cached data with STRICT time validation
      console.log('⚠️ Offline: Entering offline mode with strict time monitoring');

      // PROACTIVE WARNING: Use the imported function
      await showOfflineModeWarningIfNeeded();

      // Double-check manipulation status in offline mode
      const canAccess = await canAccessOfflineContent(userEmail);
      if (!canAccess) {
        setTimeManipulationDetected(true);
        setServerTime(null);
        Alert.alert(
          '🚨 Access Blocked',
          '⚠️ Time manipulation was detected. You must connect to the internet to restore access.\n\nWARNING: Do not attempt to manipulate your device time. This will only extend the lockout period.',
          [{ text: 'Understood' }]
        );
        setCourseDetail(null); // Block content
      } else {
        setTimeManipulationDetected(false);
        
        // Get calculated offline server time
        const calculatedServerTime = await getSavedServerTime(userEmail);
        if (calculatedServerTime) {
          const serverTimeDate = new Date(calculatedServerTime);
          setServerTime(serverTimeDate);
          console.log('✅ Using calculated offline server time with strict monitoring:', serverTimeDate.toISOString());
        }

        // Load offline course data
        const offlineData = await getCourseDetailsFromDb(Number(courseId), userEmail);
        if (offlineData) {
          setCourseDetail(offlineData);
        } else {
          Alert.alert('Offline Error', 'No offline content available for this course.');
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch course details:', error);
    Alert.alert('Error', 'Unable to load course details.');
  } finally {
    setLoading(false);
  }
};


  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    if (!netInfo?.isInternetReachable) {
      Alert.alert(
        'Offline',
        'Please check your internet connection to refresh data.',
        [{ text: 'OK' }]
      );
      setIsRefreshing(false);
      return;
    }

    try {
      await fetchCourseDetails();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchCourseDetails]);

  const handleAccessCodeSubmit = () => {
    if (timeManipulationDetected) {
      Alert.alert(
        '🚨 Access Blocked',
        'Time manipulation was detected. Connect to the internet to restore access.\n\n⚠️ WARNING: Manipulating device time will immediately lock your access.',
        [{ text: 'Understood' }]
      );
      return;
    }

    setAccessCodeError(null);

    if (!currentAssessment || !currentAssessment.access_code) {
      setAccessCodeError("No access code defined for this assessment.");
      return;
    }
    if (enteredAccessCode === currentAssessment.access_code) {
      setAccessCodeModalVisible(false);
      setEnteredAccessCode('');
      router.push(`/courses/assessments/${currentAssessment.id}`);
    } else {
      setAccessCodeError('Incorrect access code. Please try again.');
    }
  };

  const getItemIcon = (type: string) => {
    switch (type) {
      case 'material': return 'document-text';
      case 'assessment': return 'school';
      case 'topic': return 'folder';
      default: return 'document';
    }
  };

  const getItemColor = (type: string) => {
    switch (type) {
      case 'material': return '#4CAF50';
      case 'assessment': return '#2196F3';
      case 'topic': return '#FF9800';
      default: return '#757575';
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#02135eff', '#7979f1ff']}
          style={styles.loadingGradient}
        >
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>Loading course details...</Text>
        </LinearGradient>
      </View>
    );
  }

  if (!courseDetail) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#02135eff', '#7979f1ff']}
          style={styles.loadingGradient}
        >
          <Ionicons name="alert-circle" size={64} color="#fff" />
          <Text style={styles.errorText}>Course not found or an error occurred.</Text>
        </LinearGradient>
      </View>
    );
  }

  const renderHeader = () => (
    <View>
      {/* Enhanced Header with Gradient */}
      <LinearGradient
        colors={['#02135eff', '#7979f1ff']}
        style={[styles.headerContainer, timeManipulationDetected && styles.disabledHeader]}
      >
        <View style={styles.headerContent}>
          <Text style={styles.courseTitle}>{courseDetail?.title || 'Course Access Blocked'}</Text>
          <Text style={styles.courseCode}>{courseDetail?.description}</Text>
          
          {!timeManipulationDetected && courseDetail && (
            <>
              <View style={styles.instructorInfo}>
                <Ionicons name="person" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.instructorText}>
                  {courseDetail.instructor.name} ({courseDetail.instructor.email})
                </Text>
              </View>
              
              {/* <View style={styles.courseStats}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{courseDetail.credits}</Text>
                  <Text style={styles.statLabel}>Credits</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{courseDetail.sorted_content.length}</Text>
                  <Text style={styles.statLabel}>Items</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{courseDetail.status}</Text>
                  <Text style={styles.statLabel}>Status</Text>
                </View>
              </View> */}
            </>
          )}
          
          {timeManipulationDetected && (
            <View style={styles.timeManipulationWarning}>
              <Ionicons name="warning" size={24} color="#fff" />
              <Text style={styles.warningText}>TIME MANIPULATION DETECTED</Text>
              <Text style={styles.warningSubText}>
                Your access has been blocked due to device time manipulation.
              </Text>
              <Text style={styles.warningSubText}>
                Connect to the internet to restore access.
              </Text>
            </View>
          )}
          
          {!netInfo?.isInternetReachable && !timeManipulationDetected && (
            <View style={styles.offlineNotice}>
              <Ionicons name="cloud-offline" size={14} color="#fff" />
              <Text style={styles.offlineText}>Working offline</Text>
            </View>
          )}
        </View>
      </LinearGradient>
    </View>
  );

  const sectionsData = [{
    title: 'Course Content',
    data: courseDetail.sorted_content,
  }];

  const renderItem = ({ item }: { item: CourseItem }) => {
    if (item.type === 'topic') {
      const topic = item as Topic;
      return (
        <View style={[styles.topicCard, timeManipulationDetected && styles.disabledCard]}>
          <View style={styles.topicHeader}>
            <View style={[styles.iconContainer, { backgroundColor: getItemColor('topic') + '15' }]}>
              <Ionicons name={getItemIcon('topic')} size={24} color={getItemColor('topic')} />
            </View>
            <View style={styles.topicInfo}>
              <Text style={styles.topicTitle}>{topic.title}</Text>
              <Text style={styles.topicDescription}>{topic.description}</Text>
            </View>
          </View>

          {(topic.materials.length > 0 || topic.assessments.length > 0) && (
            <View style={styles.nestedItemsContainer}>
              {topic.materials.map(material => {
                const available = isAvailable(material);
                const disabled = !available || timeManipulationDetected;

                return (
                  <TouchableOpacity
                    key={material.id}
                    style={[
                      styles.itemCardNested,
                      !available && styles.unavailableCard,
                      timeManipulationDetected && styles.disabledCard
                    ]}
                    onPress={() => {
                      if (timeManipulationDetected) {
                        Alert.alert(
                          'Time Manipulation Detected',
                          'Course content is locked. Please connect to the internet to re-sync your time settings.',
                          [{ text: 'OK' }]
                        );
                        return;
                      }
                      if (!disabled) {
                        router.push(`/courses/materials/${material.id}`);
                      } else {
                        Alert.alert('Not Available Yet', `This material will be available on ${formatDate(material.available_at!)}.`);
                      }
                    }}
                    disabled={disabled}
                    activeOpacity={0.8}
                  >
                    <View style={styles.nestedItemHeader}>
                      <View style={[styles.iconContainerSmall, { backgroundColor: getItemColor('material') + '15' }]}>
                        <Ionicons name={getItemIcon('material')} size={16} color={getItemColor('material')} />
                      </View>
                      <View style={styles.nestedItemInfo}>
                        <Text style={styles.itemTitleNested}>{material.title}</Text>
                        <Text style={styles.itemTypeNested}>
                          Material {!available && '(Not Available Yet)'}
                          {timeManipulationDetected && ' (Time Sync Required)'}
                        </Text>
                      </View>
                      {!available && !timeManipulationDetected && (
                        <View style={styles.availabilityBadge}>
                          <Text style={styles.availabilityText}>Locked</Text>
                        </View>
                      )}
                    </View>
                    
                    {material.content && (
                      <Text style={styles.itemDetailNested}>
                        {material.content.substring(0, 100)}...
                      </Text>
                    )}
                    
                    <View style={styles.itemFooter}>
                      <Text style={styles.itemDateNested}>
                        Created: {formatDate(material.created_at)}
                      </Text>
                      {material.available_at && !available && !timeManipulationDetected && (
                        <Text style={[styles.availableDateText, styles.additionalDateInfo]}>
                          Available: {formatDate(material.available_at)}
                        </Text>
                      )}
                      {material.unavailable_at && (
                        <Text style={[styles.availableDateText, styles.additionalDateInfo]}>
                          Unavailable: {formatDate(material.unavailable_at)}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
              
              {topic.assessments.map(assessment => {
                const available = isAvailable(assessment);
                const disabled = !available || timeManipulationDetected;
                const isHighlighted = highlightedAssessmentId === assessment.id;

                return (
                  <TouchableOpacity
                    key={assessment.id}
                    style={[
                      styles.itemCardNested,
                      !available && styles.unavailableCard,
                      timeManipulationDetected && styles.disabledCard,
                      isHighlighted && styles.highlightedCardNested,
                    ]}
                    onPress={() => {
                      if (timeManipulationDetected) {
                        Alert.alert(
                          'Time Manipulation Detected',
                          'Course content is locked. Please connect to the internet to re-sync your time settings.',
                          [{ text: 'OK' }]
                        );
                        return;
                      }
                      if (!disabled) {
                        if (assessment.access_code) {
                          setCurrentAssessment(assessment);
                          setAccessCodeModalVisible(true);
                        } else {
                          router.push(`/courses/assessments/${assessment.id}`);
                        }
                      } else {
                        Alert.alert('Access Denied', `This assessment is not currently available.`);
                      }
                    }}
                    disabled={disabled}
                    activeOpacity={0.8}
                  >
                    <View style={styles.nestedItemHeader}>
                      <View style={[styles.iconContainerSmall, { backgroundColor: getItemColor('assessment') + '15' }]}>
                        <Ionicons name={getItemIcon('assessment')} size={16} color={getItemColor('assessment')} />
                      </View>
                      <View style={styles.nestedItemInfo}>
                        <Text style={styles.itemTitleNested}>{assessment.title}</Text>
                        <Text style={styles.itemTypeNested}>
                          Assessment
                          {assessment.access_code && ' (Code Required)'}
                          {!available && ' (Not Available)'}
                          {timeManipulationDetected && ' (Time Sync Required)'}
                        </Text>
                      </View>
                      {assessment.access_code && (
                        <View style={styles.codeRequiredBadge}>
                          <Ionicons name="key" size={12} color="#fff" />
                        </View>
                      )}
                    </View>
                    
                    <View style={styles.itemFooter}>
                      <Text style={styles.itemDateNested}>
                        Created: {formatDate(assessment.created_at)}
                      </Text>
                      {assessment.available_at && !available && !timeManipulationDetected && (
                        <Text style={[styles.availableDateText, styles.additionalDateInfo]}>
                          Available: {formatDate(assessment.available_at)}
                        </Text>
                      )}
                      {assessment.unavailable_at && (
                        <Text style={[styles.availableDateText, styles.additionalDateInfo]}>
                          Unavailable: {formatDate(assessment.unavailable_at)}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      );
    } else if (item.type === 'material') {
      const material = item as Material;
      const available = isAvailable(material);
      const disabled = !available || timeManipulationDetected;

      return (
        <TouchableOpacity
          style={[
            styles.itemCard,
            !available && styles.unavailableCard,
            timeManipulationDetected && styles.disabledCard
          ]}
          onPress={() => {
            if (timeManipulationDetected) {
              Alert.alert(
                'Time Manipulation Detected',
                'Course content is locked. Please connect to the internet to re-sync your time settings.',
                [{ text: 'OK' }]
              );
              return;
            }
            if (!disabled) {
              router.push(`/courses/materials/${material.id}`);
            } else {
              Alert.alert('Not Available Yet', `This material will be available on ${formatDate(material.available_at!)}.`);
            }
          }}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <View style={styles.itemHeader}>
            <View style={[styles.iconContainer, { backgroundColor: getItemColor('material') + '15' }]}>
              <Ionicons name={getItemIcon('material')} size={24} color={getItemColor('material')} />
            </View>
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle}>{material.title}</Text>
              <Text style={styles.itemType}>
                Independent Material
                {!available && ' (Not Available Yet)'}
                {timeManipulationDetected && ' (Time Sync Required)'}
              </Text>
            </View>
            {!available && !timeManipulationDetected && (
              <View style={styles.availabilityBadge}>
                <Text style={styles.availabilityText}>Locked</Text>
              </View>
            )}
          </View>
          
          {material.content && (
            <Text style={styles.itemDetail}>{material.content.substring(0, 150)}...</Text>
          )}
          
          <View style={styles.itemFooter}>
            <Text style={styles.itemDate}>Created: {formatDate(material.created_at)}</Text>
            {material.available_at && !available && !timeManipulationDetected && (
              <Text style={[styles.availableDateText, styles.additionalDateInfo]}>
                Available: {formatDate(material.available_at)}
              </Text>
            )}
            {material.unavailable_at && (
              <Text style={[styles.availableDateText, styles.additionalDateInfo]}>
                Unavailable: {formatDate(material.unavailable_at)}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    } else if (item.type === 'assessment') {
      const assessment = item as Assessment;
      const available = isAvailable(assessment);
      const disabled = !available || timeManipulationDetected;
      const isHighlighted = highlightedAssessmentId === assessment.id;

      return (
        <TouchableOpacity
          style={[
            styles.itemCard,
            !available && styles.unavailableCard,
            timeManipulationDetected && styles.disabledCard,
            isHighlighted && styles.highlightedCard
          ]}
          onPress={() => {
            if (timeManipulationDetected) {
              Alert.alert(
                'Time Manipulation Detected',
                'Course content is locked. Please connect to the internet to re-sync your time settings.',
                [{ text: 'OK' }]
              );
              return;
            }
            if (!disabled) {
              if (assessment.access_code) {
                setCurrentAssessment(assessment);
                setAccessCodeModalVisible(true);
              } else {
                router.push(`/courses/assessments/${assessment.id}`);
              }
            } else {
              Alert.alert('Access Denied', `This assessment is not currently available.`);
            }
          }}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <View style={styles.itemHeader}>
            <View style={[styles.iconContainer, { backgroundColor: getItemColor('assessment') + '15' }]}>
              <Ionicons name={getItemIcon('assessment')} size={24} color={getItemColor('assessment')} />
            </View>
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle}>{assessment.title}</Text>
              <Text style={styles.itemType}>
                Independent Assessment
                {assessment.access_code && ' (Code Required)'}
                {!available && ' (Not Available)'}
                {timeManipulationDetected && ' (Time Sync Required)'}
              </Text>
            </View>
            <View style={styles.itemBadges}>
              {assessment.access_code && (
                <View style={styles.codeRequiredBadge}>
                  <Ionicons name="key" size={12} color="#fff" />
                </View>
              )}
              {!available && !timeManipulationDetected && (
                <View style={styles.availabilityBadge}>
                  <Text style={styles.availabilityText}>Locked</Text>
                </View>
              )}
            </View>
          </View>
          
          <View style={styles.itemFooter}>
            <Text style={styles.itemDate}>Created: {formatDate(assessment.created_at)}</Text>
            {assessment.available_at && !available && !timeManipulationDetected && (
              <Text style={[styles.availableDateText, styles.additionalDateInfo]}>
                Available: {formatDate(assessment.available_at)}
              </Text>
            )}
            {assessment.unavailable_at && (
              <Text style={[styles.availableDateText, styles.additionalDateInfo]}>
                Unavailable: {formatDate(assessment.unavailable_at)}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: courseDetail.title }} />
      
      <SectionList
        ref={sectionListRef}
        sections={sectionsData}
        keyExtractor={(item, index) => `${item.type}-${item.id}-${index}`}
        renderItem={renderItem}
        renderSectionHeader={({ section: { title } }) => (
          <View style={[styles.sectionHeader, timeManipulationDetected && styles.disabledHeader]}>
            <Text style={styles.sectionTitle}>
              {title} {timeManipulationDetected ? '(Time Sync Required)' : ''}
            </Text>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#667eea"
            colors={['#667eea', '#764ba2']}
          />
        }
        ListHeaderComponent={renderHeader()}
        contentContainerStyle={styles.sectionListContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Enhanced Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={isAccessCodeModalVisible}
        onRequestClose={() => {
          setAccessCodeModalVisible(!isAccessCodeModalVisible);
          setEnteredAccessCode('');
          setAccessCodeError(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, timeManipulationDetected && styles.disabledCard]}>
            <LinearGradient
              colors={['#02135eff', '#7979f1ff']}
              style={styles.modalHeader}
            >
              <Ionicons name="key" size={32} color="#fff" />
              <Text style={styles.modalTitle}>Access Code Required</Text>
            </LinearGradient>
            
            <View style={styles.modalBody}>
              {currentAssessment && (
                <Text style={styles.modalAssessmentTitle}>
                  "{currentAssessment.title}"
                </Text>
              )}
              
              {timeManipulationDetected ? (
                <Text style={styles.timeManipulationModalText}>
                  Time synchronization required to access assessments.
                </Text>
              ) : (
                <Text style={styles.modalSubtitle}>
                  Please enter the access code to continue with this assessment.
                </Text>
              )}
              
              <TextInput
                style={[styles.input, timeManipulationDetected && styles.disabledInput]}
                placeholder="Enter access code"
                value={enteredAccessCode}
                onChangeText={setEnteredAccessCode}
                secureTextEntry
                autoCapitalize="none"
                editable={!timeManipulationDetected}
              />
              
              {accessCodeError && (
                <Text style={styles.errorTextModal}>{accessCodeError}</Text>
              )}
              
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={() => {
                    setAccessCodeModalVisible(false);
                    setEnteredAccessCode('');
                    setAccessCodeError(null);
                  }}
                >
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.button, 
                    styles.submitButton,
                    timeManipulationDetected && styles.disabledButton
                  ]}
                  onPress={handleAccessCodeSubmit}
                  disabled={timeManipulationDetected}
                >
                  <LinearGradient
                    colors={timeManipulationDetected ? ['#ccc', '#ccc'] : ['#02135eff', '#7979f1ff']}
                    style={styles.submitButtonGradient}
                  >
                    <Text style={styles.buttonText}>Submit</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Enhanced styles matching index.tsx design
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  
  // Loading State (matching index.tsx)
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
  },

  // Enhanced Header (matching index.tsx gradient)
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
  disabledHeader: {
    opacity: 0.7,
  },
  headerContent: {
    alignItems: 'center',
  },
  courseTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  courseCode: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 15,
  },
  instructorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  instructorText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    marginLeft: 8,
  },
  courseStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  statItem: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 15,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minWidth: 80,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  statLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
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
  timeManipulationWarning: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    padding: 20,
    marginTop: 15,
    alignItems: 'center',
  },
  warningText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  warningSubText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.9,
    lineHeight: 18,
    marginBottom: 4,
  },

  // Section Header
  sectionHeader: {
    backgroundColor: '#fff',
    paddingVertical: 15,
    paddingHorizontal: 20,
    marginTop: 10,
    marginHorizontal: 20,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },

  // Enhanced Cards (matching index.tsx)
  topicCard: {
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
  itemCard: {
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
    transition: 'all 0.3s ease-in-out',
  },
  highlightedCard: {
    borderColor: '#7979f1ff',
    borderWidth: 2.5,
    shadowColor: '#7979f1ff',
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 12,
    transform: [{ scale: 1.02 }],
  },
  highlightedCardNested: {
    borderColor: '#7979f1ff',
    borderWidth: 2,
    backgroundColor: '#f0f0ff',
    transform: [{ scale: 1.02 }],
    shadowColor: '#7979f1ff',
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 6,
  },
  disabledCard: {
    backgroundColor: '#f5f5f5',
    opacity: 0.7,
  },
  unavailableCard: {
    backgroundColor: '#f8f9fa',
    borderColor: '#dee2e6',
    borderWidth: 1,
  },

  // Item Headers and Content
  topicHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  nestedItemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  iconContainerSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  topicInfo: {
    flex: 1,
  },
  itemInfo: {
    flex: 1,
  },
  nestedItemInfo: {
    flex: 1,
  },
  topicTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  topicDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
  },
  itemTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  itemTitleNested: {
    fontSize: 16,
    fontWeight: '600',
    color: '#34495e',
    marginBottom: 2,
  },
  itemType: {
    fontSize: 14,
    color: '#7f8c8d',
    fontStyle: 'italic',
  },
  itemTypeNested: {
    fontSize: 13,
    color: '#6c7a89',
    fontStyle: 'italic',
  },
  itemDetail: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 12,
  },
  itemDetailNested: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
    marginBottom: 8,
  },

  // Badges and Status
  itemBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  availabilityBadge: {
    backgroundColor: '#e74c3c',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  availabilityText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  codeRequiredBadge: {
    backgroundColor: '#f39c12',
    borderRadius: 12,
    padding: 6,
  },

  // Footer and Dates
  itemFooter: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f3f4',
  },
  itemDate: {
    fontSize: 13,
    color: '#95a5a6',
  },
  itemDateNested: {
    fontSize: 12,
    color: '#95a5a6',
  },
  availableDateText: {
    fontSize: 12,
    color: '#e74c3c',
    fontWeight: '500',
  },
  additionalDateInfo: {
    marginTop: 4,
  },

  // Nested Items
  nestedItemsContainer: {
    marginTop: 15,
    paddingLeft: 15,
    borderLeftWidth: 3,
    borderLeftColor: '#e8f0fe',
  },
  itemCardNested: {
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 15,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    transition: 'all 0.3s ease-in-out',
  },

  sectionListContent: {
    paddingBottom: 30,
  },

  // Enhanced Modal (matching index.tsx style)
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  modalContent: {
    width: '90%',
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  modalHeader: {
    padding: 25,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 10,
  },
  modalBody: {
    padding: 25,
  },
  modalAssessmentTitle: {
    fontSize: 18,
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 15,
    fontWeight: '600',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  timeManipulationModalText: {
    fontSize: 14,
    color: '#e74c3c',
    marginBottom: 15,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 2,
    borderColor: '#e9ecef',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    marginBottom: 15,
    color: '#343a40',
  },
  disabledInput: {
    backgroundColor: '#f5f5f5',
    color: '#999',
    borderColor: '#e74c3c',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 15,
    marginTop: 10,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  submitButton: {
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  submitButtonGradient: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  cancelButton: {
    backgroundColor: '#6c757d',
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorTextModal: {
    color: '#e74c3c',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
    fontWeight: '500',
  },
});