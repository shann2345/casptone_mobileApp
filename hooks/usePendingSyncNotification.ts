import { getUserData } from '@/lib/api';
import { getDb } from '@/lib/localDb';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

// Global state to track last check time per screen
const lastCheckTimestamps: { [key: string]: number } = {};
const COOLDOWN_MS = 30000; // 30 seconds cooldown between checks

export const usePendingSyncNotification = (
  isInternetReachable: boolean | null,
  currentScreen: string = 'current'
) => {
  const [hasPendingSync, setHasPendingSync] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const router = useRouter();
  const hasShownAlertRef = useRef(false);
  const previousConnectionState = useRef(isInternetReachable);

  useEffect(() => {
    // Only check when connection state changes from offline to online
    const wasOffline = previousConnectionState.current === false || previousConnectionState.current === null;
    const isNowOnline = isInternetReachable === true;
    
    if (wasOffline && isNowOnline && !hasShownAlertRef.current) {
      console.log(`🌐 [${currentScreen}] Network reconnected, checking for pending sync...`);
      checkForPendingSync();
    }
    
    previousConnectionState.current = isInternetReachable;
  }, [isInternetReachable]);

  const checkForPendingSync = async () => {
    // Only check if we have internet and haven't checked recently
    if (isInternetReachable !== true || isChecking) {
      console.log(`⏸️ [${currentScreen}] Skipping check: isOnline=${isInternetReachable}, isChecking=${isChecking}`);
      return;
    }

    // Check cooldown
    const now = Date.now();
    const lastCheck = lastCheckTimestamps[currentScreen] || 0;
    const timeSinceLastCheck = now - lastCheck;
    
    if (timeSinceLastCheck < COOLDOWN_MS) {
      console.log(`⏰ [${currentScreen}] Cooldown active: ${Math.round((COOLDOWN_MS - timeSinceLastCheck) / 1000)}s remaining`);
      return;
    }

    try {
      setIsChecking(true);
      console.log(`🔍 [${currentScreen}] Checking for pending sync...`);
      
      const userData = await getUserData();
      if (!userData?.email) {
        console.log(`❌ [${currentScreen}] No user email found`);
        return;
      }

      const db = await getDb();
      
      // Check for unsynced file submissions
      const unsyncedSubmissions = await db.getAllAsync(
        `SELECT COUNT(*) as count FROM offline_submissions 
         WHERE user_email = ? AND synced = 0`,
        [userData.email]
      );

      // Check for unsynced quiz attempts
      const unsyncedQuizzes = await db.getAllAsync(
        `SELECT COUNT(*) as count FROM offline_quiz_attempts 
         WHERE user_email = ? AND synced = 0`,
        [userData.email]
      );

      const submissionCount = (unsyncedSubmissions[0] as any)?.count || 0;
      const quizCount = (unsyncedQuizzes[0] as any)?.count || 0;
      const totalPending = submissionCount + quizCount;

      console.log(`📊 [${currentScreen}] Pending sync count: ${totalPending} (submissions: ${submissionCount}, quizzes: ${quizCount})`);

      if (totalPending > 0) {
        setHasPendingSync(true);
        lastCheckTimestamps[currentScreen] = now; // Update timestamp
        showSyncNotification(totalPending);
      } else {
        console.log(`✅ [${currentScreen}] No pending items to sync`);
        setHasPendingSync(false);
      }
    } catch (error) {
      console.error(`❌ [${currentScreen}] Error checking for pending sync:`, error);
    } finally {
      setIsChecking(false);
    }
  };

  const showSyncNotification = (count: number) => {
    if (hasShownAlertRef.current) {
      console.log(`⚠️ [${currentScreen}] Alert already shown, skipping`);
      return;
    }

    const message = count === 1 
      ? 'You have 1 offline assessment that needs to be synced.'
      : `You have ${count} offline assessments that need to be synced.`;

    console.log(`🔔 [${currentScreen}] Showing sync notification: ${count} items`);
    hasShownAlertRef.current = true;

    Alert.alert(
      '🔄 Sync Required',
      `${message}\n\nWould you like to go to the dashboard to sync your work now?`,
      [
        {
          text: 'Later',
          style: 'cancel',
          onPress: () => {
            console.log(`⏭️ [${currentScreen}] User chose "Later"`);
            setHasPendingSync(false);
          }
        },
        {
          text: 'Sync Now',
          onPress: () => {
            console.log(`✅ [${currentScreen}] User chose "Sync Now", navigating to dashboard...`);
            setHasPendingSync(false);
            // Navigate to dashboard (index/home screen)
            router.push('/(app)');
          }
        }
      ],
      { cancelable: false }
    );
  };

  const manualCheck = () => {
    console.log(`🔄 [${currentScreen}] Manual check triggered`);
    hasShownAlertRef.current = false; // Reset alert flag for manual checks
    checkForPendingSync();
  };

  return {
    hasPendingSync,
    isChecking,
    manualCheck
  };
};
