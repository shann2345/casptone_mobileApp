// [REPLACE] to-do.tsx with this
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNetworkStatus } from '../../context/NetworkContext';
import api, { getUserData, manualSync } from '../../lib/api';
// [MODIFIED] Import the new function
import {
  forceRefreshAllAssessmentStatuses // <-- ADDED
  ,
  getCompletedOfflineQuizzes,
  getDb,
  getOfflineAttemptCount,
  getUnsyncedSubmissions,
  initDb,
  syncAllAssessmentDetails
} from '../../lib/localDb';

const { width } = Dimensions.get('window');

// ... (Interface, Constants, and other imports remain the same)
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
  assessment_id: number;
  submitted_at?: string;
  late?: boolean;
}

const TODO_CATEGORIES = [
  // ... (This array remains unchanged)
  { 
    key: 'unfinished', 
    title: 'Assigned', 
    icon: 'document-text-outline', 
    color: '#1967d2',
    bgColor: '#e8f0fe',
    description: 'Work to do'
  },
  { 
    key: 'missing', 
    title: 'Missing', 
    icon: 'alert-circle-outline', 
    color: '#d93025',
    bgColor: '#fce8e6',
    description: 'Overdue work'
  },
  { 
    key: 'to_sync', 
    title: 'To sync', 
    icon: 'cloud-upload-outline', 
    color: '#e37400',
    bgColor: '#fef7e0',
    description: 'Ready to submit'
  },
  { 
    key: 'done', 
    title: 'Done', 
    icon: 'checkmark-circle-outline', 
    color: '#137333',
    bgColor: '#e6f4ea',
    description: 'Completed work'
  },
];


