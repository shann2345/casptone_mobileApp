import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

const DB_NAME = 'multiuser.db';
const dbDirectory = `${FileSystem.documentDirectory}SQLite`;

// Add this type definition near the top of your file
type StudentAnswers = {
  [questionId: number]: {
    type: 'multiple_choice' | 'true_false' | 'essay' | 'identification';
    answer: string | number[];
    isDirty?: boolean;
  };
};

// Global database instance
let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbInitialized = false;
let initializationPromise: Promise<void> | null = null;

const openDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  try {
    if (Platform.OS === 'android') {
      await FileSystem.makeDirectoryAsync(dbDirectory, { intermediates: true }).catch(() => {
        // Directory might already exist, ignore error
      });
    }
    
    console.log('ðŸ“‚ Opening database:', DB_NAME);
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    console.log('âœ… Database opened successfully');
    return db;
  } catch (error) {
    console.error('âŒ Failed to open database:', error);
    throw error;
  }
};

export const getDb = async (): Promise<SQLite.SQLiteDatabase> => {
  // If we already have an instance and it's initialized, return it
  if (dbInstance && dbInitialized) {
    return dbInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    await initializationPromise;
    if (dbInstance) {
      return dbInstance;
    }
  }

  // Open a new database instance
  dbInstance = await openDatabase();
  return dbInstance;
};

