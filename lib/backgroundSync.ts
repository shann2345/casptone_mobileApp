// lib/backgroundSync.ts
import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { getUserData, syncOfflineQuiz, syncOfflineSubmission } from './api';
import { getDb } from './localDb';

// Task name for background sync
const BACKGROUND_SYNC_TASK = 'background-offline-sync';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Background task that syncs offline submissions and quizzes
 * Runs automatically when device has internet connection
 */
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  console.log('🔄 [Background] Starting background sync task...');
  
  try {
    const userData = await getUserData();
    if (!userData?.email) {
      console.log('⚠️ [Background] No user data found, skipping sync');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const db = await getDb();
    
    // Check for unsynced submissions
    const unsyncedSubmissions = await db.getAllAsync(
      `SELECT * FROM offline_submissions WHERE user_email = ? AND synced = 0`,
      [userData.email]
    );

    // Check for unsynced quizzes
    const unsyncedQuizzes = await db.getAllAsync(
      `SELECT * FROM offline_quiz_attempts 
       WHERE user_email = ? AND synced = 0 AND status = 'completed'`,
      [userData.email]
    );

    const totalPending = unsyncedSubmissions.length + unsyncedQuizzes.length;

    if (totalPending === 0) {
      console.log('✅ [Background] No items to sync');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    console.log(`📤 [Background] Found ${totalPending} items to sync`);

    let successCount = 0;
    let failCount = 0;

    // Sync file submissions
    for (const submission of unsyncedSubmissions) {
      try {
        const success = await syncOfflineSubmission(
          submission.assessment_id,
          submission.file_uri,
          submission.original_filename,
          submission.submitted_at
        );

        if (success) {
          await db.runAsync(
            `UPDATE offline_submissions SET synced = 1 WHERE id = ?`,
            [submission.id]
          );
          successCount++;
          console.log(`✅ [Background] Synced submission ${submission.id}`);
        } else {
          failCount++;
          console.log(`❌ [Background] Failed to sync submission ${submission.id}`);
        }
      } catch (error) {
        failCount++;
        console.error(`❌ [Background] Error syncing submission ${submission.id}:`, error);
      }
    }

    // Sync quiz attempts
    for (const quiz of unsyncedQuizzes) {
      try {
        const success = await syncOfflineQuiz(
          quiz.assessment_id,
          quiz.answers,
          quiz.start_time,
          quiz.end_time
        );

        if (success) {
          await db.runAsync(
            `UPDATE offline_quiz_attempts SET synced = 1 WHERE assessment_id = ? AND user_email = ?`,
            [quiz.assessment_id, userData.email]
          );
          successCount++;
          console.log(`✅ [Background] Synced quiz ${quiz.assessment_id}`);
        } else {
          failCount++;
          console.log(`❌ [Background] Failed to sync quiz ${quiz.assessment_id}`);
        }
      } catch (error) {
        failCount++;
        console.error(`❌ [Background] Error syncing quiz ${quiz.assessment_id}:`, error);
      }
    }

    // Show notification if any items were synced
    if (successCount > 0) {
      await showSyncNotification(successCount, failCount);
    }

    console.log(`✅ [Background] Sync complete: ${successCount} successful, ${failCount} failed`);

    return successCount > 0 
      ? BackgroundFetch.BackgroundFetchResult.NewData 
      : BackgroundFetch.BackgroundFetchResult.Failed;

  } catch (error) {
    console.error('❌ [Background] Error in background sync:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Show a local notification when sync completes
 */
const showSyncNotification = async (successCount: number, failCount: number) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '✅ Offline Work Synced',
        body: `${successCount} assessment${successCount > 1 ? 's' : ''} synced successfully${failCount > 0 ? `, ${failCount} failed` : ''}`,
        data: { type: 'background-sync' },
        sound: true,
      },
      trigger: null, // Show immediately
    });
  } catch (error) {
    console.error('❌ Failed to show sync notification:', error);
  }
};

/**
 * Register the background sync task
 * Call this when user logs in or on app start
 */
export const registerBackgroundSync = async (): Promise<boolean> => {
  try {
    // Check if task is already registered
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    
    if (isRegistered) {
      console.log('✅ Background sync already registered');
      return true;
    }

    // Request notification permissions
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('⚠️ Notification permissions not granted');
    }

    // Register the background fetch task
    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60, // 15 minutes (minimum allowed by iOS)
      stopOnTerminate: false, // Continue after app is closed
      startOnBoot: true, // Start on device boot (Android)
    });

    console.log('✅ Background sync registered successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to register background sync:', error);
    return false;
  }
};

/**
 * Unregister the background sync task
 * Call this when user logs out
 */
export const unregisterBackgroundSync = async (): Promise<void> => {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
      console.log('✅ Background sync unregistered');
    }
  } catch (error) {
    console.error('❌ Failed to unregister background sync:', error);
  }
};

/**
 * Check if background sync is enabled
 */
export const isBackgroundSyncEnabled = async (): Promise<boolean> => {
  try {
    return await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
  } catch (error) {
    console.error('❌ Failed to check background sync status:', error);
    return false;
  }
};

/**
 * Manually trigger background sync (for testing)
 */
export const triggerBackgroundSync = async (): Promise<void> => {
  try {
    console.log('🔄 Manually triggering background sync...');
    await BackgroundFetch.setMinimumIntervalAsync(15 * 60);
    console.log('✅ Background sync triggered');
  } catch (error) {
    console.error('❌ Failed to trigger background sync:', error);
  }
};

/**
 * Get background sync status
 */
export const getBackgroundSyncStatus = async (): Promise<{
  isRegistered: boolean;
  status: BackgroundFetch.BackgroundFetchStatus;
}> => {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    const status = await BackgroundFetch.getStatusAsync();
    
    return { isRegistered, status };
  } catch (error) {
    console.error('❌ Failed to get background sync status:', error);
    return {
      isRegistered: false,
      status: BackgroundFetch.BackgroundFetchStatus.Denied,
    };
  }
};
