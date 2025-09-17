import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNetworkStatus } from '../../context/NetworkContext';
import { getUserData } from '../../lib/api';
import { getCompletedOfflineQuizzes, getDb, getOfflineAttemptCount, getUnsyncedSubmissions, initDb } from '../../lib/localDb';
import { showOfflineModeWarningIfNeeded } from '../../lib/offlineWarning';

const { width, height } = Dimensions.get('window');

interface TodoItem {
  id: string;
  title: string;
  course_name: string;
  type: 'assignment' | 'quiz' | 'exam' | 'project' | 'activity';
  due_date?: string;
  status: 'unfinished' | 'missing' | 'to_sync' | 'done';
  points?: number;
  description?: string;
  course_id: number;
  assessment_id: number; // Add this for proper navigation
  submitted_at?: string;
  late?: boolean;
}

const TODO_CATEGORIES = [
  { 
    key: 'unfinished', 
    title: 'Assigned', 
    icon: 'document-text', 
    color: '#1a73e8',
    bgColor: '#e8f0fe',
    description: 'Work to do'
  },
  { 
    key: 'missing', 
    title: 'Missing', 
    icon: 'alert-circle', 
    color: '#d93025',
    bgColor: '#fce8e6',
    description: 'Overdue work'
  },
  { 
    key: 'to_sync', 
    title: 'To sync', 
    icon: 'sync', 
    color: '#f9ab00',
    bgColor: '#fef7e0',
    description: 'Ready to submit'
  },
  { 
    key: 'done', 
    title: 'Done', 
    icon: 'checkmark-circle', 
    color: '#137333',
    bgColor: '#e6f4ea',
    description: 'Completed work'
  },
];

