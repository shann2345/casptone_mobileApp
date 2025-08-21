import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

const DB_NAME = 'multiuser.db';
const dbDirectory = `${FileSystem.documentDirectory}SQLite`;

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
    
    console.log('📂 Opening database:', DB_NAME);
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    console.log('✅ Database opened successfully');
    return db;
  } catch (error) {
    console.error('❌ Failed to open database:', error);
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
      console.log('🔧 Initializing database...');
      const db = await getDb();

      // Removed the creation of the offline_users table.
      // The app will no longer store user credentials locally for offline login.

      // Keep the tables for course and material data.
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_courses (
          id INTEGER PRIMARY KEY NOT NULL,
          user_email TEXT NOT NULL,
          title TEXT NOT NULL,
          course_code TEXT,
          description TEXT,
          program_id INTEGER,
          program_name TEXT,
          instructor_id INTEGER,
          instructor_name TEXT,
          status TEXT,
          enrollment_date TEXT NOT NULL
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_course_details (
          course_id INTEGER NOT NULL,
          user_email TEXT NOT NULL,
          course_data TEXT NOT NULL,
          PRIMARY KEY (course_id, user_email)
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_materials (
          id INTEGER PRIMARY KEY NOT NULL,
          user_email TEXT NOT NULL,
          course_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          file_path TEXT,
          content TEXT,
          material_type TEXT,
          created_at TEXT,
          available_at TEXT,
          unavailable_at TEXT,
          material_data TEXT NOT NULL,
          FOREIGN KEY (course_id, user_email) REFERENCES offline_course_details(course_id, user_email) ON DELETE CASCADE
        );`
      );
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_assessments (
          id INTEGER PRIMARY KEY NOT NULL,
          user_email TEXT NOT NULL,
          course_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          due_date TEXT NOT NULL,
          description TEXT,
          assessment_type TEXT,
          assessment_file_path TEXT,
          assessment_file_url TEXT,
          assessment_data TEXT NOT NULL,
          FOREIGN KEY (course_id, user_email) REFERENCES offline_course_details(course_id, user_email) ON DELETE CASCADE
        );`
      );

      // ADD THIS TABLE - This was missing and causing the error
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_assessment_data (
          assessment_id INTEGER NOT NULL,
          user_email TEXT NOT NULL,
          data TEXT NOT NULL,
          PRIMARY KEY (assessment_id, user_email)
        );`
      );

      // We still need a table to store server time, but for the logged-in user.
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS app_state (
            user_email TEXT PRIMARY KEY NOT NULL,
            server_time TEXT,
            server_time_offset INTEGER,
            last_time_check INTEGER,
            time_check_sequence INTEGER DEFAULT 0
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

export const saveCourseToDb = async (course: any, userEmail: string): Promise<void> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    console.log('💾 Saving course to local DB for user:', userEmail);
    
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
    
    console.log('✅ Saved course to local DB:', course.title);
  } catch (error) {
    console.error('❌ Failed to save course to local DB:', error);
    throw error;
  }
};

export const saveCourseDetailsToDb = async (course: any, userEmail: string): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    console.log('💾 Saving detailed course data for user:', userEmail, ' and course:', course.id);

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

    console.log('✅ Detailed course data saved successfully.');
  } catch (error) {
    console.error('❌ Failed to save detailed course data:', error);
    throw error;
  }
};

export const getCourseDetailsFromDb = async (courseId: number, userEmail: string): Promise<any | null> => {
  try {
    await initDb();
    const db = await getDb();

    console.log('🔍 Retrieving course details from local DB for course ID:', courseId);

    const result = await db.getAllAsync(
      `SELECT course_data FROM offline_course_details WHERE course_id = ? AND user_email = ?;`,
      [courseId, userEmail]
    );
    
    if (result && result.length > 0) {
      console.log('✅ Course details found in local DB.');
      return JSON.parse(result[0].course_data);
    }
    
    console.log('❌ Course details not found in local DB.');
    return null;
  } catch (error) {
    console.error('❌ Failed to get course details from local DB:', error);
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
    
    console.log(`✅ Retrieved ${courses.length} courses from local DB for user: ${userEmail}`);
    return courses;
  } catch (error) {
    console.error('❌ Failed to get enrolled courses from local DB:', error);
    return [];
  }
};

export const saveMaterialsToDb = async (materials: any[], courseId: number, userEmail: string): Promise<void> => {
  if (!materials || materials.length === 0) {
    return;
  }
  await initDb();
  const db = await getDb();
  console.log('💾 Saving materials for course:', courseId);

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
  console.log(`✅ Saved ${materials.length} materials for course ${courseId}`);
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
    console.error(`❌ Failed to get material ${materialId} from DB:`, error);
    return null;
  }
};

export const saveAssessmentsToDb = async (assessments: any[], courseId: number, userEmail: string): Promise<void> => {
  if (!assessments || assessments.length === 0) {
    return;
  }
  await initDb();
  const db = await getDb();
  console.log('💾 Saving assessments for course:', courseId);
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
  console.log(`✅ Saved ${assessments.length} assessments for course ${courseId}`);
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
    console.log('💾 Saving detailed assessment data for user:', userEmail, ' and assessment:', assessmentId);

    const assessmentData = {
      attemptStatus: attemptStatus || null,
      latestSubmission: latestSubmission || null,
    };

    await db.runAsync(
      `INSERT OR REPLACE INTO offline_assessment_data (assessment_id, user_email, data) VALUES (?, ?, ?);`,
      [assessmentId, userEmail, JSON.stringify(assessmentData)]
    );

    console.log('✅ Detailed assessment data saved successfully.');
  } catch (error) {
    console.error('❌ Failed to save detailed assessment data:', error);
    throw error;
  }
};

// Get all assessments that don't have detailed data saved
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
    
    console.log(`📊 Found ${assessmentsWithoutData.length} assessments without detailed data`);
    return assessmentsWithoutData;
  } catch (error) {
    console.error('❌ Failed to get assessments without details:', error);
    return [];
  }
};

// Check if assessment needs detailed data download
export const checkIfAssessmentNeedsDetails = async (assessmentId: number, userEmail: string): Promise<boolean> => {
  try {
    const db = await getDb();
    const result = await db.getFirstAsync(
      `SELECT COUNT(*) as count FROM offline_assessment_data WHERE assessment_id = ? AND user_email = ?;`,
      [assessmentId, userEmail]
    );
    return (result as any)?.count === 0;
  } catch (error) {
    console.error('❌ Error checking assessment details:', error);
    return true; // Assume it needs details if there's an error
  }
};

// Replace the downloadAllAssessmentDetails function in localDb.ts with this version:

export const downloadAllAssessmentDetails = async (
  userEmail: string, 
  apiInstance: any, // Pass api as parameter instead of requiring it
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number, failed: number }> => {
  try {
    const assessmentIds = await getAssessmentsWithoutDetails(userEmail);
    if (assessmentIds.length === 0) {
      console.log('✅ All assessments already have detailed data');
      return { success: 0, failed: 0 };
    }
    
    let successCount = 0;
    let failedCount = 0;
    
    console.log(`📥 Starting batch download for ${assessmentIds.length} assessments`);
    
    for (let i = 0; i < assessmentIds.length; i++) {
      const assessmentId = assessmentIds[i];
      
      try {
        if (onProgress) {
          onProgress(i + 1, assessmentIds.length);
        }
        
        let attemptStatus = null;
        let latestSubmission = null;
        
        const db = await getDb();
        const assessmentResult = await db.getFirstAsync(
          `SELECT type FROM offline_assessments WHERE id = ? AND user_email = ?;`,
          [assessmentId, userEmail]
        );
        
        if (!assessmentResult) {
          console.warn(`⚠️ Assessment ${assessmentId} not found in local DB`);
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
            console.warn(`⚠️ Failed to fetch attempt status for assessment ${assessmentId}`);
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
            console.warn(`⚠️ Failed to fetch submission for assessment ${assessmentId}`);
          }
        }
        
        await saveAssessmentDetailsToDb(assessmentId, userEmail, attemptStatus, latestSubmission);
        successCount++;
        
        console.log(`✅ Downloaded details for assessment ${assessmentId}`);
        
      } catch (error) {
        console.error(`❌ Failed to download details for assessment ${assessmentId}:`, error);
        failedCount++;
      }
    }
    
    console.log(`📥 Batch download completed: ${successCount} successful, ${failedCount} failed`);
    return { success: successCount, failed: failedCount };
    
  } catch (error) {
    console.error('❌ Batch download failed:', error);
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
    console.error(`❌ Failed to get assessment ${assessmentId} from DB:`, error);
    return null;
  }
};

export const clearAllData = async (): Promise<void> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    console.log('🗑️ Clearing all local data...');
    
    // --- MODIFIED: Removed the now-obsolete `offline_users` table from the clear logic.
    await db.execAsync(`DELETE FROM offline_courses;`);
    await db.execAsync(`DELETE FROM offline_course_details;`);
    await db.execAsync(`DELETE FROM time_check_logs;`);
    
    console.log('✅ All local data cleared.');
  } catch (error) {
    console.error('❌ Failed to clear local data:', error);
    throw error;
  }
};

export const closeDatabase = async (): Promise<void> => {
  try {
    if (dbInstance) {
      await dbInstance.closeAsync();
      dbInstance = null;
      dbInitialized = false;
      console.log('✅ Database closed successfully');
    }
  } catch (error) {
    console.error('❌ Failed to close database:', error);
  }
};

export const resetDatabaseState = (): void => {
  dbInstance = null;
  dbInitialized = false;
  initializationPromise = null;
  console.log('🔄 Database state reset');
};


export const clearOfflineData = async (): Promise<void> => {
    try {
        const db = await getDb();
        console.log('🗑️ Clearing all offline data...');
        // Delete all data from all offline tables
        await db.execAsync(`DELETE FROM offline_courses;`);
        await db.execAsync(`DELETE FROM offline_course_details;`);
        await db.execAsync(`DELETE FROM offline_materials;`);
        await db.execAsync(`DELETE FROM offline_assessments;`);
        await db.execAsync(`DELETE FROM app_state;`); // Clear the app state (server time) as well
        console.log('✅ All offline data cleared successfully.');
    } catch (error) {
        console.error('❌ Error clearing offline data:', error);
    }
}


{/* SERVER ONLY FOR OFFLINE USE */}

export const saveServerTime = async (userEmail: string, apiServerTime: string, currentDeviceTime: string): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    
    // Calculate the time offset
    const serverTimeMs = new Date(apiServerTime).getTime();
    const deviceTimeMs = new Date(currentDeviceTime).getTime();
    const serverTimeOffset = serverTimeMs - deviceTimeMs;

    console.log('💾 Saving server time, device time, and offset to local DB.');
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
    console.log('✅ Server time and offset saved successfully.');
  } catch (error) {
    console.error('❌ Failed to save server time and offset:', error);
    throw error;
  }
};

export const getSavedServerTime = async (userEmail: string): Promise<string | null> => {
  try {
    await initDb();
    const db = await getDb();
    
    console.log('🔍 Retrieving server time and offset from local DB...');
    
    const result = await db.getAllAsync(
      `SELECT last_time_check, server_time_offset FROM app_state WHERE user_email = ?;`,
      [userEmail]
    );
    
    if (!result || result.length === 0 || result[0].last_time_check === null) {
        console.log('⏳ No prior time check data found for offset calculation, assuming valid.');
        return null;
    }
    
    // Check for time manipulation before proceeding
    const timeCheck = await detectTimeManipulation(userEmail);
    if (!timeCheck.isValid) {
        console.warn('⚠️ Time manipulation detected. Returning null.');
        return null;
    }
    
    // Calculate the simulated server time
    const serverTimeOffset = result[0].server_time_offset;
    const currentDeviceTimeMs = Date.now();
    const simulatedServerTimeMs = currentDeviceTimeMs + serverTimeOffset;

    // Return the calculated time in a readable format
    return new Date(simulatedServerTimeMs).toISOString();
  } catch (error) {
    console.error('❌ Failed to retrieve and calculate server time:', error);
    return null;
  }
};

export const resetTimeCheckData = async (userEmail: string) => {
  try {
    console.log('🔄 Resetting time check data for user:', userEmail);
    const db = await getDb();
    
    // Update the app_state table with fresh time data.
    await db.runAsync(
      `INSERT OR REPLACE INTO app_state (user_email, last_time_check, server_time_offset) 
       VALUES (?, ?, ?);`,
      [userEmail, Date.now(), 0]
    );

    console.log('✅ Time check data reset successfully.');
  } catch (error) {
    console.error('❌ Failed to reset time check data:', error);
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
      console.log('⏳ No prior time check data found, assuming valid.');
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
    
    console.log(`✅ Time check successful for ${userEmail}.`);
    return { isValid: true };
    
  } catch (error) {
    console.error('❌ Error in time manipulation detection:', error);
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
            console.warn('⚠️ Cannot update time sync due to detected manipulation.');
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
        console.log(`✅ Time sync updated for ${userEmail}. Sequence: ${newSequence}`);
    } catch (error) {
        console.error('❌ Error updating time sync:', error);
    }
};

export const emergencyResetTimeDetection = async (): Promise<void> => {
  try {
    await initDb();
    const db = await getDb();
    
    console.log('🚨 Emergency reset of ALL time detection data');
    
    // Removed all queries related to `offline_users` and `time_check_logs` as they are now obsolete.
    await db.execAsync(
      `DELETE FROM app_state;`
    );
    
    console.log('✅ All time detection data cleared.');
  } catch (error) {
    console.error('❌ Failed to clear time detection data:', error);
    throw error;
  }
};