export default function TodoScreen() {
  const router = useRouter();
  const { isConnected, netInfo } = useNetworkStatus();
  const [selectedCategory, setSelectedCategory] = useState<string>('unfinished');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [allTodoItems, setAllTodoItems] = useState<TodoItem[]>([]); 
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]); 
  const [sortOption, setSortOption] = useState<'dueDate' | 'submissionDate'>('dueDate');
  const [isUpdating, setIsUpdating] = useState(false);

  const [categoryCounts, setCategoryCounts] = useState({
    unfinished: 0,
    missing: 0,
    to_sync: 0,
    done: 0,
  });

  const { hasPendingSync, manualCheck } = usePendingSyncNotification(
    netInfo?.isInternetReachable ?? null,
    'to-do'
  );

  useEffect(() => {
    loadTodoItems();
  }, []);
  
  useEffect(() => {
    // ... (This sorting useEffect remains unchanged)
    const filtered = allTodoItems.filter(item => item.status === selectedCategory);
  
    const sorted = [...filtered].sort((a, b) => {
      const getDate = (dateStr: string | undefined) => dateStr ? new Date(dateStr).getTime() : 0;
  
      if (sortOption === 'submissionDate') {
        const dateA = getDate(a.submitted_at) || getDate(a.due_date);
        const dateB = getDate(b.submitted_at) || getDate(b.due_date);
        return dateB - dateA; // Most recent date first
      } else { 
        const dateA = getDate(a.due_date) || getDate(a.submitted_at);
        const dateB = getDate(b.due_date) || getDate(b.submitted_at);
        if (dateA === 0) return 1;
        if (dateB === 0) return -1;
        return dateA - dateB; // Closest date first
      }
    });
  
    setTodoItems(sorted);
  }, [allTodoItems, selectedCategory, sortOption]);
  
  const loadTodoItems = async (forceRefresh = false) => {
    // ... (This function remains unchanged)
    try {
      if (!isRefreshing && !isSyncing) setIsLoading(true); // Don't show loading indicator if we are syncing
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
      setAllTodoItems(allItems); 

      const counts = {
        unfinished: allItems.filter(item => item.status === 'unfinished').length,
        missing: allItems.filter(item => item.status === 'missing').length,
        to_sync: allItems.filter(item => item.status === 'to_sync').length,
        done: allItems.filter(item => item.status === 'done').length,
      };
      setCategoryCounts(counts);

    } catch (error) {
      console.error('❌ Error loading todo items:', error);
      Alert.alert('Error', 'Failed to load assignments. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // [MODIFIED] This function is now the "Smart Refresh"
  // It handles both pull-to-refresh (smart) and button-click (force-refresh)
  const runSmartRefresh = async (isManualUpdate = false) => {
    if (isRefreshing || isSyncing || isUpdating) return;

    if (isManualUpdate) {
      setIsUpdating(true);
    } else {
      setIsRefreshing(true);
    }

    const userData = await getUserData();
    if (!userData?.email) {
      Alert.alert('Error', 'User data not found.');
      setIsRefreshing(false);
      setIsUpdating(false);
      return;
    }

    if (isConnected) {
      console.log(`🔄 [To-Do] Running ${isManualUpdate ? 'Manual Update (Force-Refresh)' : 'Smart Refresh (Pull-to-Refresh)'}...`);
      try {
        // Step 1: Run manualSync FIRST to submit any pending work
        console.log('🔄 [To-Do] Step 1: Syncing pending work...');
        const syncResult = await manualSync();
        if (syncResult.success > 0) {
          console.log(`✅ [To-Do] Submitted ${syncResult.success} pending items.`);
        }
        
        // Step 2: Download fresh data from server
        console.log('🔄 [To-Do] Step 2: Downloading fresh data from server...');
        
        let totalUpdated = 0;

        if (isManualUpdate) {
          // --- THIS IS YOUR REQUESTED FIX ---
          // Manual "Update" button = Force-refresh *everything*
          console.log('... (Manual Update) Force-refreshing all assessment statuses...');
          const result = await forceRefreshAllAssessmentStatuses(
            userData.email,
            api,
            (current, total) => {
              console.log(`[To-Do Update] Force Refresh: ${current}/${total}`);
            }
          );
          totalUpdated = result.success;
        } else {
          // --- THIS IS THE NORMAL PULL-TO-REFRESH ---
          // Pull-to-refresh = Smart, fast sync (respects cooldowns)
          console.log('... (Pull-to-Refresh) Smart-syncing stale assessments...');
          const result = await syncAllAssessmentDetails(
            userData.email,
            api,
            (current, total, type) => {
              console.log(`[To-Do Refresh] ${type}: ${current}/${total}`);
            }
          );
          totalUpdated = result.success + result.updated;
        }
        
        console.log(`✅ [To-Do] Downloaded/Refreshed ${totalUpdated} records.`);

        // Show success message for manual updates
        if (isManualUpdate) {
          Alert.alert(
            'Update Complete',
            `Successfully refreshed the status for ${totalUpdated} assessment${totalUpdated !== 1 ? 's' : ''}.`,
            [{ text: 'OK' }]
          );
        }

      } catch (syncError) {
        console.error('❌ [To-Do] Smart Refresh failed:', syncError);
        Alert.alert(
          'Update Error', 
          'Could not fully sync with the server. Please check your connection and try again.'
        );
      }
    } else {
      console.log('📡 [To-Do] Offline. Cannot update.');
      if (isManualUpdate) {
        Alert.alert('Offline', 'You must be online to update. Please connect and try again.');
      }
    }
    
    // Step 3 (WAS 4): Always reload the list from DB (with fresh data)
    console.log('🔄 [To-Do] Step 3: Reloading list from local database...');
    await loadTodoItems(false);
    
    setIsRefreshing(false);
    setIsUpdating(false);
    console.log(`✅ [To-Do] ${isManualUpdate ? 'Manual Update' : 'Smart Refresh'} finished.`);
  };

  // Update these handler functions
  const handleRefresh = async () => {
    await runSmartRefresh(false); // Pull-to-refresh (Smart)
  };

  const handleManualUpdate = async () => {
    await runSmartRefresh(true); // Manual button click (Force-Refresh)
  };

  const getAllTodoItems = async (userEmail: string, forceRefresh = false): Promise<TodoItem[]> => {
    // ... (This function remains unchanged)
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

      const unsyncedSubmissions = await getUnsyncedSubmissions(userEmail);
      const unsyncedAssessmentIds = new Set(unsyncedSubmissions.map(sub => sub.assessment_id));

      const completedOfflineQuizzes = await getCompletedOfflineQuizzes(userEmail);
      const unsyncedQuizIds = new Set(completedOfflineQuizzes.map(quiz => quiz.assessment_id));

      for (const assessment of allAssessments) {
        const now = new Date();
        const isOverdue = assessment.unavailable_at && new Date(assessment.unavailable_at) < now;
        
        const assessmentData = await db.getFirstAsync(`
          SELECT data FROM offline_assessment_data 
          WHERE assessment_id = ? AND user_email = ?
        `, [assessment.id, userEmail]);

        let hasServerSubmission = false;
        let hasServerAttempts = false;
        let attemptCount = 0;
        let serverSubmissionTime = undefined;
        let serverAttemptTime = undefined;

        if (assessmentData?.data) {
          const data = JSON.parse(assessmentData.data);
          
          if (data.latestSubmission) {
            if (data.latestSubmission.has_submitted_file === true) {
              hasServerSubmission = true;
              serverSubmissionTime = data.latestSubmission.submitted_at;
            }
            else if (data.latestSubmission.submitted_at && 
                     data.latestSubmission.status !== 'pending' && 
                     data.latestSubmission.status !== 'to sync') {
              hasServerSubmission = true;
              serverSubmissionTime = data.latestSubmission.submitted_at;
            }
          }
          
          if (data.attemptStatus?.has_attempts || data.attemptStatus?.attempts_made > 0) {
            hasServerAttempts = true;
            attemptCount = data.attemptStatus.attempts_made || 0;
            serverAttemptTime = data.attemptStatus.last_attempt_at;
          }
        }

        let hasOfflineAttempts = false;
        if (['quiz', 'exam'].includes(assessment.type)) {
          const offlineAttemptData = await getOfflineAttemptCount(assessment.id, userEmail);
          if (offlineAttemptData.attempts_made > 0) {
            hasOfflineAttempts = true;
            attemptCount = Math.max(attemptCount, offlineAttemptData.attempts_made);
          }
        }

        let status: 'unfinished' | 'missing' | 'to_sync' | 'done' = 'unfinished';
        let submittedAt: string | undefined = undefined;
        
        if (unsyncedAssessmentIds.has(assessment.id) || unsyncedQuizIds.has(assessment.id)) {
          status = 'to_sync';
          
          if (unsyncedAssessmentIds.has(assessment.id)) {
            const submission = unsyncedSubmissions.find(sub => sub.assessment_id === assessment.id);
            submittedAt = submission?.submitted_at;
          } else if (unsyncedQuizIds.has(assessment.id)) {
            const quiz = completedOfflineQuizzes.find(quiz => quiz.assessment_id === assessment.id);
            submittedAt = quiz?.end_time;
          }
        }
        else if (
          ((['assignment', 'project', 'activity'].includes(assessment.type)) && hasServerSubmission) ||
          ((['quiz', 'exam'].includes(assessment.type)) && (hasServerAttempts || hasOfflineAttempts))
        ) {
          status = 'done';
          submittedAt = serverSubmissionTime || serverAttemptTime;
        }
        else if (isOverdue && !hasServerSubmission && !hasServerAttempts && !hasOfflineAttempts) {
          status = 'missing';
        }
        else {
          status = 'unfinished';
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
    } catch (error) {
      console.error('❌ Error fetching todo items:', error);
    }

    return items;
  };

  const runTargetedSync = async (isManualClick = false) => {
    // ... (This function remains unchanged)
    if (isSyncing) return;
    if (!isConnected) {
      if (isManualClick) {
        Alert.alert("Offline", "Please connect to the internet to sync your work.");
      }
      return;
    }
    if (categoryCounts.to_sync === 0) {
      if (isManualClick) {
        Alert.alert("All Synced", "Your work is already up to date.");
      }
      return;
    }
  
    console.log('🔄 [Targeted Sync] Starting high-priority sync...');
    setIsSyncing(true);
  
    try {
      const { success, failed } = await manualSync();
  
      if (success > 0 && failed === 0) {
        Alert.alert(
          'Work Submitted',
          `Successfully submitted ${success} item${success > 1 ? 's' : ''}.`
        );
      } else if (success > 0 && failed > 0) {
        Alert.alert(
          'Partial Sync',
          `Successfully submitted ${success} item${success > 1 ? 's' : ''}, but ${failed} failed. Please try again.`
        );
      } else if (failed > 0) {
        Alert.alert(
          'Sync Failed',
          `Could not sync ${failed} item${failed > 1 ? 's' : ''}. Please check your connection and try again.`
        );
      }
      
      await loadTodoItems(true);
  
    } catch (error) {
      console.error('❌ [Targeted Sync] Critical error:', error);
      Alert.alert('Error', 'An unexpected error occurred during sync.');
    } finally {
      console.log('✅ [Targeted Sync] Sync finished.');
      setIsSyncing(false);
    }
  };

  const showToSyncTip = () => {
    // ... (This function remains unchanged)
     Alert.alert(
      'Syncing Tip',
      'If your submitted work remains in the "To sync" tab for a long time after reconnecting to the internet, please try **restarting the app** to initiate a manual sync.',
      [{ text: 'Got it' }]
    );
  };

  const handleCategoryPress = (categoryKey: string) => {
    // ... (This function remains unchanged)
    if (categoryKey === 'to_sync' || categoryKey === 'done') {
      setSortOption('submissionDate');
    } else {
      setSortOption('dueDate');
    }
    
    setSelectedCategory(categoryKey);

    if (categoryKey === 'to_sync') {
      showToSyncTip();
    }
  };


  const handleItemPress = (item: TodoItem) => {
    // ... (This function remains unchanged)
    router.push('/courses');

    setTimeout(() => {
      router.push({
        pathname: `/courses/${item.course_id}`,
        params: {
          scrollToAssessment: item.assessment_id.toString(),
          highlightAssessment: 'true'
        }
      });
    }, 100);
  };

  const formatDate = (dateString?: string): string => {
    // ... (This function remains unchanged)
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
    // ... (This function remains unchanged)
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
    // ... (This function remains unchanged)
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
    // ... (This component remains unchanged)
     <View style={styles.todoItemWrapper}>
      <TouchableOpacity 
        style={styles.todoItem}
        onPress={() => handleItemPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.todoItemContent}>
          <View style={styles.todoItemHeader}>
            <View style={[styles.typeIconContainer, { backgroundColor: getTypeColor(item.type) }]}>
              <Ionicons 
                name={getTypeIcon(item.type)} 
                size={20} 
                color="#fff" 
              />
            </View>
            
            <View style={styles.todoItemInfo}>
              <View style={styles.courseRow}>
                <Text style={styles.todoItemCourse} numberOfLines={1}>
                  {item.course_name || 'Unknown Course'}
                </Text>
                {item.late && (
                  <View style={styles.lateBadge}>
                    <Text style={styles.lateText}>LATE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.todoItemTitle} numberOfLines={2}>
                {item.title || 'Untitled'}
              </Text>
              
              <View style={styles.metaRow}>
                <Text style={styles.dueDateText}>
                  {item.status === 'to_sync' && item.submitted_at 
                    ? `Submitted ${new Date(item.submitted_at).toLocaleDateString()}`
                    : item.status === 'done' && item.submitted_at
                      ? `Turned in ${new Date(item.submitted_at).toLocaleDateString()}`
                      : formatDate(item.due_date)
                  }
                </Text>
                {item.points ? (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.pointsText}>{item.points} points</Text>
                  </>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );

  const renderEmptyState = () => {
    // ... (This component remains unchanged)
    const content = {
      unfinished: {
        title: 'No work due soon',
        subtitle: 'All done!',
        icon: 'checkmark-done-circle-outline'
      },
      missing: {
        title: 'No missing work',
        subtitle: 'Great! You\'re all caught up',
        icon: 'happy-outline'
      },
      to_sync: {
        title: 'Nothing to sync',
        subtitle: 'All work has been synced',
        icon: 'cloud-done-outline'
      },
      done: {
        title: 'No completed work yet',
        subtitle: 'Turned in work will appear here',
        icon: 'folder-open-outline'
      }
    }[selectedCategory] || {
      title: 'No items found',
      subtitle: 'Nothing to show here',
      icon: 'document-outline'
    };

    return (
      <View style={styles.emptyState}>
        <Ionicons 
          name={content.icon} 
          size={72} 
          color="#dadce0" 
        />
        <Text style={styles.emptyStateTitle}>
          {content.title}
        </Text>
        <Text style={styles.emptyStateSubtitle}>
          {content.subtitle}
        </Text>
      </View>
    );
  };
  
  useEffect(() => {
    // ... (This useEffect remains unchanged)
    if (isConnected && categoryCounts.to_sync > 0 && !isLoading && !isSyncing) {
      runTargetedSync();
    }
  }, [isConnected, categoryCounts.to_sync, isLoading]);

  useFocusEffect(
    // ... (This useFocusEffect remains unchanged)
     useCallback(() => {
      setTimeout(() => {
        loadTodoItems(true);
      }, 200);
    }, [])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>To-do</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            
            {/* Manual Update Button - [MODIFIED] Uses handleManualUpdate */}
            {netInfo?.isInternetReachable && (
              <TouchableOpacity 
                style={styles.updateButton}
                onPress={handleManualUpdate}
                disabled={isUpdating || isRefreshing || isSyncing}
              >
                {isUpdating ? (
                  <>
                    <ActivityIndicator size="small" color="#1967d2" />
                    <Text style={[styles.updateButtonText, { marginLeft: 8 }]}>Updating...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="sync" size={18} color="#1967d2" />
                    <Text style={styles.updateButtonText}>Update</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            
            {/* High-priority Sync Button - (Unchanged) */}
            {hasPendingSync && netInfo?.isInternetReachable && (
              <TouchableOpacity 
                style={styles.syncIndicatorButton}
                onPress={() => runTargetedSync(true)}
                disabled={isSyncing || isUpdating || isRefreshing}
              >
                {isSyncing ? (
                  <>
                    <ActivityIndicator size="small" color="#e37400" />
                    <Text style={[styles.syncIndicatorText, { marginLeft: 8 }]}>Syncing...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={18} color="#e37400" />
                    <Text style={styles.syncIndicatorText}>Sync</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            
            {/* Refresh Button - [MODIFIED] Uses handleRefresh */}
            <TouchableOpacity 
              style={styles.refreshButton} 
              onPress={handleRefresh}
              disabled={isLoading || isRefreshing || isSyncing || isUpdating}
            >
              <Ionicons 
                name="refresh" 
                size={24} 
                color="#5f6368" 
                style={[(isLoading || isRefreshing || isSyncing || isUpdating) && { opacity: 0.5 }]}
              />
            </TouchableOpacity>
          </View>
        </View>
        
        {!netInfo?.isInternetReachable && (
          <View style={styles.offlineNotice}>
            <Ionicons name="cloud-offline-outline" size={16} color="#5f6368" />
            <Text style={styles.offlineText}>Offline</Text>
          </View>
        )}
      </View>

      <View style={styles.tabsContainer}>
        {/* ... (Tabs container remains unchanged) */}
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
              onPress={() => handleCategoryPress(category.key)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.tabText,
                selectedCategory === category.key && styles.tabTextActive
              ]}>
                {category.title}
              </Text>
              {categoryCounts[category.key] > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={[
                    styles.tabBadgeText,
                    selectedCategory === category.key && styles.tabBadgeTextActive
                  ]}>
                    {/* Show spinner in 'To sync' tab badge while syncing */}
                    {category.key === 'to_sync' && isSyncing ? (
                      <ActivityIndicator size="small" color="#e37400" />
                    ) : (
                      categoryCounts[category.key]
                    )}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.content}>
        <View style={styles.sortContainer}>
          {/* ... (Sort container remains unchanged) */}
          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => setSortOption(prev => prev === 'dueDate' ? 'submissionDate' : 'dueDate')}
          >
            <Ionicons name="swap-vertical" size={18} color="#5f6368" />
            <Text style={styles.sortText}>
              Sort by: {sortOption === 'dueDate' ? 'Due Date' : 'Most Recent'}
            </Text>
          </TouchableOpacity>
        </View>
      
        {(isLoading && !isRefreshing) || (isSyncing && todoItems.length === 0) ? (
          // ... (Loading container remains unchanged)
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1967d2" />
            {isSyncing && <Text style={{ marginTop: 10, color: '#5f6368' }}>Syncing your work...</Text>}
          </View>
        ) : (
          <FlatList
            // ... (FlatList remains unchanged)
            data={todoItems}
            keyExtractor={(item) => item.id}
            renderItem={renderTodoItem}
            ListEmptyComponent={renderEmptyState}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor="#1967d2"
                colors={['#1967d2']}
              />
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          />
        )}
      </View>
    </View>
  );
}

// ... (All styles remain unchanged)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    backgroundColor: '#fff',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '500',
    color: '#202124',
  },
  refreshButton: {
    padding: 8,
  },
  syncIndicatorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef7e0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e37400',
    minHeight: 34, // Added for consistent height
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1967d2',
    minHeight: 34,
  },
  updateButtonText: {
    fontSize: 12,
    color: '#1967d2',
    fontWeight: '600',
    marginLeft: 4,
  },
  syncIndicatorText: {
    fontSize: 12,
    color: '#e37400',
    fontWeight: '600',
    marginLeft: 4,
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#f1f3f4',
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  offlineText: {
    fontSize: 12,
    color: '#5f6368',
    marginLeft: 4,
    fontWeight: '500',
  },
  tabsContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tabsContent: {
    paddingHorizontal: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 4,
  },
  tabActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#1967d2',
  },
  tabText: {
    fontSize: 14,
    color: '#5f6368',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#1967d2',
    fontWeight: '600',
  },
  tabBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#e8eaed',
    borderRadius: 10,
    minWidth: 20, // ensure badge has size
    minHeight: 20, // ensure badge has size
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: 11,
    color: '#5f6368',
    fontWeight: '600',
  },
  tabBadgeTextActive: {
    color: '#1967d2',
  },
  content: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  sortContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    padding: 4,
  },
  sortText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#5f6368',
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20, // Added padding
  },
  listContent: {
    padding: 12,
    paddingBottom: 24,
  },
  todoItemWrapper: {
    marginBottom: 0,
  },
  todoItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    overflow: 'hidden',
  },
  todoItemContent: {
    padding: 16,
  },
  todoItemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  typeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  todoItemInfo: {
    flex: 1,
  },
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  todoItemCourse: {
    fontSize: 12,
    color: '#5f6368',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  todoItemTitle: {
    fontSize: 16,
    fontWeight: '400',
    color: '#202124',
    marginBottom: 8,
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dueDateText: {
    fontSize: 13,
    color: '#5f6368',
  },
  divider: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#dadce0',
    marginHorizontal: 8,
  },
  pointsText: {
    fontSize: 13,
    color: '#5f6368',
  },
  lateBadge: {
    backgroundColor: '#fce8e6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginLeft: 8,
  },
  lateText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#d93025',
    letterSpacing: 0.5,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '400',
    color: '#5f6368',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#80868b',
    marginTop: 8,
    textAlign: 'center',
  },
});