export default function TodoScreen() {
  const router = useRouter();
  const { isConnected, netInfo } = useNetworkStatus();
  const [selectedCategory, setSelectedCategory] = useState<string>('unfinished');
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [categoryCounts, setCategoryCounts] = useState({
    unfinished: 0,
    missing: 0,
    to_sync: 0,
    done: 0,
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    loadTodoItems();
    
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [selectedCategory]);

  useEffect(() => {
      const checkOfflineWarning = async () => {
        if (!isConnected) {
          await showOfflineModeWarningIfNeeded();
        }
      };
      
      checkOfflineWarning();
    }, [isConnected]);

  const loadTodoItems = async (forceRefresh = false) => {
    try {
      setIsLoading(true);
      await initDb();
      
      const userData = await getUserData();
      if (!userData?.email) {
        Alert.alert('Error', 'User data not found. Please log in again.');
        return;
      }

      if (forceRefresh) {
        console.log('🔄 Force refreshing todo items...');
      }

      const allItems = await getAllTodoItems(userData.email, forceRefresh);
      const filteredItems = allItems.filter(item => item.status === selectedCategory);
      setTodoItems(filteredItems);

      const counts = {
        unfinished: allItems.filter(item => item.status === 'unfinished').length,
        missing: allItems.filter(item => item.status === 'missing').length,
        to_sync: allItems.filter(item => item.status === 'to_sync').length,
        done: allItems.filter(item => item.status === 'done').length,
      };
      setCategoryCounts(counts);

      console.log('✅ Todo items refreshed:', {
        total: allItems.length,
        filtered: filteredItems.length,
        counts
      });

    } catch (error) {
      console.error('❌ Error loading todo items:', error);
      Alert.alert('Error', 'Failed to load assignments. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getAllTodoItems = async (userEmail: string, forceRefresh = false): Promise<TodoItem[]> => {
  const db = await getDb();
  const items: TodoItem[] = [];

  try {
    if (forceRefresh) {
      console.log('🔄 Force refreshing database queries...');
    }

    const allAssessments = await db.getAllAsync(`
      SELECT a.*, c.title as course_name 
      FROM offline_assessments a
      LEFT JOIN offline_courses c ON a.course_id = c.id AND a.user_email = c.user_email
      WHERE a.user_email = ?
      ORDER BY a.unavailable_at ASC
    `, [userEmail]);

    console.log('📋 Found total assessments:', allAssessments.length);

    const unsyncedSubmissions = await getUnsyncedSubmissions(userEmail);
    const unsyncedAssessmentIds = new Set(unsyncedSubmissions.map(sub => sub.assessment_id));

    const completedOfflineQuizzes = await getCompletedOfflineQuizzes(userEmail);
    const unsyncedQuizIds = new Set(completedOfflineQuizzes.map(quiz => quiz.assessment_id));

    console.log('📤 Unsynced submissions:', unsyncedSubmissions.length);
    console.log('📤 Unsynced quiz IDs:', Array.from(unsyncedQuizIds));

    for (const assessment of allAssessments) {
      const now = new Date();
      const isOverdue = assessment.unavailable_at && new Date(assessment.unavailable_at) < now;
      
      // FIXED: Get assessment data from offline_assessment_data table (updated after sync)
      const assessmentData = await db.getFirstAsync(`
        SELECT data FROM offline_assessment_data 
        WHERE assessment_id = ? AND user_email = ?
      `, [assessment.id, userEmail]);

      let hasServerSubmission = false;
      let hasServerAttempts = false;
      let attemptCount = 0;
      let serverSubmissionTime = undefined;
      let serverAttemptTime = undefined;

      // FIXED: Enhanced submission detection for assignment types
      if (assessmentData?.data) {
        const data = JSON.parse(assessmentData.data);
        
        console.log(`🔍 Assessment ${assessment.id} (${assessment.title}) data:`, {
          type: assessment.type,
          hasLatestSubmission: !!data.latestSubmission,
          hasFile: data.latestSubmission?.has_submitted_file,
          submissionStatus: data.latestSubmission?.status,
          fileName: data.latestSubmission?.submitted_file_name,
          submittedAt: data.latestSubmission?.submitted_at
        });
        
        // FIXED: Better detection for assignment-type submissions
        if (data.latestSubmission) {
          // Check if there's a submitted file (for assignments/projects/activities)
          if (data.latestSubmission.has_submitted_file === true) {
            hasServerSubmission = true;
            serverSubmissionTime = data.latestSubmission.submitted_at;
            console.log(`✅ Assessment ${assessment.id} has server submission - File submitted`);
          }
          // FIXED: Also check for status indicating submission even without file flag
          else if (data.latestSubmission.submitted_at && 
                   data.latestSubmission.status !== 'pending' && 
                   data.latestSubmission.status !== 'to sync') {
            hasServerSubmission = true;
            serverSubmissionTime = data.latestSubmission.submitted_at;
            console.log(`✅ Assessment ${assessment.id} has server submission - Status: ${data.latestSubmission.status}`);
          }
        }
        
        // For quiz/exam types
        if (data.attemptStatus?.has_attempts || data.attemptStatus?.attempts_made > 0) {
          hasServerAttempts = true;
          attemptCount = data.attemptStatus.attempts_made || 0;
          serverAttemptTime = data.attemptStatus.last_attempt_at;
          console.log(`✅ Assessment ${assessment.id} has server attempts: ${attemptCount}`);
        }
      } else {
        console.log(`⚠️ No assessment data found for ${assessment.id}`);
      }

      let hasOfflineAttempts = false;
      if (['quiz', 'exam'].includes(assessment.type)) {
        const offlineAttemptData = await getOfflineAttemptCount(assessment.id, userEmail);
        if (offlineAttemptData.attempts_made > 0) {
          hasOfflineAttempts = true;
          attemptCount = Math.max(attemptCount, offlineAttemptData.attempts_made);
        }
      }

      // FIXED: Improved categorization logic with correct priority handling
      let status: 'unfinished' | 'missing' | 'to_sync' | 'done' = 'unfinished';
      let submittedAt: string | undefined = undefined;
      
      console.log(`🎯 Categorizing ${assessment.title} (${assessment.type}):`, {
        isInUnsyncedSubmissions: unsyncedAssessmentIds.has(assessment.id),
        isInUnsyncedQuizzes: unsyncedQuizIds.has(assessment.id),
        hasServerSubmission,
        hasServerAttempts,
        hasOfflineAttempts,
        isOverdue
      });
      
      // Priority 1: TO_SYNC - Check if it has unsynced data (highest priority)
      if (unsyncedAssessmentIds.has(assessment.id) || unsyncedQuizIds.has(assessment.id)) {
        status = 'to_sync';
        console.log(`📤 Assessment ${assessment.id} marked as TO_SYNC`);
        
        if (unsyncedAssessmentIds.has(assessment.id)) {
          const submission = unsyncedSubmissions.find(sub => sub.assessment_id === assessment.id);
          submittedAt = submission?.submitted_at;
        } else if (unsyncedQuizIds.has(assessment.id)) {
          const quiz = completedOfflineQuizzes.find(quiz => quiz.assessment_id === assessment.id);
          submittedAt = quiz?.end_time;
        }
      }
      // Priority 2: DONE - Check if it's completed/submitted (after sync check)
      else if (
        ((['assignment', 'project', 'activity'].includes(assessment.type)) && hasServerSubmission) ||
        ((['quiz', 'exam'].includes(assessment.type)) && (hasServerAttempts || hasOfflineAttempts))
      ) {
        status = 'done';
        submittedAt = serverSubmissionTime || serverAttemptTime;
        console.log(`✅ Assessment ${assessment.id} marked as DONE:`, {
          type: assessment.type,
          hasServerSubmission,
          hasServerAttempts,
          hasOfflineAttempts,
          submittedAt
        });
      }
      // Priority 3: MISSING - Check if it's overdue without any submission/attempts
      else if (isOverdue && !hasServerSubmission && !hasServerAttempts && !hasOfflineAttempts) {
        status = 'missing';
        console.log(`❌ Assessment ${assessment.id} marked as MISSING (overdue without submission)`);
      }
      // Priority 4: ASSIGNED - Everything else
      else {
        status = 'unfinished';
        console.log(`📝 Assessment ${assessment.id} marked as ASSIGNED:`, {
          type: assessment.type,
          hasServerSubmission,
          hasServerAttempts,
          hasOfflineAttempts,
          attemptCount,
          isOverdue
        });
      }

      const todoItem: TodoItem = {
        id: `${status}_${assessment.id}`,
        title: assessment.title,
        course_name: assessment.course_name || 'Unknown Course',
        type: assessment.type,
        due_date: assessment.unavailable_at,
        status: status,
        points: assessment.points,
        description: assessment.description,
        course_id: assessment.course_id,
        assessment_id: assessment.id,
        late: isOverdue && (status === 'missing' || status === 'unfinished'),
        submitted_at: submittedAt,
      };

      items.push(todoItem);
    }

    const categoryStats = {
      unfinished: items.filter(item => item.status === 'unfinished').length,
      missing: items.filter(item => item.status === 'missing').length,
      to_sync: items.filter(item => item.status === 'to_sync').length,
      done: items.filter(item => item.status === 'done').length,
    };
    console.log('📊 Final category distribution:', categoryStats);

    // FIXED: Enhanced debugging with detailed breakdown
    console.log('📋 Detailed categorization results:');
    items.forEach(item => {
      console.log(`  - ${item.title} (${item.type}): ${item.status} ${item.submitted_at ? `[${item.submitted_at}]` : ''}`);
    });

  } catch (error) {
    console.error('❌ Error fetching todo items:', error);
  }

  console.log('📊 Total items found:', items.length);
  return items;
};


  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadTodoItems(true);
    setIsRefreshing(false);
  };

  const handleManualRefresh = async () => {
    setIsLoading(true);
    await loadTodoItems(true);
    setIsLoading(false);
  };

  // FIXED: Updated navigation to follow proper course hierarchy
  const handleItemPress = (item: TodoItem) => {
    console.log('Navigating to assessment via course hierarchy:', {
      courseId: item.course_id,
      assessmentId: item.assessment_id,
      title: item.title,
      courseName: item.course_name
    });

    // Step 1: Navigate to the courses tab first
    // This ensures the courses navigation stack is properly set up
    router.push('/courses');

    // Step 2: After a brief delay, navigate to the specific course
    // This allows the courses tab to load first
    setTimeout(() => {
      router.push(`/courses/${item.course_id}`);
      
      // Step 3: After another brief delay, navigate to the assessment
      // FIXED: Use the correct assessment path structure
      setTimeout(() => {
        router.push({
          pathname: '/courses/assessments/[assessmentId]',
          params: {
            id: item.course_id.toString(),
            assessmentId: item.assessment_id.toString(),
          },
        });
      }, 100);
    }, 100);
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'No due date';
    
    try {
      const date = new Date(dateString);
      const now = new Date();
      
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      
      const diffTime = date.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        return `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`;
      } else if (diffDays === 0) {
        return 'Due today';
      } else if (diffDays === 1) {
        return 'Due tomorrow';
      } else {
        return `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
      }
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Date unavailable';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'quiz': return 'help-circle';
      case 'exam': return 'school';
      case 'assignment': return 'document-text';
      case 'project': return 'folder';
      case 'activity': return 'play-circle';
      default: return 'document';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'quiz': return '#8e24aa';
      case 'exam': return '#d32f2f';
      case 'assignment': return '#1976d2';
      case 'project': return '#388e3c';
      case 'activity': return '#f57c00';
      default: return '#616161';
    }
  };

  const selectedCategoryData = TODO_CATEGORIES.find(cat => cat.key === selectedCategory);

  const renderTodoItem = ({ item, index }: { item: TodoItem; index: number }) => (
    <Animated.View
      style={[
        styles.todoItemWrapper,
        {
          opacity: fadeAnim,
          transform: [
            {
              translateY: slideAnim.interpolate({
                inputRange: [0, 30],
                outputRange: [0, 30],
              }),
            },
          ],
        },
      ]}
    >
      <TouchableOpacity 
        style={[
          styles.todoItem,
          { borderLeftColor: selectedCategoryData?.color || '#666' }
        ]} 
        onPress={() => handleItemPress(item)}
        activeOpacity={0.8}
      >
        <View style={styles.todoItemContent}>
          <View style={styles.todoItemHeader}>
            <View style={styles.todoItemLeft}>
              <View style={[
                styles.typeIconContainer,
                { backgroundColor: getTypeColor(item.type) + '15' }
              ]}>
                <Ionicons 
                  name={getTypeIcon(item.type)} 
                  size={18} 
                  color={getTypeColor(item.type)} 
                />
              </View>
              <View style={styles.todoItemInfo}>
                <Text style={styles.todoItemTitle} numberOfLines={2}>
                  {item.title || 'Untitled'}
                </Text>
                <Text style={styles.todoItemCourse}>
                  {item.course_name || 'Unknown Course'}
                </Text>
              </View>
            </View>
            
            <View style={styles.todoItemRight}>
              {item.points ? (
                <View style={[
                  styles.pointsBadge,
                  { backgroundColor: selectedCategoryData?.bgColor || '#f5f5f5' }
                ]}>
                  <Text style={[
                    styles.pointsText,
                    { color: selectedCategoryData?.color || '#666' }
                  ]}>
                    {item.points} pts
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {item.description ? (
            <Text style={styles.todoItemDescription} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}

          <View style={styles.todoItemFooter}>
            <View style={styles.statusContainer}>
              <View style={[
                styles.statusDot,
                { backgroundColor: selectedCategoryData?.color || '#666' }
              ]} />
              <Text style={[
                styles.statusText,
                item.late && { color: '#d93025' },
                { color: selectedCategoryData?.color || '#666' }
              ]}>
                {item.status === 'to_sync' && item.submitted_at 
                  ? `Submitted ${new Date(item.submitted_at).toLocaleDateString()}`
                  : item.status === 'done' && item.submitted_at
                    ? `Completed ${new Date(item.submitted_at).toLocaleDateString()}`
                    : formatDate(item.due_date)
                }
              </Text>
            </View>
            
            <View style={styles.todoItemActions}>
              {item.late && (
                <View style={styles.lateBadge}>
                  <Text style={styles.lateText}>LATE</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color="#9aa0a6" />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  const renderEmptyState = () => {
    const content = {
      unfinished: {
        title: 'All caught up!',
        subtitle: 'You have no pending assignments or quizzes with attempts.',
        icon: 'checkmark-done-circle'
      },
      missing: {
        title: 'No missing work',
        subtitle: 'Great job staying on top of your deadlines!',
        icon: 'happy'
      },
      to_sync: {
        title: 'Nothing to sync',
        subtitle: 'All your offline work has been synced with the server.',
        icon: 'cloud-done'
      },
      done: {
        title: 'No completed work yet',
        subtitle: 'Completed and submitted assignments will appear here.',
        icon: 'trophy'
      }
    }[selectedCategory] || {
      title: 'No items found',
      subtitle: 'Nothing to show in this category.',
      icon: 'document'
    };

    return (
      <Animated.View 
        style={[
          styles.emptyState,
          { backgroundColor: selectedCategoryData?.bgColor || '#f5f5f5' }
        ]}
      >
        <View style={[
          styles.emptyStateIconContainer,
          { backgroundColor: selectedCategoryData?.color || '#666' }
        ]}>
          <Ionicons 
            name={content.icon} 
            size={32} 
            color="#fff" 
          />
        </View>
        <Text style={styles.emptyStateTitle}>
          {content.title}
        </Text>
        <Text style={styles.emptyStateSubtitle}>
          {content.subtitle}
        </Text>
      </Animated.View>
    );
  };

  // FIXED: Enhanced sync detection and auto-refresh
  useEffect(() => {
    const checkForSyncUpdates = async () => {
      if (isConnected) {
        console.log('🌐 Network is online. Checking for sync updates...');
        const user = await getUserData();
        if (!user || !user.email) return;

        // Check for unsynced submissions
        const unsyncedSubmissions = await getUnsyncedSubmissions(user.email);
        if (unsyncedSubmissions.length > 0) {
          console.log(`📤 Found ${unsyncedSubmissions.length} submissions waiting to sync`);
        }
        
        // Always refresh to catch any updates from assessment screen
        setTimeout(async () => {
          console.log('🔄 Auto-refreshing todo items to catch sync updates...');
          await loadTodoItems(true);
        }, 1500); // Slightly shorter delay
      }
    };

    checkForSyncUpdates();
  }, [isConnected]);

  useFocusEffect(
    useCallback(() => {
      console.log('👁️ Todo screen focused, force refreshing data...');
      // Always force refresh when returning to this screen
      // This catches all updates from the assessment details screen
      setTimeout(() => {
        loadTodoItems(true);
      }, 200); // Small delay to ensure smooth transition
    }, [])
  );

  useEffect(() => {
    if (selectedCategory) {
      console.log(`🏷️ Category changed to: ${selectedCategory}, refreshing...`);
      // Small delay refresh when switching categories
      setTimeout(() => {
        loadTodoItems(true);
      }, 100);
    }
  }, [selectedCategory]);

  return (
    <View style={styles.container}>
      {/* Modern Header */}
      <View style={styles.headerContainer}>
        <LinearGradient 
          colors={['#02135eff', '#7979f1ff']} 
          style={styles.header}
        >
          <View style={styles.headerContent}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>To-do</Text>
              <Text style={styles.headerSubtitle}>
                {categoryCounts.unfinished + categoryCounts.missing + categoryCounts.to_sync} items need attention
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.refreshButton} 
              onPress={handleManualRefresh}
              disabled={isLoading}
            >
              <Ionicons 
                name="refresh" 
                size={20} 
                color="#5f6368" 
                style={[isLoading && { opacity: 0.5 }]}
              />
            </TouchableOpacity>
          </View>
          
          {!isConnected && (
            <View style={styles.offlineNotice}>
              <Ionicons name="cloud-offline" size={14} color="#d93025" />
              <Text style={styles.offlineText}>Working offline</Text>
            </View>
          )}
        </LinearGradient>
      </View>

      {/* Tab-style Category Navigation */}
      <View style={styles.tabsContainer}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={styles.tabsContent}
        >
          {TODO_CATEGORIES.map((category) => (
            <TouchableOpacity
              key={category.key}
              style={[
                styles.tab,
                selectedCategory === category.key && styles.tabActive
              ]}
              onPress={() => setSelectedCategory(category.key)}
              activeOpacity={0.7}
            >
              <View style={styles.tabContent}>
                <Ionicons 
                  name={category.icon} 
                  size={16} 
                  color={selectedCategory === category.key ? category.color : '#5f6368'}
                  style={styles.tabIcon}
                />
                <Text style={[
                  styles.tabText,
                  selectedCategory === category.key && { 
                    color: category.color, 
                    fontWeight: '600' 
                  }
                ]}>
                  {category.title}
                </Text>
                {categoryCounts[category.key] > 0 && (
                  <View style={[
                    styles.tabBadge, 
                    { backgroundColor: category.color }
                  ]}>
                    <Text style={styles.tabBadgeText}>
                      {categoryCounts[category.key]}
                    </Text>
                  </View>
                )}
              </View>
              {selectedCategory === category.key && (
                <View style={[
                  styles.tabIndicator,
                  { backgroundColor: category.color }
                ]} />
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Content with enhanced styling */}
      <View style={[
        styles.content,
        { backgroundColor: selectedCategoryData?.bgColor + '40' || '#f8f9fa' }
      ]}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={selectedCategoryData?.color || '#1a73e8'} />
            <Text style={[
              styles.loadingText,
              { color: selectedCategoryData?.color || '#5f6368' }
            ]}>
              Loading assignments...
            </Text>
          </View>
        ) : (
          <FlatList
            data={todoItems}
            keyExtractor={(item) => item.id}
            renderItem={renderTodoItem}
            ListEmptyComponent={renderEmptyState}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={selectedCategoryData?.color || '#1a73e8'}
                colors={[selectedCategoryData?.color || '#1a73e8']}
              />
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  headerContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  header: {
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
  },
  refreshButton: {
    padding: 12,
    borderRadius: 24,
    backgroundColor: '#f1f3f4',
    marginLeft: 16,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#ffffffff',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#efededff',
    fontWeight: '400',
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fce8e6',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  offlineText: {
    color: '#d93025',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
  
  // Tab-style category styles
  tabsContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8eaed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  tabsContent: {
    paddingHorizontal: 20,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 8,
    position: 'relative',
  },
  tabActive: {
    // Active tab styling handled by indicator
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabIcon: {
    marginRight: 6,
  },
  tabText: {
    fontSize: 14,
    color: '#5f6368',
    fontWeight: '500',
  },
  tabBadge: {
    marginLeft: 6,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  tabBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 3,
    borderRadius: 1.5,
  },

  content: {
    flex: 1,
    paddingTop: 8,
  },
  listContent: {
    padding: 24,
  },
  todoItemWrapper: {
    marginBottom: 8,
  },
  todoItem: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 0,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  todoItemContent: {
    padding: 16,
  },
  todoItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  todoItemLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  typeIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  todoItemInfo: {
    flex: 1,
  },
  todoItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
    lineHeight: 22,
    marginBottom: 2,
  },
  todoItemCourse: {
    fontSize: 13,
    color: '#5f6368',
    fontWeight: '500',
  },
  todoItemRight: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  pointsBadge: {
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pointsText: {
    fontSize: 12,
    fontWeight: '600',
  },
  todoItemDescription: {
    fontSize: 14,
    color: '#5f6368',
    lineHeight: 20,
    marginBottom: 12,
    marginLeft: 48,
  },
  todoItemFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f3f4',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  todoItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lateBadge: {
    backgroundColor: '#d93025',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginRight: 8,
  },
  lateText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    marginHorizontal: 24,
    borderRadius: 16,
  },
  emptyStateIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#5f6368',
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
});