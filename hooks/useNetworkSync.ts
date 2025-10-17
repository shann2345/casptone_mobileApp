import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useNetworkStatus } from '../context/NetworkContext';
import { getUserData, syncOfflineQuiz, syncOfflineSubmission } from '../lib/api';
import {
  deleteOfflineQuizAttempt,
  deleteOfflineSubmission,
  getCompletedOfflineQuizzes,
  getUnsyncedSubmissions
} from '../lib/localDb';

// Type definitions
interface UnsyncedSubmission {
  id: number;
  assessment_id: number;
  file_uri: string;
  original_filename: string;
  submitted_at: string;
}

interface UnsyncedQuiz {
  assessment_id: number;
  answers: string;
  start_time: string;
  end_time: string;
}

/**
 * Automatic sync hook that syncs offline submissions when internet reconnects
 */
export const useNetworkSync = () => {
  const { netInfo } = useNetworkStatus();
  const isInternetReachable = netInfo?.isInternetReachable;
  const previousConnectionState = useRef(isInternetReachable);
  const isSyncing = useRef(false);
  const lastSyncAttempt = useRef(0);
  const SYNC_COOLDOWN = 30000; // 30 seconds between sync attempts

  useEffect(() => {
    const syncOnReconnect = async () => {
      // Only sync when going from offline â†’ online
      const wasOffline = previousConnectionState.current === false || previousConnectionState.current === null;
      const isNowOnline = isInternetReachable === true;

      // Check cooldown
      const now = Date.now();
      const timeSinceLastSync = now - lastSyncAttempt.current;

      if (wasOffline && isNowOnline && !isSyncing.current && timeSinceLastSync > SYNC_COOLDOWN) {
        console.log('[Network Sync] Internet reconnected, starting automatic sync...');
        isSyncing.current = true;
        lastSyncAttempt.current = now;

        try {
          // Get user data
          const userData = await getUserData();
          if (!userData?.email) {
            console.log('[Network Sync] No user data found');
            isSyncing.current = false;
            return;
          }

          // Get unsynced items
          const unsyncedSubmissions = await getUnsyncedSubmissions(userData.email) as UnsyncedSubmission[];
          const unsyncedQuizzes = await getCompletedOfflineQuizzes(userData.email) as UnsyncedQuiz[];
          
          console.log(`[Network Sync] Found ${unsyncedSubmissions.length} submissions and ${unsyncedQuizzes.length} quizzes to sync`);
          
          let successCount = 0;
          let failCount = 0;

          // Sync file submissions
          for (const submission of unsyncedSubmissions) {
            try {
              console.log(`[Network Sync] Syncing submission for assessment ${submission.assessment_id}...`);
              
              const syncResult = await syncOfflineSubmission(
                submission.assessment_id,
                submission.file_uri,
                submission.original_filename,
                submission.submitted_at
              );

              if (syncResult) {
                // âœ… Delete from localDb ONLY after successful sync
                await deleteOfflineSubmission(submission.id);
                successCount++;
                console.log(`[Network Sync] Successfully synced and deleted submission ${submission.id}`);
              } else {
                failCount++;
                console.log(`[Network Sync] Failed to sync submission ${submission.id}`);
              }
            } catch (error) {
              console.error(`[Network Sync] Error syncing submission ${submission.id}:`, error);
              failCount++;
            }
          }

          // Sync quiz attempts
          for (const quiz of unsyncedQuizzes) {
            try {
              console.log(`[Network Sync] Syncing quiz for assessment ${quiz.assessment_id}...`);
              
              // Validate quiz data
              if (!quiz.answers || !quiz.start_time || !quiz.end_time) {
                console.warn(`[Network Sync] Skipping quiz ${quiz.assessment_id} - missing required data`);
                failCount++;
                continue;
              }
              
              const syncResult = await syncOfflineQuiz(
                quiz.assessment_id,
                quiz.answers,
                quiz.start_time,
                quiz.end_time
              );

              if (syncResult) {
                // âœ… Delete quiz attempt ONLY after successful sync
                await deleteOfflineQuizAttempt(quiz.assessment_id, userData.email);
                successCount++;
                console.log(`[Network Sync] Successfully synced and deleted quiz attempt ${quiz.assessment_id}`);
              } else {
                failCount++;
                console.log(`[Network Sync] Failed to sync quiz ${quiz.assessment_id}`);
              }
            } catch (error) {
              console.error(`[Network Sync] Error syncing quiz ${quiz.assessment_id}:`, error);
              failCount++;
            }
          }

          // Show appropriate alert
          if (successCount > 0) {
            console.log(`[Network Sync] Auto-sync complete: ${successCount} items synced`);
            
            Alert.alert(
              'Sync Complete',
              `Successfully synced ${successCount} offline assessment${successCount > 1 ? 's' : ''}!`,
              [{ text: 'OK' }]
            );
          } else if (failCount > 0) {
            console.log(`[Network Sync] Auto-sync failed: ${failCount} items failed`);
            
            Alert.alert(
              'Sync Failed',
              `${failCount} item${failCount > 1 ? 's' : ''} failed to sync. Please try again later.`,
              [{ text: 'OK' }]
            );
          } else {
            console.log('[Network Sync] No items to sync');
          }
        } catch (error) {
          console.error('[Network Sync] Auto-sync error:', error);
          
          Alert.alert(
            'Sync Error',
            'Failed to sync offline work. Please try again later.',
            [{ text: 'OK' }]
          );
        } finally {
          isSyncing.current = false;
        }
      } else if (timeSinceLastSync <= SYNC_COOLDOWN && wasOffline && isNowOnline) {
        console.log(`[Network Sync] Cooldown active: ${Math.round((SYNC_COOLDOWN - timeSinceLastSync) / 1000)}s remaining`);
      }

      previousConnectionState.current = isInternetReachable;
    };

    syncOnReconnect();
  }, [isInternetReachable]);
};