export const initDb = async (): Promise<void> => {
  if (dbInitialized && dbInstance) {
    console.log('✅ Database already initialized');
    return;
  }
  if (initializationPromise) {
    console.log('⏳ Database initialization in progress, waiting...');
    await initializationPromise;
    return;
  }
  initializationPromise = (async () => {
    try {
      console.log('🚀 Initializing database...');
      const db = await getDb();

      // --- Existing table creations ---
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_courses (
          id INTEGER PRIMARY KEY NOT NULL, user_email TEXT NOT NULL, title TEXT NOT NULL, course_code TEXT, description TEXT, program_id INTEGER, program_name TEXT, instructor_id INTEGER, instructor_name TEXT, status TEXT, enrollment_date TEXT NOT NULL
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_course_details (
          course_id INTEGER NOT NULL, user_email TEXT NOT NULL, course_data TEXT NOT NULL, PRIMARY KEY (course_id, user_email)
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_materials (
          id INTEGER PRIMARY KEY NOT NULL, user_email TEXT NOT NULL, course_id INTEGER NOT NULL, title TEXT NOT NULL, file_path TEXT, content TEXT, material_type TEXT, created_at TEXT, available_at TEXT, unavailable_at TEXT, material_data TEXT NOT NULL,
          FOREIGN KEY (course_id, user_email) REFERENCES offline_course_details(course_id, user_email) ON DELETE CASCADE
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_assessments (
          id INTEGER PRIMARY KEY NOT NULL, user_email TEXT NOT NULL, course_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT, type TEXT, assessment_file_path TEXT, assessment_file_url TEXT, assessment_data TEXT NOT NULL,
          FOREIGN KEY (course_id, user_email) REFERENCES offline_course_details(course_id, user_email) ON DELETE CASCADE
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_assessment_data (
          assessment_id INTEGER NOT NULL, user_email TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (assessment_id, user_email)
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_assessment_sync (
          assessment_id INTEGER NOT NULL, user_email TEXT NOT NULL, last_sync_timestamp TEXT NOT NULL, PRIMARY KEY (assessment_id, user_email)
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, assessment_id INTEGER NOT NULL, file_uri TEXT NOT NULL, original_filename TEXT NOT NULL, submission_status TEXT NOT NULL, submitted_at TEXT NOT NULL,
          UNIQUE(user_email, assessment_id) ON CONFLICT REPLACE
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_quiz_questions (
          id INTEGER PRIMARY KEY NOT NULL, user_email TEXT NOT NULL, assessment_id INTEGER NOT NULL, question_text TEXT NOT NULL, question_type TEXT NOT NULL, options TEXT, correct_answer TEXT, points INTEGER, order_index INTEGER, question_data TEXT NOT NULL,
          FOREIGN KEY (assessment_id, user_email) REFERENCES offline_assessment_data(assessment_id, user_email) ON DELETE CASCADE
        );`
      );
      
      // --- FORCE-RESET QUIZ TABLES ---
      // This ensures the schema is always up-to-date during development.
      console.log('🔄 Resetting offline quiz tables to ensure correct schema...');
      await db.execAsync(`DROP TABLE IF EXISTS offline_quiz_option_selections;`);
      await db.execAsync(`DROP TABLE IF EXISTS offline_quiz_question_submissions;`);
      await db.execAsync(`DROP TABLE IF EXISTS offline_quiz_attempts;`);

      // --- RECREATE QUIZ TABLES WITH CORRECT SCHEMA ---
      await db.execAsync(
        `CREATE TABLE offline_quiz_attempts (
          attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
          assessment_id INTEGER NOT NULL,
          user_email TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT,
          is_completed INTEGER DEFAULT 0,
          answers TEXT,
          FOREIGN KEY (assessment_id, user_email) REFERENCES offline_assessments(id, user_email) ON DELETE CASCADE
        );`
      );
      await db.execAsync(
        `CREATE TABLE offline_quiz_question_submissions (
          submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
          attempt_id INTEGER NOT NULL,
          question_id INTEGER NOT NULL,
          submitted_answer TEXT,
          max_points INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (attempt_id) REFERENCES offline_quiz_attempts(attempt_id) ON DELETE CASCADE
        );`
      );
      await db.execAsync(
        `CREATE TABLE offline_quiz_option_selections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id INTEGER NOT NULL,
          option_id INTEGER NOT NULL,
          option_text TEXT NOT NULL,
          is_selected INTEGER NOT NULL DEFAULT 0,
          is_correct_option INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (submission_id) REFERENCES offline_quiz_question_submissions(submission_id) ON DELETE CASCADE
        );`
      );
      console.log('✅ Offline quiz tables created successfully.');

      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS app_state (
            user_email TEXT PRIMARY KEY NOT NULL, server_time TEXT, server_time_offset INTEGER, last_time_check INTEGER, time_check_sequence INTEGER DEFAULT 0
        );`
      );

      dbInitialized = true;
      console.log('✅ Database initialization complete');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();
  await initializationPromise;
};



// COURSES
export const saveCourseToDb = async (course: any, userEmail: string): Promise<void> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    console.log('ðŸ’¾ Saving course to local DB for user:', userEmail);
    
    const currentTime = new Date().toISOString();

    await db.runAsync(
      `INSERT OR REPLACE INTO offline_courses
       (id, user_email, title, course_code, description, program_id, program_name, instructor_id, instructor_name, status, enrollment_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        course.id,
        userEmail, // <-- New parameter
        course.title || '',
        course.course_code || '',
        course.description || '',
        course.program?.id || null,
        course.program?.name || '',
        course.instructor?.id || null,
        course.instructor?.name || '',
        course.status || 'Enrolled',
        currentTime
      ]
    );
    
    console.log('âœ… Saved course to local DB:', course.title);
  } catch (error) {
    console.error('âŒ Failed to save course to local DB:', error);
    throw error;
  }
};

export const saveCourseDetailsToDb = async (course: any, userEmail: string): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    console.log('ðŸ’¾ Saving detailed course data for user:', userEmail, ' and course:', course.id);

    // Save the main course data
    await db.runAsync(
      `INSERT OR REPLACE INTO offline_course_details (course_id, user_email, course_data) VALUES (?, ?, ?);`,
      [course.id, userEmail, JSON.stringify(course)]
    );

    // Separate and save materials and assessments from topics
    const materialsToSave = [];
    const assessmentsToSave = [];

    // Extract materials and assessments from nested topics
    if (course.topics) {
      for (const topic of course.topics) {
        if (topic.materials) {
          materialsToSave.push(...topic.materials);
        }
        if (topic.assessments) {
          assessmentsToSave.push(...topic.assessments);
        }
      }
    }
    
    // Handle independent assessments (not in a topic)
    if (course.assessments) {
      assessmentsToSave.push(...course.assessments);
    }
    
    // Save the materials and assessments
    await saveMaterialsToDb(materialsToSave, course.id, userEmail);
    await saveAssessmentsToDb(assessmentsToSave, course.id, userEmail);

    console.log('âœ… Detailed course data saved successfully.');
  } catch (error) {
    console.error('âŒ Failed to save detailed course data:', error);
    throw error;
  }
};

export const getCourseDetailsFromDb = async (courseId: number, userEmail: string): Promise<any | null> => {
  try {
    await initDb();
    const db = await getDb();

    console.log('ðŸ” Retrieving course details from local DB for course ID:', courseId);

    const result = await db.getAllAsync(
      `SELECT course_data FROM offline_course_details WHERE course_id = ? AND user_email = ?;`,
      [courseId, userEmail]
    );
    
    if (result && result.length > 0) {
      console.log('âœ… Course details found in local DB.');
      return JSON.parse(result[0].course_data);
    }
    
    console.log('âŒ Course details not found in local DB.');
    return null;
  } catch (error) {
    console.error('âŒ Failed to get course details from local DB:', error);
    return null;
  }
};

export const getEnrolledCoursesFromDb = async (userEmail: string) => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    const resultSet = await db.getAllAsync(
      `SELECT * FROM offline_courses WHERE user_email = ? ORDER BY enrollment_date DESC;`,
      [userEmail] // <-- New parameter
    );
    
    // Transform the data to match the expected format
    const courses = (resultSet || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      course_code: row.course_code,
      description: row.description,
      credits: 0, // Default value since we don't store this
      program: {
        id: row.program_id,
        name: row.program_name
      },
      instructor: row.instructor_id ? {
        id: row.instructor_id,
        name: row.instructor_name
      } : null,
      status: row.status,
      pivot: {
        status: row.status,
        enrollment_date: row.enrollment_date
      }
    }));
    
    console.log(`âœ… Retrieved ${courses.length} courses from local DB for user: ${userEmail}`);
    return courses;
  } catch (error) {
    console.error('âŒ Failed to get enrolled courses from local DB:', error);
    return [];
  }
};



// MATERIALS
export const saveMaterialsToDb = async (materials: any[], courseId: number, userEmail: string): Promise<void> => {
  if (!materials || materials.length === 0) {
    return;
  }
  await initDb();
  const db = await getDb();
  console.log('ðŸ’¾ Saving materials for course:', courseId);

  await db.withTransactionAsync(async () => {
    for (const material of materials) {
      await db.runAsync(
        `INSERT OR REPLACE INTO offline_materials (id, user_email, course_id, title, file_path, content, material_type, created_at, available_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          material.id,
          userEmail,
          courseId,
          material.title,
          material.file_path,
          material.content,
          material.type,
          material.created_at,
          material.available_at
        ]
      );
    }
  });
  console.log(`âœ… Saved ${materials.length} materials for course ${courseId}`);
};

export const getMaterialDetailsFromDb = async (materialId: number, userEmail: string): Promise<any | null> => {
  try {
    const db = await getDb();
    const result = await db.getFirstAsync(
      `SELECT * FROM offline_materials WHERE id = ? AND user_email = ?;`,
      [materialId, userEmail]
    );
    return result || null;
  } catch (error) {
    console.error(`âŒ Failed to get material ${materialId} from DB:`, error);
    return null;
  }
};


// ASSESSMENTS

export const saveAssessmentsToDb = async (assessments: any[], courseId: number, userEmail: string): Promise<void> => {
  if (!assessments || assessments.length === 0) {
    return;
  }
  await initDb();
  const db = await getDb();
  console.log('ðŸ’¾ Saving assessments for course:', courseId);
  await db.withTransactionAsync(async () => {
    for (const assessment of assessments) {
      await db.runAsync(
        `INSERT OR REPLACE INTO offline_assessments (id, user_email, course_id, title, description, type, available_at, unavailable_at, max_attempts, duration_minutes, assessment_file_path, assessment_file_url, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          assessment.id,
          userEmail,
          courseId,
          assessment.title,
          assessment.description,
          assessment.type,
          assessment.available_at,
          assessment.unavailable_at,
          assessment.max_attempts,
          assessment.duration_minutes,
          assessment.assessment_file_path,
          assessment.assessment_file_url,
          assessment.points
        ]
      );
    }
  });
  console.log(`âœ… Saved ${assessments.length} assessments for course ${courseId}`);
};

export const hasAssessmentDetailsSaved = async (
  assessmentId: number,
  userEmail: string
): Promise<boolean> => {
  try {
    const db = await getDb();
    const result = await db.getFirstAsync(
      `SELECT COUNT(*) as count FROM offline_assessment_data 
       WHERE assessment_id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );
    return (result as any)?.count > 0;
  } catch (error) {
    console.error('Error checking assessment details:', error);
    return false;
  }
};

export const saveAssessmentDetailsToDb = async (
  assessmentId: number | string,
  userEmail: string,
  attemptStatus: any,
  latestSubmission: any
): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    console.log('ðŸ’¾ Saving detailed assessment data for user:', userEmail, ' and assessment:', assessmentId);

    const assessmentData = {
      attemptStatus: attemptStatus || null,
      latestSubmission: latestSubmission || null,
    };

    await db.runAsync(
      `INSERT OR REPLACE INTO offline_assessment_data (assessment_id, user_email, data) VALUES (?, ?, ?);`,
      [assessmentId, userEmail, JSON.stringify(assessmentData)]
    );

    console.log('âœ… Detailed assessment data saved successfully.');
  } catch (error) {
    console.error('âŒ Failed to save detailed assessment data:', error);
    throw error;
  }
};

export const getAssessmentsWithoutDetails = async (userEmail: string): Promise<number[]> => {
  try {
    await initDb();
    const db = await getDb();
    
    // Get all assessment IDs for the user
    const allAssessments = await db.getAllAsync(
      `SELECT DISTINCT id FROM offline_assessments WHERE user_email = ?;`,
      [userEmail]
    );
    
    // Get assessment IDs that already have detailed data
    const assessmentsWithData = await db.getAllAsync(
      `SELECT DISTINCT assessment_id FROM offline_assessment_data WHERE user_email = ?;`,
      [userEmail]
    );
    
    const allAssessmentIds = allAssessments.map((row: any) => row.id);
    const assessmentIdsWithData = assessmentsWithData.map((row: any) => row.assessment_id);
    
    // Return IDs that don't have detailed data
    const assessmentsWithoutData = allAssessmentIds.filter(
      id => !assessmentIdsWithData.includes(id)
    );
    
    console.log(`ðŸ“Š Found ${assessmentsWithoutData.length} assessments without detailed data`);
    return assessmentsWithoutData;
  } catch (error) {
    console.error('âŒ Failed to get assessments without details:', error);
    return [];
  }
};

export const checkIfAssessmentNeedsDetails = async (assessmentId: number, userEmail: string): Promise<boolean> => {
  try {
    const db = await getDb();
    const result = await db.getFirstAsync(
      `SELECT COUNT(*) as count FROM offline_assessment_data WHERE assessment_id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );
    return (result as any)?.count === 0;
  } catch (error) {
    console.error('âŒ Error checking assessment details:', error);
    return true; // Assume it needs details if there's an error
  }
};

export const deleteAllAssessmentDetails = async (userEmail: string): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    
    console.log(`ðŸ—‘ï¸ Deleting all assessment data for user: ${userEmail}`);

    await db.runAsync(`DELETE FROM offline_assessments WHERE user_email = ?;`, [userEmail]);
    await db.runAsync(`DELETE FROM offline_assessment_data WHERE user_email = ?;`, [userEmail]);

    console.log('âœ… All assessment data cleared successfully.');
  } catch (error) {
    console.error('âŒ Failed to delete all assessment data:', error);
    throw error;
  }
};

export const downloadAllAssessmentDetails = async (
  userEmail: string, 
  apiInstance: any,
  onProgress?: (current: number, total: number, skipped?: number) => void
): Promise<{ success: number, failed: number, skipped: number }> => {
  try {
    const assessmentIds = await getAssessmentsWithoutDetails(userEmail);
    if (assessmentIds.length === 0) {
      console.log('All assessments already have detailed data');
      return { success: 0, failed: 0, skipped: 0 };
    }
    
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    
    console.log(`Starting download for ${assessmentIds.length} assessments`);
    
    for (let i = 0; i < assessmentIds.length; i++) {
      const assessmentId = assessmentIds[i];
      
      try {
        if (onProgress) {
          onProgress(i + 1, assessmentIds.length, skippedCount);
        }
        
        // Check if assessment details are already saved
        const hasDetails = await hasAssessmentDetailsSaved(assessmentId, userEmail);
        if (hasDetails) {
          console.log(`Assessment ${assessmentId} details already saved, skipping`);
          skippedCount++;
          continue;
        }
        
        let attemptStatus = null;
        let latestSubmission = null;
        
        const db = await getDb();
        const assessmentResult = await db.getFirstAsync(
          `SELECT type FROM offline_assessments WHERE id = ? AND user_email = ?;`,
          [assessmentId, userEmail]
        );
        
        if (!assessmentResult) {
          console.warn(`Assessment ${assessmentId} not found in local DB`);
          failedCount++;
          continue;
        }
        
        const assessmentType = (assessmentResult as any).type;
        
        // Fetch attempt status for quiz/exam types
        if (assessmentType === 'quiz' || assessmentType === 'exam') {
          try {
            const attemptResponse = await apiInstance.get(`/assessments/${assessmentId}/attempt-status`);
            if (attemptResponse.status === 200) {
              attemptStatus = attemptResponse.data;
            }
          } catch (error) {
            console.warn(`Failed to fetch attempt status for assessment ${assessmentId}`);
          }
        }
        
        // Fetch latest submission for assignment types
        if (['assignment', 'activity', 'project'].includes(assessmentType)) {
          try {
            const submissionResponse = await apiInstance.get(`/assessments/${assessmentId}/latest-assignment-submission`);
            if (submissionResponse.status === 200) {
              latestSubmission = submissionResponse.data;
            }
          } catch (error) {
            console.warn(`Failed to fetch submission for assessment ${assessmentId}`);
          }
        }
        
        await saveAssessmentDetailsToDb(assessmentId, userEmail, attemptStatus, latestSubmission);
        successCount++;
        
        console.log(`Downloaded details for assessment ${assessmentId}`);
        
      } catch (error) {
        console.error(`Failed to download details for assessment ${assessmentId}:`, error);
        failedCount++;
      }
    }
    
    console.log(`Download completed: ${successCount} successful, ${failedCount} failed, ${skippedCount} skipped`);
    return { success: successCount, failed: failedCount, skipped: skippedCount };
    
  } catch (error) {
    console.error('Batch download failed:', error);
    throw error;
  }
};

export const getAssessmentDetailsFromDb = async (assessmentId: number | string, userEmail: string): Promise<any | null> => {
  try {
    const db = await getDb();
    
    // First, get the base assessment details
    const assessmentResult = await db.getFirstAsync(
      `SELECT * FROM offline_assessments WHERE id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );

    if (!assessmentResult) {
      return null;
    }

    // Then, get the dynamic data (attempt status, submission)
    const dataResult = await db.getFirstAsync(
      `SELECT data FROM offline_assessment_data WHERE assessment_id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );

    let additionalData = {
      attemptStatus: null,
      latestSubmission: null,
    };

    if (dataResult && dataResult.data) {
      additionalData = JSON.parse(dataResult.data);
    }

    // Combine the two results
    return {
      ...assessmentResult,
      attemptStatus: additionalData.attemptStatus,
      latestSubmission: additionalData.latestSubmission,
    };
  } catch (error) {
    console.error(`âŒ Failed to get assessment ${assessmentId} from DB:`, error);
    return null;
  }
};

export const saveOfflineSubmission = async (
  userEmail: string,
  assessmentId: number,
  fileUri: string,
  originalFilename: string,
  submittedAt?: string // Optional parameter for server time
) => {
  try {
    await initDb();
    const db = await getDb();
    
    // Use provided server time or fallback to current server time calculation
    let finalSubmittedAt = submittedAt;
    if (!finalSubmittedAt) {
      const serverTime = await getSavedServerTime(userEmail);
      finalSubmittedAt = serverTime || new Date().toISOString();
    }
    
    console.log('ðŸ’¾ Saving offline submission to local DB with timestamp:', finalSubmittedAt);

    await db.runAsync(
      `INSERT OR REPLACE INTO offline_submissions (user_email, assessment_id, file_uri, original_filename, submission_status, submitted_at) VALUES (?, ?, ?, ?, ?, ?);`,
      [userEmail, assessmentId, fileUri, originalFilename, 'to sync', finalSubmittedAt]
    );

    console.log('âœ… Offline submission saved successfully.');
    return finalSubmittedAt; // Return the timestamp that was used
  } catch (error) {
    console.error('âŒ Failed to save offline submission:', error);
    throw error;
  }
};

export const saveAssessmentSyncTimestamp = async (
  assessmentId: number,
  userEmail: string,
  syncTimestamp: string
): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    
    await db.runAsync(
      `INSERT OR REPLACE INTO offline_assessment_sync (assessment_id, user_email, last_sync_timestamp) VALUES (?, ?, ?);`,
      [assessmentId, userEmail, syncTimestamp]
    );
  } catch (error) {
    console.error('Failed to save sync timestamp:', error);
  }
};

export const getAssessmentsNeedingSync = async (
  userEmail: string,
  apiInstance: any
): Promise<{ missing: number[], outdated: number[] }> => {
  try {
    await initDb();
    const db = await getDb();
    
    // Get all assessment IDs for the user
    const allAssessments = await db.getAllAsync(
      `SELECT DISTINCT id FROM offline_assessments WHERE user_email = ?;`,
      [userEmail]
    );
    
    // Get assessments with detailed data and sync timestamps
    const assessmentsWithData = await db.getAllAsync(
      `SELECT assessment_id, last_sync_timestamp FROM offline_assessment_sync WHERE user_email = ?;`,
      [userEmail]
    );
    
    const allAssessmentIds = allAssessments.map((row: any) => row.id);
    const syncedAssessmentIds = assessmentsWithData.map((row: any) => row.assessment_id);
    
    // Find missing assessments (never synced)
    const missingAssessments = allAssessmentIds.filter(
      id => !syncedAssessmentIds.includes(id)
    );
    
    // Check for outdated assessments by comparing server timestamps
    const outdatedAssessments = [];
    
    for (const syncedAssessment of assessmentsWithData) {
      try {
        // Get server's last modified timestamp for this assessment
        const response = await apiInstance.get(`/assessments/${syncedAssessment.assessment_id}/last-modified`);
        const serverTimestamp = response.data.last_modified;
        
        // Compare with local sync timestamp
        if (new Date(serverTimestamp) > new Date(syncedAssessment.last_sync_timestamp)) {
          outdatedAssessments.push(syncedAssessment.assessment_id);
        }
      } catch (error) {
        console.warn(`Failed to check timestamp for assessment ${syncedAssessment.assessment_id}`);
      }
    }
    
    return {
      missing: missingAssessments,
      outdated: outdatedAssessments
    };
    
  } catch (error) {
    console.error('Failed to check assessments needing sync:', error);
    return { missing: [], outdated: [] };
  }
};

export const syncAllAssessmentDetails = async (
  userEmail: string,
  apiInstance: any,
  onProgress?: (current: number, total: number, type: 'missing' | 'updating') => void
): Promise<{ success: number, failed: number, updated: number }> => {
  try {
    const { missing, outdated } = await getAssessmentsNeedingSync(userEmail, apiInstance);
    const totalAssessments = missing.length + outdated.length;
    
    if (totalAssessments === 0) {
      return { success: 0, failed: 0, updated: 0 };
    }
    
    let successCount = 0;
    let failedCount = 0;
    let updatedCount = 0;
    let currentIndex = 0;
    
    // Process missing assessments first
    for (const assessmentId of missing) {
      currentIndex++;
      if (onProgress) {
        onProgress(currentIndex, totalAssessments, 'missing');
      }
      
      const result = await downloadSingleAssessmentDetails(assessmentId, userEmail, apiInstance);
      if (result.success) {
        successCount++;
        // Save sync timestamp
        await saveAssessmentSyncTimestamp(assessmentId, userEmail, new Date().toISOString());
      } else {
        failedCount++;
      }
    }
    
    // Process outdated assessments
    for (const assessmentId of outdated) {
      currentIndex++;
      if (onProgress) {
        onProgress(currentIndex, totalAssessments, 'updating');
      }
      
      const result = await downloadSingleAssessmentDetails(assessmentId, userEmail, apiInstance);
      if (result.success) {
        successCount++;
        updatedCount++;
        // Update sync timestamp
        await saveAssessmentSyncTimestamp(assessmentId, userEmail, new Date().toISOString());
      } else {
        failedCount++;
      }
    }
    
    return { success: successCount, failed: failedCount, updated: updatedCount };
    
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
};

const downloadSingleAssessmentDetails = async (
  assessmentId: number,
  userEmail: string,
  apiInstance: any
): Promise<{ success: boolean }> => {
  try {
    const db = await getDb();
    const assessmentResult = await db.getFirstAsync(
      `SELECT type FROM offline_assessments WHERE id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );
    
    if (!assessmentResult) {
      return { success: false };
    }
    
    const assessmentType = (assessmentResult as any).type;
    let attemptStatus = null;
    let latestSubmission = null;
    
    // Fetch attempt status for quiz/exam types
    if (assessmentType === 'quiz' || assessmentType === 'exam') {
      try {
        const attemptResponse = await apiInstance.get(`/assessments/${assessmentId}/attempt-status`);
        if (attemptResponse.status === 200) {
          attemptStatus = attemptResponse.data;
        }
      } catch (error) {
        console.warn(`Failed to fetch attempt status for assessment ${assessmentId}`);
      }
    }
    
    // Fetch latest submission for assignment types
    if (['assignment', 'activity', 'project'].includes(assessmentType)) {
      try {
        const submissionResponse = await apiInstance.get(`/assessments/${assessmentId}/latest-assignment-submission`);
        if (submissionResponse.status === 200) {
          latestSubmission = submissionResponse.data;
        }
      } catch (error) {
        console.warn(`Failed to fetch submission for assessment ${assessmentId}`);
      }
    }
    
    await saveAssessmentDetailsToDb(assessmentId, userEmail, attemptStatus, latestSubmission);
    return { success: true };
    
  } catch (error) {
    console.error(`Failed to download details for assessment ${assessmentId}:`, error);
    return { success: false };
  }
};


// QUIZZES

export const fixQuizQuestionsTable = async (): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    
    console.log('🔧 Fixing offline_quiz_questions table structure...');
    
    // Drop the existing table if it exists
    await db.execAsync(`DROP TABLE IF EXISTS offline_quiz_questions;`);
    
    // Create the table with correct structure
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS offline_quiz_questions (
        id INTEGER PRIMARY KEY NOT NULL,
        user_email TEXT NOT NULL,
        assessment_id INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        question_type TEXT NOT NULL,
        options TEXT,
        correct_answer TEXT,
        points INTEGER,
        order_index INTEGER,
        question_data TEXT NOT NULL,
        FOREIGN KEY (assessment_id, user_email) REFERENCES offline_assessment_data(assessment_id, user_email) ON DELETE CASCADE
      );`
    );
    
    console.log('✅ offline_quiz_questions table structure fixed');
  } catch (error) {
    console.error('❌ Failed to fix quiz questions table:', error);
    throw error;
  }
};

export const saveQuizQuestionsToDb = async (
  assessmentId: number,
  userEmail: string,
  questions: any[]
): Promise<void> => {
  if (!questions || questions.length === 0) {
    return;
  }
  
  try {
    await initDb();
    const db = await getDb();
    
    console.log(`🧠 Saving ${questions.length} quiz questions for assessment ${assessmentId}`);
    
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `DELETE FROM offline_quiz_questions WHERE assessment_id = ? AND user_email = ?;`,
        [assessmentId, userEmail]
      );
      
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        
        const questionId = question.id || `${assessmentId}_${i + 1}`;
        
        let optionsToSave = null;
        // Improved options validation and sanitization
        if (question.options) {
          if (typeof question.options === 'string') {
            try {
              // Try to parse if it's already a JSON string
              JSON.parse(question.options);
              optionsToSave = question.options;
            } catch (e) {
              // If parsing fails, it means it's a plain string, so we'll skip it
              console.warn(`Invalid JSON string for question ${questionId} options:`, question.options);
              optionsToSave = null;
            }
          } else if (typeof question.options === 'object' && question.options !== null) {
            // It's an object/array, stringify it
            try {
              optionsToSave = JSON.stringify(question.options);
            } catch (e) {
              console.warn(`Failed to stringify options for question ${questionId}:`, question.options);
              optionsToSave = null;
            }
          } else {
            console.warn(`Invalid options data type for question ${questionId}:`, typeof question.options, question.options);
            optionsToSave = null;
          }
        }

        await db.runAsync(
          `INSERT INTO offline_quiz_questions 
           (id, user_email, assessment_id, question_text, question_type, options, correct_answer, points, order_index, question_data) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            questionId,
            userEmail,
            assessmentId,
            question.question || question.question_text || '',
            question.type || question.question_type || 'text',
            optionsToSave,
            question.correct_answer || null,
            question.points || question.point_value || 1,
            i + 1,
            JSON.stringify(question)
          ]
        );
      }
    });
    
    console.log(`✅ Saved ${questions.length} quiz questions for assessment ${assessmentId}`);
  } catch (error) {
    console.error(`❌ Failed to save quiz questions for assessment ${assessmentId}:`, error);
    throw error;
  }
};

