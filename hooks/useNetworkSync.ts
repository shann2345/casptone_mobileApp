import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useNetworkStatus } from '../context/NetworkContext';
import api, { getServerTime, getUserData, syncOfflineQuiz, syncOfflineSubmission } from '../lib/api';
import {
  clearManipulationFlag,
  deleteCompletedOfflineQuizAttempt,
  deleteOfflineSubmission,
  downloadAllQuizQuestions,
  getCompletedOfflineQuizzes,
  getDb,
  getUnsyncedSubmissions,
  resetTimeCheckData,
  saveAssessmentDetailsToDb,
  saveAssessmentSyncTimestamp, // ADDED: Required to update local status after sync
  saveCourseDetailsToDb,
  saveCourseToDb,
  saveServerTime,
  syncAllAssessmentDetails,
  updateOnlineSync
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

interface EnrolledCourse {
  id: number;
  title: string;
  course_code: string;
  description: string;
  program?: {
    id: number;
    name: string;
  };
  instructor?: {
    id: number;
    name: string;
    given_name?: string;
  };
  status?: string;
  topics?: any[];
  materials?: any[];
  assessments?: any[];
}

interface SyncMetadata {
  last_full_sync: number;
  last_course_sync: number;
  last_assessment_sync: number;
  last_quiz_sync: number;
}

// ADDED: Interface for latest assignment submission (used in post-sync refresh)
interface LatestAssignmentSubmission {
  has_submitted_file: boolean;
  submitted_file_path: string | null;
  submitted_file_url: string | null;
  submitted_file_name: string | null;
  original_filename: string | null;
  submitted_at: string | null;
  status: string | null;
}

// ============================================
// SMART SYNC CONFIGURATION
// ============================================
const SYNC_CONFIG = {
  COOLDOWN: 30000,              // 30 seconds between any sync attempts
  COURSE_FRESHNESS: 600000,     // 10 minutes - courses don't change often
  ASSESSMENT_FRESHNESS: 300000, // 5 minutes - assessments update more frequently
  QUIZ_FRESHNESS: 600000,       // 10 minutes - quiz questions rarely change
  SUBMISSION_ALWAYS_SYNC: true, // Always sync unsubmitted work immediately
  SILENT_SUCCESS: true          // Only alert on failures or critical syncs
};

/**
 * Enhanced automatic sync hook with silent background updates
 */
export const useNetworkSync = () => {
  const { netInfo } = useNetworkStatus();
  const isInternetReachable = netInfo?.isInternetReachable;
  const previousConnectionState = useRef(isInternetReachable);
  const isSyncing = useRef(false);
  const lastSyncAttempt = useRef(0);

  useEffect(() => {
    const performSmartSync = async () => {
      // Only sync when going from offline → online
      const wasOffline = previousConnectionState.current === false || previousConnectionState.current === null;
      const isNowOnline = isInternetReachable === true;

      // Check cooldown
      const now = Date.now();
      const timeSinceLastSync = now - lastSyncAttempt.current;

      if (wasOffline && isNowOnline && !isSyncing.current && timeSinceLastSync > SYNC_CONFIG.COOLDOWN) {
        console.log('🔄 [Smart Sync] Internet reconnected, analyzing what needs updating...');
        isSyncing.current = true;
        lastSyncAttempt.current = now;

        try {
          // Get user data
          const userData = await getUserData();
          if (!userData?.email) {
            console.log('⚠️ [Smart Sync] No user data found');
            isSyncing.current = false;
            return;
          }

          const userEmail = userData.email;
          
          // Get sync metadata to check staleness
          const syncMeta = await getSyncMetadata(userEmail);
          
          let syncResults = {
            assessmentsSubmitted: 0,
            quizzesSynced: 0,
            coursesUpdated: 0,
            assessmentDetailsUpdated: 0,
            quizQuestionsDownloaded: 0,
            skipped: [] as string[],
            errors: [] as string[]
          };

          // ============================================
          // PHASE 1: TIME & APP STATE SYNCHRONIZATION (Always, Silent)
          // ============================================
          console.log('⏰ [Smart Sync] Phase 1: Syncing server time & app state...');
          try {
            await resetTimeCheckData(userEmail);
            
            const apiServerTime = await getServerTime();
            if (apiServerTime) {
              const currentDeviceTime = new Date().toISOString();
              await saveServerTime(userEmail, apiServerTime, currentDeviceTime);
              await updateOnlineSync(userEmail);
              await clearManipulationFlag(userEmail);
              
              console.log('✅ [Smart Sync] Server time & app state synced (silent)');
            }
          } catch (timeError) {
            console.error('❌ [Smart Sync] Server time sync failed:', timeError);
            syncResults.errors.push('Time sync failed');
          }

          // ============================================
          // PHASE 2: SYNC OFFLINE SUBMISSIONS (Always, Alert Only This!)
          // ============================================
          const unsyncedSubmissions = await getUnsyncedSubmissions(userEmail) as UnsyncedSubmission[];
          const unsyncedQuizzes = await getCompletedOfflineQuizzes(userEmail) as UnsyncedQuiz[];
          
          if (unsyncedSubmissions.length > 0 || unsyncedQuizzes.length > 0) {
            console.log(`📤 [Smart Sync] Phase 2: Syncing ${unsyncedSubmissions.length} submissions & ${unsyncedQuizzes.length} quizzes...`);
            
            // NEW: Track IDs of assessments that need a post-sync status refresh
            const submittedAssessmentIds = new Set<number>();
            
            // Sync submissions
            for (const submission of unsyncedSubmissions) {
              try {
                const syncResult = await syncOfflineSubmission(
                  submission.assessment_id,
                  submission.file_uri,
                  submission.original_filename,
                  submission.submitted_at
                );

                if (syncResult) {
                  await deleteOfflineSubmission(submission.id);
                  submittedAssessmentIds.add(submission.assessment_id); // <-- TRACK ID
                  syncResults.assessmentsSubmitted++;
                } else {
                  syncResults.errors.push(`Submission ${submission.id} failed`);
                }
              } catch (error) {
                syncResults.errors.push(`Submission ${submission.id} error`);
              }
            }

            // Sync quizzes
            for (const quiz of unsyncedQuizzes) {
              try {
                if (!quiz.answers || !quiz.start_time || !quiz.end_time) {
                  syncResults.errors.push(`Quiz ${quiz.assessment_id} incomplete`);
                  continue;
                }

                const syncResult = await syncOfflineQuiz(
                  quiz.assessment_id,
                  quiz.answers,
                  quiz.start_time,
                  quiz.end_time
                );

                if (syncResult) {
                  // Use the new, correct delete function
                  await deleteCompletedOfflineQuizAttempt(quiz.assessment_id, userEmail);
                  submittedAssessmentIds.add(quiz.assessment_id); // <-- TRACK ID
                  syncResults.quizzesSynced++;
                } else {
                  syncResults.errors.push(`Quiz ${quiz.assessment_id} failed`);
                }
              } catch (error) {
                syncResults.errors.push(`Quiz ${quiz.assessment_id} error`);
              }
            }
            
            // ==========================================================
            //  ✅ CRITICAL FIX: REFRESH ASSIGNMENT/QUIZ STATUS
            // ==========================================================
            if (submittedAssessmentIds.size > 0) {
                console.log(`📡 [Smart Sync] Refreshing local status for ${submittedAssessmentIds.size} submitted assessment(s)...`);

                for (const assessmentId of submittedAssessmentIds) {
                    try {
                        let latestSubmission: LatestAssignmentSubmission | null = null;
                        let attemptStatus: any = null;

                        // 1. Fetch latest assignment submission details (for assignment types)
                        try {
                            const latestResponse = await api.get(`/assessments/${assessmentId}/latest-assignment-submission`);
                            if (latestResponse.status === 200) {
                                latestSubmission = latestResponse.data as LatestAssignmentSubmission;
                            }
                        } catch (e) {
                            // This assessment might be a quiz/exam, or no submission found yet.
                        }

                        // 2. Fetch latest attempt status (for quiz/exam types)
                        try {
                            const attemptResponse = await api.get(`/assessments/${assessmentId}/attempt-status`);
                            if (attemptResponse.status === 200) {
                                attemptStatus = attemptResponse.data;
                            }
                        } catch (e) {
                            // Ignore 404/etc, means no attempt status yet.
                        }

                        // 3. Save the new online status to the local offline_assessment_data table
                        await saveAssessmentDetailsToDb(assessmentId, userEmail, attemptStatus, latestSubmission);
                        
                        await saveAssessmentSyncTimestamp(assessmentId, userEmail, new Date().toISOString());
                        
                        console.log(`✅ [Smart Sync] Refreshed status for assessment ID: ${assessmentId}`);
                        syncResults.assessmentDetailsUpdated++; 

                    } catch (statusError) {
                        console.error(`❌ [Smart Sync] Failed to refresh status for assessment ${assessmentId}:`, statusError);
                        syncResults.errors.push(`Status refresh for ${assessmentId} failed`);
                    }
                }
            }

          } else {
            console.log('✅ [Smart Sync] No offline work to sync (silent)');
          }

          // ============================================
          // PHASE 3: SMART COURSE UPDATE (Silent Background Update)
          // ============================================
          const courseStale = isDataStale(syncMeta.last_course_sync, SYNC_CONFIG.COURSE_FRESHNESS);
          
          if (courseStale) {
            console.log('📚 [Smart Sync] Phase 3: Courses are stale, updating silently...');
            try {
              const response = await api.get('/my-courses');
              const courses = response.data.courses || [];

              for (const course of courses) {
                try {
                  await saveCourseToDb(course, userEmail);
                } catch (saveError) {
                  console.error('❌ Failed to save course:', course.id);
                }
              }

              await fetchAndSaveCompleteCoursesData(courses, userEmail);
              syncResults.coursesUpdated = courses.length;
              
              await updateSyncTimestamp(userEmail, 'course');
              console.log(`✅ [Smart Sync] Updated ${courses.length} courses (silent)`);

            } catch (error) {
              console.error('❌ [Smart Sync] Failed to update courses:', error);
              syncResults.errors.push('Course update failed');
            }
          } else {
            console.log(`⏭️ [Smart Sync] Courses are fresh, skipping (silent)`);
          }

          // ============================================
          // PHASE 4: SMART ASSESSMENT DETAILS UPDATE (Silent)
          // ============================================
          const assessmentStale = isDataStale(syncMeta.last_assessment_sync, SYNC_CONFIG.ASSESSMENT_FRESHNESS);
          
          if (assessmentStale) {
            console.log('📊 [Smart Sync] Phase 4: Assessment details are stale, updating silently...');
            try {
              const syncResult = await syncAllAssessmentDetails(
                userEmail,
                api,
                (current, total, type) => {
                  console.log(`📊 ${type}: ${current}/${total}`);
                }
              );

              syncResults.assessmentDetailsUpdated += syncResult.success;
              
              await updateSyncTimestamp(userEmail, 'assessment');
              console.log(`✅ [Smart Sync] Updated ${syncResult.success} assessment details (silent)`);

              if (syncResult.failed > 0) {
                syncResults.errors.push(`${syncResult.failed} assessments failed`);
              }
            } catch (error) {
              console.error('❌ [Smart Sync] Failed to sync assessments:', error);
              syncResults.errors.push('Assessment sync failed');
            }
          } else {
            console.log(`⏭️ [Smart Sync] Assessments are fresh, skipping (silent)`);
          }

          // ============================================
          // PHASE 5: SMART QUIZ QUESTIONS UPDATE (Silent)
          // ============================================
          const quizStale = isDataStale(syncMeta.last_quiz_sync, SYNC_CONFIG.QUIZ_FRESHNESS);
          
          if (quizStale) {
            console.log('❓ [Smart Sync] Phase 5: Quiz questions are stale, updating silently...');
            try {
              const quizResult = await downloadAllQuizQuestions(
                userEmail,
                api,
                (current, total, skipped = 0) => {
                  console.log(`❓ Quiz: ${current}/${total} (${skipped} skipped)`);
                }
              );

              syncResults.quizQuestionsDownloaded = quizResult.success;
              
              await updateSyncTimestamp(userEmail, 'quiz');
              console.log(`✅ [Smart Sync] Downloaded ${quizResult.success} quiz sets (silent)`);

              if (quizResult.failed > 0) {
                syncResults.errors.push(`${quizResult.failed} quiz downloads failed`);
              }
            } catch (error) {
              console.error('❌ [Smart Sync] Failed to download quizzes:', error);
              syncResults.errors.push('Quiz download failed');
            }
          } else {
            console.log(`⏭️ [Smart Sync] Quiz questions are fresh, skipping (silent)`);
          }

          // ============================================
          // PHASE 6: SMART ALERT LOGIC (Only When Necessary!)
          // ============================================
          console.log('📊 [Smart Sync] Completed:', syncResults);
          
          // CRITICAL: Only show alerts for student work or errors
          const hasStudentWork = syncResults.assessmentsSubmitted > 0 || syncResults.quizzesSynced > 0;
          const hasCriticalErrors = syncResults.errors.length > 0;
          
          if (hasStudentWork && hasCriticalErrors) {
            // Student work synced but with some errors
            let message = '⚠️ Partial Sync Complete\n\n';
            
            if (syncResults.assessmentsSubmitted > 0) {
              message += `✅ ${syncResults.assessmentsSubmitted} assignment${syncResults.assessmentsSubmitted > 1 ? 's' : ''} submitted\n`;
            }
            if (syncResults.quizzesSynced > 0) {
              message += `✅ ${syncResults.quizzesSynced} quiz${syncResults.quizzesSynced > 1 ? 'zes' : ''} synced\n`;
            }
            
            message += `\n⚠️ ${syncResults.errors.length} item${syncResults.errors.length > 1 ? 's' : ''} failed to sync`;
            
            Alert.alert('Sync Status', message, [{ text: 'OK' }]);
            
          } else if (hasStudentWork && !hasCriticalErrors) {
            // Student work synced successfully - show success alert
            let message = '✅ Your work has been submitted!\n\n';
            
            if (syncResults.assessmentsSubmitted > 0) {
              message += `📤 ${syncResults.assessmentsSubmitted} assignment${syncResults.assessmentsSubmitted > 1 ? 's' : ''} uploaded\n`;
            }
            if (syncResults.quizzesSynced > 0) {
              message += `📝 ${syncResults.quizzesSynced} quiz${syncResults.quizzesSynced > 1 ? 'zes' : ''} submitted\n`;
            }
            
            Alert.alert('Work Submitted', message, [{ text: 'OK' }]);
            
          } else if (!hasStudentWork && hasCriticalErrors) {
            // No student work but sync errors occurred
            Alert.alert(
              'Sync Issues',
              `⚠️ ${syncResults.errors.length} background sync issue${syncResults.errors.length > 1 ? 's' : ''} occurred. Your offline data is preserved. Please check your connection and try again.`,
              [{ text: 'OK' }]
            );
            
          } else {
            // Everything synced silently in background - no alert needed!
            console.log('✅ [Smart Sync] All updates completed silently in background');
            console.log('📊 [Smart Sync] Summary:', {
              coursesUpdated: syncResults.coursesUpdated,
              assessmentsUpdated: syncResults.assessmentDetailsUpdated,
              quizzesDownloaded: syncResults.quizQuestionsDownloaded,
              userNotified: false
            });
          }

        } catch (error) {
          console.error('❌ [Smart Sync] Critical error:', error);
          // Only show alert for critical failures
          Alert.alert(
            'Sync Error',
            'A background sync error occurred. Your offline data is safe. The app will retry automatically.',
            [{ text: 'OK' }]
          );
        } finally {
          isSyncing.current = false;
        }
      } else if (timeSinceLastSync <= SYNC_CONFIG.COOLDOWN && wasOffline && isNowOnline) {
        console.log(`⏳ [Smart Sync] Cooldown: ${Math.round((SYNC_CONFIG.COOLDOWN - timeSinceLastSync) / 1000)}s remaining`);
      }

      previousConnectionState.current = isInternetReachable;
    };

    performSmartSync();
  }, [isInternetReachable]);
};

// ============================================
// HELPER FUNCTIONS (These remain unchanged)
// ============================================

/**
 * Check if data is stale based on last sync time
 */
const isDataStale = (lastSync: number, maxAge: number): boolean => {
  if (!lastSync || lastSync === 0) return true;
  return Date.now() - lastSync > maxAge;
};

/**
 * Get sync metadata for staleness detection
 */
const getSyncMetadata = async (userEmail: string): Promise<SyncMetadata> => {
  try {
    const db = await getDb();
    
    const result = await db.getFirstAsync(
      `SELECT * FROM sync_metadata WHERE user_email = ?;`,
      [userEmail]
    ) as any;

    if (result) {
      return {
        last_full_sync: result.last_full_sync || 0,
        last_course_sync: result.last_course_sync || 0,
        last_assessment_sync: result.last_assessment_sync || 0,
        last_quiz_sync: result.last_quiz_sync || 0,
      };
    }

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        user_email TEXT PRIMARY KEY,
        last_full_sync INTEGER DEFAULT 0,
        last_course_sync INTEGER DEFAULT 0,
        last_assessment_sync INTEGER DEFAULT 0,
        last_quiz_sync INTEGER DEFAULT 0
      );
    `);

    return {
      last_full_sync: 0,
      last_course_sync: 0,
      last_assessment_sync: 0,
      last_quiz_sync: 0,
    };
  } catch (error) {
    console.error('❌ Failed to get sync metadata:', error);
    return {
      last_full_sync: 0,
      last_course_sync: 0,
      last_assessment_sync: 0,
      last_quiz_sync: 0,
    };
  }
};

/**
 * Update sync timestamp for a specific data type
 */
const updateSyncTimestamp = async (
  userEmail: string, 
  type: 'course' | 'assessment' | 'quiz'
): Promise<void> => {
  try {
    const db = await getDb();
    const now = Date.now();
    
    await db.runAsync(
      `INSERT OR IGNORE INTO sync_metadata 
       (user_email, last_full_sync, last_course_sync, last_assessment_sync, last_quiz_sync)
       VALUES (?, 0, 0, 0, 0);`,
      [userEmail]
    );

    const column = `last_${type}_sync`;
    await db.runAsync(
      `UPDATE sync_metadata SET ${column} = ?, last_full_sync = ? WHERE user_email = ?;`,
      [now, now, userEmail]
    );
    
    console.log(`✅ Updated ${type} sync timestamp to ${now} (silent)`);
  } catch (error) {
    console.error('❌ Failed to update sync timestamp:', error);
  }
};

/**
 * Helper function to fetch and save complete course data
 */
const fetchAndSaveCompleteCoursesData = async (
  courses: EnrolledCourse[], 
  userEmail: string
): Promise<void> => {
  for (const course of courses) {
    try {
      const courseId = typeof course.id === 'string' ? parseInt(course.id, 10) : course.id;
      
      if (!courseId || isNaN(courseId) || courseId <= 0) {
        console.error('❌ Invalid course ID:', course.id);
        continue;
      }

      const courseDetailResponse = await api.get(`/courses/${courseId}`);
      
      if (courseDetailResponse.status === 200) {
        const detailedCourse = courseDetailResponse.data.course;
        if (!detailedCourse.id) {
          detailedCourse.id = courseId;
        }
        
        await saveCourseDetailsToDb(detailedCourse, userEmail);
      }
    } catch (saveError: any) {
      console.error(`❌ Failed to save course ${course.title}:`, saveError.message);
    }
  }
};