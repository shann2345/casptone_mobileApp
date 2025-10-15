import { Ionicons } from '@expo/vector-icons';
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
            'Your 7-day offline access window has expired, or time manipulation was detected. You must connect to the internet to restore access.',
            [{ text: 'Understood' }]
          );
          setCourseDetail(null); 
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1967d2" />
          <Text style={styles.loadingText}>Loading course details...</Text>
        </View>
      </View>
    );
  }

  if (!courseDetail) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#5f6368" />
          <Text style={styles.errorText}>Course not found or an error occurred.</Text>
        </View>
      </View>
    );
  }

  const renderHeader = () => (
    <View>
      {/* LMS-Style Header */}
      <View style={[styles.headerContainer, timeManipulationDetected && styles.disabledHeader]}>
        <View style={styles.headerContent}>
          <Text style={styles.courseTitle}>{courseDetail?.title || 'Course Access Blocked'}</Text>
          <Text style={styles.courseCode}>{courseDetail?.course_code}</Text>
          
          {!timeManipulationDetected && courseDetail && (
            <>
              <View style={styles.instructorInfo}>
                <View style={styles.instructorAvatar}>
                  <Ionicons name="person-outline" size={16} color="#5f6368" />
                </View>
                <View style={styles.instructorDetails}>
                  <Text style={styles.instructorName}>{courseDetail.instructor.name}</Text>
                  <Text style={styles.instructorEmail}>{courseDetail.instructor.email}</Text>
                </View>
              </View>
              
              <View style={styles.courseMetaRow}>
                <View style={styles.metaItem}>
                  <Ionicons name="book-outline" size={16} color="#5f6368" />
                  <Text style={styles.metaText}>{courseDetail.credits} Credits</Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                  <Ionicons name="list-outline" size={16} color="#5f6368" />
                  <Text style={styles.metaText}>{courseDetail.sorted_content.length} Items</Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                  <View style={[styles.statusBadge, courseDetail.status === 'active' && styles.statusBadgeActive]}>
                    <Text style={[styles.statusText, courseDetail.status === 'active' && styles.statusTextActive]}>
                      {courseDetail.status}
                    </Text>
                  </View>
                </View>
              </View>
            </>
          )}
          
          {timeManipulationDetected && (
            <View style={styles.timeManipulationWarning}>
              <Ionicons name="warning-outline" size={32} color="#d93025" />
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
              <Ionicons name="cloud-offline-outline" size={16} color="#5f6368" />
              <Text style={styles.offlineText}>Working offline</Text>
            </View>
          )}
        </View>
      </View>
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
            <View style={styles.topicIconContainer}>
              <Ionicons name="folder-open-outline" size={20} color="#e37400" />
            </View>
            <View style={styles.topicInfo}>
              <Text style={styles.topicTitle}>{topic.title}</Text>
              {topic.description && (
                <Text style={styles.topicDescription}>{topic.description}</Text>
              )}
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
                      styles.nestedItemCard,
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
                    activeOpacity={0.7}
                  >
                    <View style={styles.nestedItemContent}>
                      <View style={styles.nestedItemLeft}>
                        <View style={styles.materialIcon}>
                          <Ionicons name="document-text-outline" size={16} color="#1967d2" />
                        </View>
                        <View style={styles.nestedItemTextContainer}>
                          <Text style={styles.nestedItemTitle}>{material.title}</Text>
                          <Text style={styles.nestedItemMeta}>
                            Material • {formatDate(material.created_at)}
                          </Text>
                        </View>
                      </View>
                      
                      <View style={styles.nestedItemRight}>
                        {!available && !timeManipulationDetected ? (
                          <View style={styles.lockedBadge}>
                            <Ionicons name="lock-closed" size={14} color="#5f6368" />
                          </View>
                        ) : (
                          <Ionicons name="chevron-forward" size={18} color="#dadce0" />
                        )}
                      </View>
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
                      styles.nestedItemCard,
                      !available && styles.unavailableCard,
                      timeManipulationDetected && styles.disabledCard,
                      isHighlighted && styles.highlightedCard,
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
                    activeOpacity={0.7}
                  >
                    <View style={styles.nestedItemContent}>
                      <View style={styles.nestedItemLeft}>
                        <View style={styles.assessmentIcon}>
                          <Ionicons name="school-outline" size={16} color="#d93025" />
                        </View>
                        <View style={styles.nestedItemTextContainer}>
                          <View style={styles.assessmentTitleRow}>
                            <Text style={styles.nestedItemTitle}>{assessment.title}</Text>
                            {assessment.access_code && (
                              <View style={styles.keyBadge}>
                                <Ionicons name="key-outline" size={10} color="#e37400" />
                              </View>
                            )}
                          </View>
                          <Text style={styles.nestedItemMeta}>
                            Assessment • {formatDate(assessment.created_at)}
                          </Text>
                        </View>
                      </View>
                      
                      <View style={styles.nestedItemRight}>
                        {!available && !timeManipulationDetected ? (
                          <View style={styles.lockedBadge}>
                            <Ionicons name="lock-closed" size={14} color="#5f6368" />
                          </View>
                        ) : (
                          <Ionicons name="chevron-forward" size={18} color="#dadce0" />
                        )}
                      </View>
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
          activeOpacity={0.7}
        >
          <View style={styles.itemContent}>
            <View style={styles.itemLeft}>
              <View style={styles.materialIconLarge}>
                <Ionicons name="document-text-outline" size={20} color="#1967d2" />
              </View>
              <View style={styles.itemTextContainer}>
                <Text style={styles.itemTitle}>{material.title}</Text>
                <Text style={styles.itemMeta}>
                  Material • {formatDate(material.created_at)}
                </Text>
                {material.content && (
                  <Text style={styles.itemPreview} numberOfLines={2}>
                    {material.content}
                  </Text>
                )}
              </View>
            </View>
            
            <View style={styles.itemRight}>
              {!available && !timeManipulationDetected ? (
                <View style={styles.lockedBadge}>
                  <Ionicons name="lock-closed" size={16} color="#5f6368" />
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={20} color="#dadce0" />
              )}
            </View>
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
          activeOpacity={0.7}
        >
          <View style={styles.itemContent}>
            <View style={styles.itemLeft}>
              <View style={styles.assessmentIconLarge}>
                <Ionicons name="school-outline" size={20} color="#d93025" />
              </View>
              <View style={styles.itemTextContainer}>
                <View style={styles.assessmentTitleRow}>
                  <Text style={styles.itemTitle}>{assessment.title}</Text>
                  {assessment.access_code && (
                    <View style={styles.keyBadge}>
                      <Ionicons name="key-outline" size={12} color="#e37400" />
                    </View>
                  )}
                </View>
                <Text style={styles.itemMeta}>
                  Assessment • {formatDate(assessment.created_at)}
                </Text>
              </View>
            </View>
            
            <View style={styles.itemRight}>
              {!available && !timeManipulationDetected ? (
                <View style={styles.lockedBadge}>
                  <Ionicons name="lock-closed" size={16} color="#5f6368" />
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={20} color="#dadce0" />
              )}
            </View>
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

      {/* LMS-Style Modal */}
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
            <View style={styles.modalHeader}>
              <View style={styles.modalIconContainer}>
                <Ionicons name="key-outline" size={24} color="#1967d2" />
              </View>
              <Text style={styles.modalTitle}>Access Code Required</Text>
              <TouchableOpacity 
                style={styles.modalCloseButton}
                onPress={() => {
                  setAccessCodeModalVisible(false);
                  setEnteredAccessCode('');
                  setAccessCodeError(null);
                }}
              >
                <Ionicons name="close" size={24} color="#5f6368" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              {currentAssessment && (
                <Text style={styles.modalAssessmentTitle}>
                  {currentAssessment.title}
                </Text>
              )}
              
              {timeManipulationDetected ? (
                <View style={styles.modalWarning}>
                  <Ionicons name="warning-outline" size={20} color="#d93025" />
                  <Text style={styles.timeManipulationModalText}>
                    Time synchronization required to access assessments.
                  </Text>
                </View>
              ) : (
                <Text style={styles.modalSubtitle}>
                  Please enter the access code to continue
                </Text>
              )}
              
              <TextInput
                style={[styles.input, timeManipulationDetected && styles.disabledInput]}
                placeholder="Enter access code"
                placeholderTextColor="#9aa0a6"
                value={enteredAccessCode}
                onChangeText={setEnteredAccessCode}
                secureTextEntry
                autoCapitalize="none"
                editable={!timeManipulationDetected}
              />
              
              {accessCodeError && (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle-outline" size={16} color="#d93025" />
                  <Text style={styles.errorTextModal}>{accessCodeError}</Text>
                </View>
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
                  <Text style={styles.cancelButtonText}>Cancel</Text>
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
                  <Text style={styles.submitButtonText}>Submit</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// LMS-Style design with proper spacing
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#5f6368',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#f8f9fa',
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    color: '#5f6368',
    textAlign: 'center',
  },
  headerContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerContent: {
    padding: 20,
  },
  courseTitle: {
    fontSize: 24,
    fontWeight: '500',
    color: '#202124',
    marginBottom: 4,
  },
  courseCode: {
    fontSize: 14,
    color: '#5f6368',
    marginBottom: 16,
  },
  instructorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  instructorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8eaed',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  instructorDetails: {
    flex: 1,
  },
  instructorName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#202124',
  },
  instructorEmail: {
    fontSize: 12,
    color: '#5f6368',
    marginTop: 2,
  },
  courseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 13,
    color: '#5f6368',
    marginLeft: 4,
  },
  metaDivider: {
    width: 1,
    height: 16,
    backgroundColor: '#dadce0',
    marginHorizontal: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#e8eaed',
  },
  statusBadgeActive: {
    backgroundColor: '#e6f4ea',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#5f6368',
    textTransform: 'capitalize',
  },
  statusTextActive: {
    color: '#137333',
  },
  timeManipulationWarning: {
    padding: 16,
    backgroundColor: '#fce8e6',
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  warningText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d93025',
    marginTop: 8,
    textAlign: 'center',
  },
  warningSubText: {
    fontSize: 13,
    color: '#5f6368',
    marginTop: 4,
    textAlign: 'center',
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f1f3f4',
    borderRadius: 16,
    marginTop: 8,
  },
  offlineText: {
    fontSize: 12,
    color: '#5f6368',
    marginLeft: 6,
    fontWeight: '500',
  },
  disabledHeader: {
    opacity: 0.6,
  },
  sectionListContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5f6368',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  topicCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  topicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  topicIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fef7e0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  topicInfo: {
    flex: 1,
  },
  topicTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#202124',
  },
  topicDescription: {
    fontSize: 13,
    color: '#5f6368',
    marginTop: 4,
  },
  nestedItemsContainer: {
    backgroundColor: '#fafafa',
  },
  nestedItemCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e8eaed',
  },
  nestedItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  nestedItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  nestedItemTextContainer: {
    flex: 1,
  },
  nestedItemTitle: {
    fontSize: 14,
    fontWeight: '400',
    color: '#202124',
  },
  nestedItemMeta: {
    fontSize: 12,
    color: '#5f6368',
    marginTop: 2,
  },
  nestedItemRight: {
    marginLeft: 12,
  },
  materialIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e8f0fe',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  assessmentIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fce8e6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  assessmentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  keyBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fef7e0',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  lockedBadge: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#f1f3f4',
  },
  itemCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  itemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  itemTextContainer: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '400',
    color: '#202124',
  },
  itemMeta: {
    fontSize: 13,
    color: '#5f6368',
    marginTop: 4,
  },
  itemPreview: {
    fontSize: 13,
    color: '#80868b',
    marginTop: 8,
    lineHeight: 18,
  },
  itemRight: {
    marginLeft: 16,
  },
  materialIconLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e8f0fe',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  assessmentIconLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fce8e6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  unavailableCard: {
    opacity: 0.6,
  },
  disabledCard: {
    opacity: 0.4,
  },
  highlightedCard: {
    borderColor: '#1967d2',
    borderWidth: 2,
    backgroundColor: '#e8f0fe',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8f0fe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
    color: '#202124',
    marginLeft: 12,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalBody: {
    padding: 20,
  },
  modalAssessmentTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#202124',
    marginBottom: 12,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#5f6368',
    marginBottom: 20,
  },
  modalWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fce8e6',
    borderRadius: 8,
    marginBottom: 16,
  },
  timeManipulationModalText: {
    flex: 1,
    fontSize: 13,
    color: '#d93025',
    marginLeft: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#202124',
    backgroundColor: '#fff',
  },
  disabledInput: {
    backgroundColor: '#f1f3f4',
    color: '#9aa0a6',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 8,
  },
  errorTextModal: {
    flex: 1,
    fontSize: 13,
    color: '#d93025',
    marginLeft: 6,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f8f9fa',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#5f6368',
  },
  submitButton: {
    backgroundColor: '#1967d2',
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  disabledButton: {
    backgroundColor: '#e8eaed',
  },
});