export const hasQuizQuestionsSaved = async (
  assessmentId: number,
  userEmail: string
): Promise<boolean> => {
  try {
    const db = await getDb();
    const result = await db.getFirstAsync(
      `SELECT COUNT(*) as count FROM offline_quiz_questions 
       WHERE assessment_id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );
    return (result as any)?.count > 0;
  } catch (error) {
    console.error('Error checking quiz questions:', error);
    return false;
  }
};

export const getQuizQuestionsFromDb = async (
  assessmentId: number,
  userEmail: string
): Promise<any[]> => {
  try {
    const db = await getDb();
    const result = await db.getAllAsync(
      `SELECT question_data FROM offline_quiz_questions 
       WHERE assessment_id = ? AND user_email = ? 
       ORDER BY order_index ASC;`,
      [assessmentId, userEmail]
    );
    
    return result.map((row: any) => {
      try {
        const questionData = JSON.parse(row.question_data);
        
        // Ensure options are properly formatted for the UI
        if (questionData.options) {
          if (typeof questionData.options === 'string') {
            try {
              questionData.options = JSON.parse(questionData.options);
            } catch (e) {
              console.warn(`Failed to parse options for question ${questionData.id}, setting to empty array`);
              questionData.options = [];
            }
          }
        } else {
          questionData.options = [];
        }
        
        return questionData;
      } catch (e) {
        console.error('Failed to parse question data:', e);
        return null;
      }
    }).filter(Boolean); // Remove any null values
  } catch (error) {
    console.error(`❌ Failed to get quiz questions for assessment ${assessmentId}:`, error);
    return [];
  }
};

export const downloadAllQuizQuestions = async (
  userEmail: string,
  apiInstance: any,
  onProgress?: (current: number, total: number, skipped?: number) => void
): Promise<{ success: number, failed: number, skipped: number }> => {
  try {
    await initDb();
    const db = await getDb();
    
    // Get all quiz and exam type assessments
    const quizAssessments = await db.getAllAsync(
      `SELECT id FROM offline_assessments 
       WHERE user_email = ? AND (type = 'quiz' OR type = 'exam');`,
      [userEmail]
    );
    
    if (quizAssessments.length === 0) {
      console.log('No quiz/exam assessments found');
      return { success: 0, failed: 0, skipped: 0 };
    }
    
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    
    console.log(`Starting download of questions for ${quizAssessments.length} quiz/exam assessments`);
    
    for (let i = 0; i < quizAssessments.length; i++) {
      const assessment = quizAssessments[i];
      
      try {
        if (onProgress) {
          onProgress(i + 1, quizAssessments.length, skippedCount);
        }
        
        // Check if questions are already saved
        const hasQuestions = await hasQuizQuestionsSaved(assessment.id, userEmail);
        if (hasQuestions) {
          console.log(`Quiz questions for assessment ${assessment.id} already saved, skipping`);
          skippedCount++;
          continue;
        }
        
        // Fetch quiz questions from API
        const response = await apiInstance.get(`/assessments/${assessment.id}/questions`);
        
        if (response.status === 200 && response.data?.questions) {
          await saveQuizQuestionsToDb(assessment.id, userEmail, response.data.questions);
          successCount++;
          console.log(`Downloaded questions for assessment ${assessment.id}`);
        } else {
          console.warn(`No questions found for assessment ${assessment.id}`);
          failedCount++;
        }
        
      } catch (error) {
        console.error(`Failed to download questions for assessment ${assessment.id}:`, error);
        failedCount++;
      }
    }
    
    console.log(`Quiz questions download completed: ${successCount} successful, ${failedCount} failed, ${skippedCount} skipped`);
    return { success: successCount, failed: failedCount, skipped: skippedCount };
    
  } catch (error) {
    console.error('Quiz questions download failed:', error);
    throw error;
  }
};

export const startOfflineQuiz = async (assessmentId: number, userEmail: string): Promise < void > => {
  try {
    await initDb();
    const db = await getDb();

    // Check if an attempt for this quiz already exists
    const existingAttempt = await db.getFirstAsync(
      `SELECT * FROM offline_quiz_attempts WHERE assessment_id = ? AND user_email = ? AND is_completed = 0;`,
      [assessmentId, userEmail]
    );

    if (existingAttempt) {
      console.log(`Quiz attempt for assessment ${assessmentId} by ${userEmail} is already in progress.`);
      return;
    }

    // Create a new entry in offline_quiz_attempts table
    await db.runAsync(
      `INSERT INTO offline_quiz_attempts (assessment_id, user_email, start_time, answers, is_completed)
       VALUES (?, ?, ?, ?, ?);`,
      [
        assessmentId,
        userEmail,
        new Date().toISOString(), // Store the start time
        JSON.stringify({}), // Initialize with an empty JSON object for answers
        0 // 0 for incomplete
      ]
    );

    console.log(`✅ Started offline quiz for assessment ${assessmentId}.`);
  } catch (error) {
    console.error(`❌ Failed to start offline quiz for assessment ${assessmentId}:`, error);
    throw error;
  }
};

export const getOfflineQuizAnswers = async (assessmentId: number, userEmail: string): Promise < any > => {
  try {
    await initDb();
    const db = await getDb();
    const result = await db.getFirstAsync(
      `SELECT answers FROM offline_quiz_attempts WHERE assessment_id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );
    if (result && result.answers) {
      return JSON.parse(result.answers);
    }
    return {};
  } catch (error) {
    console.error('❌ Failed to retrieve offline quiz answers:', error);
    return {};
  }
};

