/**
 * Centralized offline sync utility
 * This file provides a reusable function to sync offline submissions and quizzes
 * across different screens in the app
 */

import { getUserData, syncOfflineQuiz, syncOfflineSubmission } from './api';
import {
    deleteOfflineQuizAttempt,
    deleteOfflineSubmission,
    getCompletedOfflineQuizzes,
    getUnsyncedSubmissions
} from './localDb';

/**
 * Syncs all offline submissions and quizzes for the current user
 * @param source - Optional string to identify which screen initiated the sync (for logging)
 * @returns Object with counts of synced submissions and quizzes
 */
export const syncAllOfflineData = async (source: string = 'App'): Promise<{
  syncedSubmissions: number;
  syncedQuizzes: number;
  failedSubmissions: number;
  failedQuizzes: number;
}> => {
  let syncedSubmissions = 0;
  let syncedQuizzes = 0;
  let failedSubmissions = 0;
  let failedQuizzes = 0;

  try {
    const userData = await getUserData();
    if (!userData?.email) {
      console.log(`⚠️ ${source}: No user data found, skipping offline sync`);
      return { syncedSubmissions, syncedQuizzes, failedSubmissions, failedQuizzes };
    }

    console.log(`🔄 ${source}: Checking for offline submissions to sync...`);
    
    // Sync offline file submissions
    const unsyncedSubmissions = await getUnsyncedSubmissions(userData.email);
    console.log(`📤 ${source}: Found ${unsyncedSubmissions.length} unsynced submissions`);
    
    for (const sub of unsyncedSubmissions) {
      try {
        console.log(`📤 ${source}: Syncing submission for assessment ${(sub as any).assessment_id}...`);
        await syncOfflineSubmission(
          (sub as any).assessment_id, 
          (sub as any).file_uri, 
          (sub as any).original_filename, 
          (sub as any).submitted_at
        );
        await deleteOfflineSubmission((sub as any).id);
        syncedSubmissions++;
        console.log(`✅ ${source}: Successfully synced submission ${(sub as any).id}`);
      } catch (err) {
        failedSubmissions++;
        console.error(`❌ ${source}: Failed to sync submission ${(sub as any).id}:`, err);
      }
    }

    // Sync offline quiz submissions
    const completedOfflineQuizzes = await getCompletedOfflineQuizzes(userData.email);
    console.log(`📤 ${source}: Found ${completedOfflineQuizzes.length} unsynced quizzes`);
    
    for (const quiz of completedOfflineQuizzes) {
      try {
        console.log(`📤 ${source}: Syncing quiz for assessment ${quiz.assessment_id}...`);
        const success = await syncOfflineQuiz(
          quiz.assessment_id,
          quiz.answers,
          quiz.started_at,
          quiz.completed_at
        );
        
        if (success) {
          await deleteOfflineQuizAttempt(quiz.assessment_id, userData.email);
          syncedQuizzes++;
          console.log(`✅ ${source}: Successfully synced quiz ${quiz.assessment_id}`);
        } else {
          failedQuizzes++;
          console.error(`❌ ${source}: Failed to sync quiz ${quiz.assessment_id}`);
        }
      } catch (err) {
        failedQuizzes++;
        console.error(`❌ ${source}: Failed to sync quiz ${quiz.assessment_id}:`, err);
      }
    }

    const totalSynced = syncedSubmissions + syncedQuizzes;
    const totalFailed = failedSubmissions + failedQuizzes;
    
    if (totalSynced > 0) {
      console.log(`✅ ${source}: Offline sync completed - Synced: ${totalSynced} (${syncedSubmissions} submissions, ${syncedQuizzes} quizzes), Failed: ${totalFailed}`);
    } else if (unsyncedSubmissions.length === 0 && completedOfflineQuizzes.length === 0) {
      console.log(`ℹ️ ${source}: No offline data to sync`);
    }

    return { syncedSubmissions, syncedQuizzes, failedSubmissions, failedQuizzes };
  } catch (error) {
    console.error(`❌ ${source}: Error during offline sync:`, error);
    return { syncedSubmissions, syncedQuizzes, failedSubmissions, failedQuizzes };
  }
};