export const updateOfflineQuizAnswers = async (assessmentId: number, userEmail: string, answers: any): Promise < void > => {
  try {
    await initDb();
    const db = await getDb();
    await db.runAsync(
      `UPDATE offline_quiz_attempts SET answers = ? WHERE assessment_id = ? AND user_email = ?;`,
      [
        JSON.stringify(answers),
        assessmentId,
        userEmail
      ]
    );
    console.log(`✅ Updated answers for offline quiz ${assessmentId}.`);
  } catch (error) {
    console.error('❌ Failed to update offline quiz answers:', error);
    throw error;
  }
};

export const getOfflineQuizAttemptStatus = async (assessmentId: number, userEmail: string): Promise < string > => {
  try {
    await initDb();
    const db = await getDb();
    const result = await db.getFirstAsync(
      `SELECT is_completed FROM offline_quiz_attempts WHERE assessment_id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );
    if (result === undefined) {
      return 'not_started';
    } else if (result.is_completed === 0) {
      return 'in_progress';
    } else {
      return 'completed';
    }
  } catch (error) {
    console.error('❌ Failed to get quiz attempt status:', error);
    return 'error';
  }
};

export const submitOfflineQuiz = async (assessmentId: number, userEmail: string, answers: StudentAnswers): Promise<void> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    const now = new Date().toISOString();
    
    console.log(`📝 Submitting offline quiz for assessment ${assessmentId}`);
    
    await db.withTransactionAsync(async () => {
      // 1. Get all original questions for this quiz from the local DB
      const questions = await getQuizQuestionsFromDb(assessmentId, userEmail);
      const questionsMap: Record<number, any> = {};
      questions.forEach(q => {
        // The question data is already parsed by getQuizQuestionsFromDb
        questionsMap[q.id] = q;
      });
      
      // 2. Create the main attempt record
      const attemptResult = await db.runAsync(
        `INSERT INTO offline_quiz_attempts (assessment_id, user_email, start_time, end_time, answers, is_completed) VALUES (?, ?, ?, ?, ?, ?);`,
        [assessmentId, userEmail, now, now, JSON.stringify(answers), 1]
      );
      const attemptId = attemptResult.lastInsertRowId;

      if (!attemptId) {
        throw new Error("Failed to create quiz attempt record.");
      }
      console.log(`Created offline attempt with ID: ${attemptId}`);
      
      // 3. Loop through the student's answers and save each one
      for (const questionIdStr in answers) {
        if (!answers.hasOwnProperty(questionIdStr)) continue;
        
        const questionId = Number(questionIdStr);
        const studentAnswer = answers[questionId];
        const originalQuestion = questionsMap[questionId];
        
        if (!originalQuestion) {
          console.warn(`Original question data not found for question ID: ${questionId}. Skipping.`);
          continue;
        }
        
        // Ensure max_points has a valid value, defaulting to 1
        const maxPoints = originalQuestion.points ?? originalQuestion.max_points ?? 1;
        
        // 4. Insert the submission for the question
        const questionSubmissionResult = await db.runAsync(
          `INSERT INTO offline_quiz_question_submissions (attempt_id, question_id, submitted_answer, max_points) VALUES (?, ?, ?, ?);`,
          [
            attemptId, 
            questionId, 
            JSON.stringify(studentAnswer.answer), // Store the raw answer
            maxPoints
          ]
        );
        const submissionId = questionSubmissionResult.lastInsertRowId;

        if (!submissionId) {
          throw new Error(`Failed to create submission record for question ${questionId}.`);
        }
        
        // 5. If it's a multiple-choice or true/false, save the state of ALL options
        if (studentAnswer.type === 'multiple_choice' || studentAnswer.type === 'true_false') {
          const selectedOptionIds = Array.isArray(studentAnswer.answer) ? studentAnswer.answer : [studentAnswer.answer];
          const originalOptions = originalQuestion.options || [];
          
          for (const option of originalOptions) {
            const isSelected = selectedOptionIds.includes(option.id);
            // Ensure is_correct_option has a value (0 or 1)
            const isCorrect = option.is_correct ? 1 : 0;
            
            await db.runAsync(
              `INSERT INTO offline_quiz_option_selections (submission_id, option_id, option_text, is_selected, is_correct_option) VALUES (?, ?, ?, ?, ?);`,
              [
                submissionId, 
                option.id, 
                option.option_text || '', 
                isSelected ? 1 : 0, 
                isCorrect
              ]
            );
          }
        }
      }
    });
    
    console.log(`✅ Successfully submitted offline quiz for assessment ${assessmentId}`);
  } catch (error) {
    console.error(`❌ Failed to submit offline quiz: ${error}`);
    throw error;
  }
};

export const getCompletedOfflineQuizzes = async (userEmail: string): Promise<any[]> => {
  try {
    await initDb();
    const db = await getDb();
    
    const quizAttempts = await db.getAllAsync(
      `SELECT 
        attempt_id, 
        assessment_id, 
        user_email, 
        start_time, 
        end_time, 
        answers 
       FROM offline_quiz_attempts 
       WHERE user_email = ? AND is_completed = 1 AND end_time IS NOT NULL;`,
      [userEmail]
    );
    
    console.log(`📊 Found ${quizAttempts.length} completed offline quizzes ready for sync`);
    return quizAttempts;
  } catch (error) {
    console.error('❌ Failed to get completed offline quizzes:', error);
    return [];
  }
};

export const deleteOfflineQuizAttempt = async (attemptId: number): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    console.log(`ðŸ”§ Deleting synced offline quiz attempt with ID: ${attemptId}`);

    await db.runAsync(
      `DELETE FROM offline_quiz_attempts WHERE attempt_id = ?;`,
      [attemptId]
    );

    console.log(`âœ… Successfully deleted offline quiz attempt with ID: ${attemptId}`);
  } catch (error) {
    console.error(`â Œ Failed to delete offline quiz attempt with ID ${attemptId}:`, error);
    throw error;
  }
};





export const getCurrentServerTime = async (userEmail: string): Promise<string> => {
  try {
    // First check for time manipulation
    const timeCheck = await detectTimeManipulation(userEmail);
    if (!timeCheck.isValid) {
      console.warn('âš ï¸ Time manipulation detected, using fallback time');
      return new Date().toISOString(); // Fallback to local time
    }

    // Get the calculated server time
    const serverTime = await getSavedServerTime(userEmail);
    if (serverTime) {
      console.log('ðŸ•’ Using calculated server time:', serverTime);
      return serverTime;
    } else {
      console.warn('âš ï¸ No server time data available, using local time');
      return new Date().toISOString();
    }
  } catch (error) {
    console.error('âŒ Error getting current server time:', error);
    return new Date().toISOString(); // Fallback to local time
  }
};

export const getUnsyncedSubmissions = async (userEmail: string) => {
  try {
    await initDb();
    const db = await getDb();
    const result = await db.getAllAsync(
      `SELECT * FROM offline_submissions WHERE user_email = ? AND submission_status = 'to sync';`,
      [userEmail]
    );
    console.log(`ðŸ” Found ${result.length} unsynced submissions for user ${userEmail}`);
    return result;
  } catch (error) {
    console.error('âŒ Failed to get unsynced submissions:', error);
    return [];
  }
};

export const deleteOfflineSubmission = async (id: number) => {
  try {
    await initDb();
    const db = await getDb();
    console.log(`ðŸ—‘ï¸ Deleting offline submission with ID: ${id}`);
    await db.runAsync(`DELETE FROM offline_submissions WHERE id = ?;`, [id]);
    console.log(`âœ… Offline submission ID ${id} deleted successfully.`);
  } catch (error) {
    console.error(`âŒ Failed to delete offline submission ID ${id}:`, error);
    throw error;
  }
};

export const clearAllData = async (): Promise<void> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    console.log('ðŸ—‘ï¸ Clearing all local data...');
    
    // --- MODIFIED: Removed the now-obsolete `offline_users` table from the clear logic.
    await db.execAsync(`DELETE FROM offline_courses;`);
    await db.execAsync(`DELETE FROM offline_course_details;`);
    await db.execAsync(`DELETE FROM time_check_logs;`);
    
    console.log('âœ… All local data cleared.');
  } catch (error) {
    console.error('âŒ Failed to clear local data:', error);
    throw error;
  }
};

export const closeDatabase = async (): Promise<void> => {
  try {
    if (dbInstance) {
      await dbInstance.closeAsync();
      dbInstance = null;
      dbInitialized = false;
      console.log('âœ… Database closed successfully');
    }
  } catch (error) {
    console.error('âŒ Failed to close database:', error);
  }
};

export const resetDatabaseState = (): void => {
  dbInstance = null;
  dbInitialized = false;
  initializationPromise = null;
  console.log('ðŸ”„ Database state reset');
};


export const clearOfflineData = async (): Promise<void> => {
    try {
        const db = await getDb();
        console.log('ðŸ—‘ï¸ Clearing all offline data...');
        // Delete all data from all offline tables
        await db.execAsync(`DELETE FROM offline_courses;`);
        await db.execAsync(`DELETE FROM offline_course_details;`);
        await db.execAsync(`DELETE FROM offline_materials;`);
        await db.execAsync(`DELETE FROM offline_assessments;`);
        await db.execAsync(`DELETE FROM app_state;`); 
        await db.execAsync(`DELETE FROM offline_assessment_data;`);
        console.log('âœ… All offline data cleared successfully.');
    } catch (error) {
        console.error('âŒ Error clearing offline data:', error);
    }
}

export const deleteAssessmentDetails = async (assessmentId: number, userEmail: string): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    
    console.log(`ðŸ—‘ï¸ Deleting detailed assessment data for assessment ID: ${assessmentId} and user: ${userEmail}`);

    await db.runAsync(
      `DELETE FROM offline_assessment_data WHERE assessment_id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );
    await db.runAsync(
      `DELETE FROM offline_assessments WHERE id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );

    console.log('âœ… Detailed assessment and base data deleted successfully.');
  } catch (error) {
    console.error('âŒ Failed to delete detailed assessment data:', error);
    throw error;
  }
};



{/* SERVER ONLY FOR OFFLINE USE */}

export const saveServerTime = async (userEmail: string, apiServerTime: string, currentDeviceTime: string): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    
    // Calculate the time offset
    const serverTimeMs = new Date(apiServerTime).getTime();
    const deviceTimeMs = new Date(currentDeviceTime).getTime();
    const serverTimeOffset = serverTimeMs - deviceTimeMs;

    console.log('ðŸ’¾ Saving server time, device time, and offset to local DB.');
    // Correctly update the `app_state` table, not `offline_users`
    await db.runAsync(
      `INSERT OR REPLACE INTO app_state (
         user_email, 
         server_time, 
         server_time_offset, 
         last_time_check, 
         time_check_sequence
       ) VALUES (?, ?, ?, ?, ?);`,
      [
        userEmail, 
        apiServerTime, 
        serverTimeOffset, 
        deviceTimeMs, // Store the device time at the point of sync
        1, // Reset sequence on every new login
      ]
    );
    console.log('âœ… Server time and offset saved successfully.');
  } catch (error) {
    console.error('âŒ Failed to save server time and offset:', error);
    throw error;
  }
};

export const getSavedServerTime = async (userEmail: string): Promise<string | null> => {
  try {
    await initDb();
    const db = await getDb();
    
    console.log('ðŸ” Retrieving server time and offset from local DB...');
    
    const result = await db.getAllAsync(
      `SELECT last_time_check, server_time_offset FROM app_state WHERE user_email = ?;`,
      [userEmail]
    );
    
    if (!result || result.length === 0 || result[0].last_time_check === null) {
        console.log('â³ No prior time check data found for offset calculation, assuming valid.');
        return null;
    }
    
    // Check for time manipulation before proceeding
    const timeCheck = await detectTimeManipulation(userEmail);
    if (!timeCheck.isValid) {
        console.warn('âš ï¸ Time manipulation detected. Returning null.');
        return null;
    }
    
    // Calculate the simulated server time
    const serverTimeOffset = result[0].server_time_offset;
    const currentDeviceTimeMs = Date.now();
    const simulatedServerTimeMs = currentDeviceTimeMs + serverTimeOffset;

    // Return the calculated time in a readable format
    return new Date(simulatedServerTimeMs).toISOString();
  } catch (error) {
    console.error('âŒ Failed to retrieve and calculate server time:', error);
    return null;
  }
};

export const resetTimeCheckData = async (userEmail: string) => {
  try {
    console.log('ðŸ”„ Resetting time check data for user:', userEmail);
    const db = await getDb();
    
    // Update the app_state table with fresh time data.
    await db.runAsync(
      `INSERT OR REPLACE INTO app_state (user_email, last_time_check, server_time_offset) 
       VALUES (?, ?, ?);`,
      [userEmail, Date.now(), 0]
    );

    console.log('âœ… Time check data reset successfully.');
  } catch (error) {
    console.error('âŒ Failed to reset time check data:', error);
    // You might want to handle this error, but for now, just log it.
  }
};

export const detectTimeManipulation = async (userEmail: string): Promise<{ isValid: boolean, reason?: string }> => {
  try {
    await initDb();
    const db = await getDb();
    const result = await db.getAllAsync(
      `SELECT last_time_check, server_time_offset FROM app_state WHERE user_email = ?;`,
      [userEmail]
    );

    // This is the crucial part that ensures a fresh start.
    if (!result || result.length === 0 || !result[0].last_time_check) {
      console.log('â³ No prior time check data found, assuming valid.');
      return { isValid: true };
    }
    
    const lastDeviceTimeMs = result[0].last_time_check;
    const serverTimeOffset = result[0].server_time_offset;
    const currentDeviceTimeMs = Date.now();
    
    const expectedServerTimeMs = currentDeviceTimeMs + serverTimeOffset;
    
    if (currentDeviceTimeMs < lastDeviceTimeMs) {
      return { isValid: false, reason: 'Device time moved backward.' };
    }
    
    // Calculate the elapsed time in milliseconds on the device
    const timeElapsed = currentDeviceTimeMs - lastDeviceTimeMs;
    
    if (timeElapsed > (5 * 60 * 1000) && lastDeviceTimeMs !== 0) { // 5 minutes tolerance
      return { isValid: false, reason: 'Device time jumped forward excessively.' };
    }
    
    console.log(`âœ… Time check successful for ${userEmail}.`);
    return { isValid: true };
    
  } catch (error) {
    console.error('âŒ Error in time manipulation detection:', error);
    // If the check itself fails, we must assume a malicious attempt or a critical error
    return { isValid: false, reason: 'System error during time check. Please reconnect to the internet.' };
  }
};

export const updateTimeSync = async (userEmail: string): Promise<void> => {
    try {
        await initDb();
        const db = await getDb();

        const timeCheck = await detectTimeManipulation(userEmail);
        if (!timeCheck.isValid) {
            console.warn('âš ï¸ Cannot update time sync due to detected manipulation.');
            return;
        }

        // Correctly query the `app_state` table
        const result = await db.getAllAsync(
            `SELECT time_check_sequence FROM app_state WHERE user_email = ?;`,
            [userEmail]
        );
        const currentSequence = result[0]?.time_check_sequence || 0;
        const newSequence = currentSequence + 1;
        
        // Correctly update the `app_state` table
        await db.runAsync(
            `UPDATE app_state SET last_time_check = ?, time_check_sequence = ? WHERE user_email = ?;`,
            [Date.now(), newSequence, userEmail]
        );
        console.log(`âœ… Time sync updated for ${userEmail}. Sequence: ${newSequence}`);
    } catch (error) {
        console.error('âŒ Error updating time sync:', error);
    }
};