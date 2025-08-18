import * as Crypto from 'expo-crypto';
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

const hashPassword = async (password: string): Promise<string> => {
  try {
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      password + '_salt_key' // Add salt for security
    );
  } catch (error) {
    console.error('❌ Failed to hash password:', error);
    throw error;
  }
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
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_users (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          user_data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_login TEXT,
          login_count INTEGER DEFAULT 1,
          is_verified INTEGER DEFAULT 0,
          server_time TEXT,
          server_time_offset INTEGER,
          last_time_check INTEGER,
          time_check_sequence INTEGER DEFAULT 0
        );`
      );
      
      // Add new columns for time manipulation detection if they don't exist
      let userColumns = await db.getAllAsync(`PRAGMA table_info(offline_users);`);
      let hasServerTime = userColumns.some((col: any) => col.name === 'server_time');
      let hasServerTimeOffset = userColumns.some((col: any) => col.name === 'server_time_offset');
      let hasLastTimeCheck = userColumns.some((col: any) => col.name === 'last_time_check');
      let hasTimeCheckSequence = userColumns.some((col: any) => col.name === 'time_check_sequence');
      
      if (!hasServerTime) {
        await db.execAsync(`ALTER TABLE offline_users ADD COLUMN server_time TEXT;`);
      }
      if (!hasServerTimeOffset) {
        await db.execAsync(`ALTER TABLE offline_users ADD COLUMN server_time_offset INTEGER;`);
      }
      if (!hasLastTimeCheck) {
        await db.execAsync(`ALTER TABLE offline_users ADD COLUMN last_time_check INTEGER;`);
      }
      if (!hasTimeCheckSequence) {
        await db.execAsync(`ALTER TABLE offline_users ADD COLUMN time_check_sequence INTEGER DEFAULT 0;`);
      }
      
      let courseColumns = await db.getAllAsync(
        `PRAGMA table_info(offline_courses);`
      );
      let hasUserEmail = courseColumns.some((col: any) => col.name === 'user_email');
      if (!hasUserEmail) {
        console.log('⚠️ Migrating offline_courses table: adding user_email column...');
        await db.execAsync(`ALTER TABLE offline_courses ADD COLUMN user_email TEXT;`);
        console.log('✅ Added user_email column to offline_courses table');
      }
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
      let detailColumns = await db.getAllAsync(
        `PRAGMA table_info(offline_course_details);`
      );
      let hasDetailUserEmail = detailColumns.some((col: any) => col.name === 'user_email');
      let hasCourseData = detailColumns.some((col: any) => col.name === 'course_data');
      if (!hasDetailUserEmail) {
        await db.execAsync(`ALTER TABLE offline_course_details ADD COLUMN user_email TEXT;`);
        console.log('⚠️ Migrated offline_course_details table: added user_email column.');
      }
      if (!hasCourseData) {
        await db.execAsync(`ALTER TABLE offline_course_details ADD COLUMN course_data TEXT;`);
        console.log('⚠️ Migrated offline_course_details table: added course_data column.');
      }
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_course_details (
          course_id INTEGER NOT NULL,
          user_email TEXT NOT NULL,
          course_data TEXT NOT NULL,
          PRIMARY KEY (course_id, user_email)
        );`
      );

      // Check if `material_data` column exists in `offline_materials`
      let materialColumns = await db.getAllAsync(
        `PRAGMA table_info(offline_materials);`
      );
      let hasMaterialData = materialColumns.some((col: any) => col.name === 'material_data');

      // If `material_data` does not exist, add it.
      if (!hasMaterialData) {
        // You can either rename the `content` column or add a new `material_data` column.
        // Assuming `material_data` replaces `content` for simplicity and to match the error.
        // To be safe, let's add a new one. The NOT NULL constraint will be handled by the insertion logic.
        await db.execAsync(
          `ALTER TABLE offline_materials ADD COLUMN material_data TEXT;`
        );
        console.log('⚠️ Migrated offline_materials table: added material_data column.');
      }

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

      // FIXED: Check and add missing columns for the offline_assessments table
      let assessmentColumns = await db.getAllAsync(
        `PRAGMA table_info(offline_assessments);`
      );
      let hasAssessmentFilePath = assessmentColumns.some((col: any) => col.name === 'assessment_file_path');
      let hasAssessmentFileUrl = assessmentColumns.some((col: any) => col.name === 'assessment_file_url');
      let hasPoints = assessmentColumns.some((col: any) => col.name === 'points');

      if (!hasAssessmentFilePath) {
        await db.execAsync(`ALTER TABLE offline_assessments ADD COLUMN assessment_file_path TEXT;`);
        console.log('⚠️ Migrated offline_assessments table: added assessment_file_path column.');
      }
      if (!hasAssessmentFileUrl) {
        await db.execAsync(`ALTER TABLE offline_assessments ADD COLUMN assessment_file_url TEXT;`);
        console.log('⚠️ Migrated offline_assessments table: added assessment_file_url column.');
      }
      if (!hasPoints) {
        await db.execAsync(`ALTER TABLE offline_assessments ADD COLUMN points INTEGER;`);
        console.log('⚠️ Migrated offline_assessments table: added points column.');
      }
      
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_assessments (
          id INTEGER PRIMARY KEY NOT NULL,
          user_email TEXT NOT NULL,
          course_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          available_at TEXT,
          unavailable_at TEXT,
          max_attempts INTEGER,
          duration_minutes INTEGER,
          assessment_file_path TEXT,
          assessment_file_url TEXT,
          points INTEGER,
          FOREIGN KEY (course_id, user_email) REFERENCES offline_course_details(course_id, user_email) ON DELETE CASCADE
        );`
      );
      
      // Create a new table to store additional, dynamic assessment data
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS offline_assessment_data (
          assessment_id INTEGER NOT NULL,
          user_email TEXT NOT NULL,
          data TEXT NOT NULL, -- This will store the JSON object for attempt status and latest submission
          PRIMARY KEY (assessment_id, user_email),
          FOREIGN KEY (assessment_id, user_email) REFERENCES offline_assessments(id, user_email) ON DELETE CASCADE
        );`
      );
      
      // Create time check logs table for additional security
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS time_check_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          device_time INTEGER NOT NULL,
          expected_time INTEGER NOT NULL,
          time_diff INTEGER NOT NULL,
          is_valid INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );`
      );
      
      dbInitialized = true;
      console.log('✅ Multi-user offline tables created successfully');
    } catch (error) {
      console.error('❌ Failed to create offline tables:', error);
      dbInstance = null;
      dbInitialized = false;
      throw error;
    }
  })();
  await initializationPromise;
  initializationPromise = null;
};

export const saveUserForOfflineAccess = async (
  user: any,
  password: string // We need the plain password to hash and store
): Promise<void> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    console.log('💾 Saving user for offline access:', user.email);
    
    const passwordHash = await hashPassword(password);
    const currentTime = new Date().toISOString();
    const currentTimestamp = Date.now();
    const isVerified = user.email_verified_at ? 1 : 0;

    // Check if user already exists with proper error handling
    const existingUser = await db.getAllAsync(
      `SELECT * FROM offline_users WHERE email = ?;`,
      [user.email]
    );

    if (existingUser && existingUser.length > 0) {
      // Update existing user
      await db.runAsync(
        `UPDATE offline_users SET
         name = ?, password_hash = ?, user_data = ?, updated_at = ?,
         last_login = ?, login_count = login_count + 1, is_verified = ?,
         last_time_check = ?, time_check_sequence = 1
         WHERE email = ?;`,
        [
          user.name,
          passwordHash,
          JSON.stringify(user),
          currentTime,
          currentTime,
          isVerified,
          currentTimestamp,
          user.email
        ]
      );
      console.log('✅ Updated existing offline user:', user.email);
    } else {
      // Insert new user
      await db.runAsync(
        `INSERT INTO offline_users
         (id, name, email, password_hash, user_data, created_at, updated_at, last_login, is_verified, last_time_check, time_check_sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          user.id.toString(),
          user.name,
          user.email,
          passwordHash,
          JSON.stringify(user),
          user.created_at || currentTime,
          currentTime,
          currentTime,
          isVerified,
          currentTimestamp,
          1
        ]
      );
      console.log('✅ Saved new offline user:', user.email);
    }
  } catch (error) {
    console.error('❌ Failed to save user for offline access:', error);
    throw error;
  }
};

export const validateOfflineLogin = async (email: string, password: string) => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    console.log('🔍 Validating offline login for:', email);
    
    // First check for time manipulation
    const timeCheck = await detectTimeManipulation(email);
    if (!timeCheck.isValid) {
      console.log('❌ Time manipulation detected:', timeCheck.reason);
      return { 
        success: false, 
        user: null, 
        error: 'Time manipulation detected. Please connect to the internet to re-sync.' 
      };
    }
    
    const passwordHash = await hashPassword(password);
    const resultSet = await db.getAllAsync(
      `SELECT * FROM offline_users WHERE email = ? AND password_hash = ?;`,
      [email, passwordHash]
    );
    
    if (resultSet && resultSet.length > 0) {
      const user = resultSet[0] as any;
      
      // Update last login
      await db.runAsync(
        `UPDATE offline_users SET last_login = ?, login_count = login_count + 1 WHERE email = ?;`,
        [new Date().toISOString(), email]
      );
      
      console.log('✅ Offline login validated for:', email);
      
      // Return user data
      const userData = JSON.parse(user.user_data);
      return { 
        success: true, 
        user: userData, 
        loginCount: (user.login_count || 0) + 1 
      };
    } else {
      console.log('❌ Offline login failed for:', email);
      return { 
        success: false, 
        user: null, 
        error: 'Invalid email or password, or account not found offline.' 
      };
    }
  } catch (error) {
    console.error('❌ Offline login validation error:', error);
    return { 
      success: false, 
      user: null, 
      error: `Database error: ${error.message}` 
    };
  }
};

export const getAllOfflineUsers = async () => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    const resultSet = await db.getAllAsync(
      `SELECT id, name, email, last_login, login_count FROM offline_users ORDER BY last_login DESC;`
    );
    
    return resultSet || [];
  } catch (error) {
    console.error('❌ Failed to get all offline users:', error);
    return [];
  }
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
    
    await db.execAsync(`DELETE FROM offline_users;`);
    await db.execAsync(`DELETE FROM offline_courses;`);
    await db.execAsync(`DELETE FROM offline_course_details;`);
    await db.execAsync(`DELETE FROM time_check_logs;`);
    
    console.log('✅ All local data cleared.');
  } catch (error) {
    console.error('❌ Failed to clear local data:', error);
    throw error;
  }
};

export const hasOfflineAccount = async (email: string): Promise<boolean> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    const result = await db.getAllAsync(
      `SELECT id FROM offline_users WHERE email = ?;`,
      [email]
    );
    
    return (result && result.length > 0);
  } catch (error) {
    console.error('❌ hasOfflineAccount error:', error);
    return false;
  }
};

export const getOfflineAccountInfo = async (email: string): Promise<any | null> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    const result = await db.getAllAsync(
      `SELECT * FROM offline_users WHERE email = ?;`,
      [email]
    );
    
    return (result && result.length > 0) ? result[0] : null;
  } catch (error) {
    console.error('❌ getOfflineAccountInfo error:', error);
    return null;
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
    await db.runAsync(
      `UPDATE offline_users SET 
         server_time = ?, 
         server_time_offset = ?, 
         last_time_check = ?, 
         time_check_sequence = ? 
       WHERE email = ?;`,
      [
        apiServerTime, 
        serverTimeOffset, 
        deviceTimeMs, // Store the device time at the point of sync
        1,
        userEmail
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
      `SELECT last_time_check, server_time_offset FROM offline_users WHERE email = ?;`,
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

export const detectTimeManipulation = async (userEmail: string): Promise<{ isValid: boolean, reason?: string }> => {
  try {
    await initDb();
    const db = await getDb();
    const result = await db.getAllAsync(
      `SELECT last_time_check, server_time_offset FROM offline_users WHERE email = ?;`,
      [userEmail]
    );
    
    if (!result || result.length === 0 || !result[0].last_time_check) {
      console.log('⏳ No prior time check data found, assuming valid.');
      return { isValid: true };
    }
    
    const lastDeviceTimeMs = result[0].last_time_check;
    const serverTimeOffset = result[0].server_time_offset;
    const currentDeviceTimeMs = Date.now();
    
    // Calculate the expected device time based on the server time offset
    // This is the core of the new, more robust logic
    const expectedServerTimeMs = currentDeviceTimeMs + serverTimeOffset;
    
    // We compare the last saved device time to the current device time to detect backward travel
    if (currentDeviceTimeMs < lastDeviceTimeMs) {
      return { isValid: false, reason: 'Device time moved backward.' };
    }
    
    // Calculate the elapsed time in milliseconds on the device
    const timeElapsed = currentDeviceTimeMs - lastDeviceTimeMs;
    
    // Check if the device time has jumped forward excessively
    // We check against a small threshold to catch subtle manipulation
    if (timeElapsed > (5 * 60 * 1000) && lastDeviceTimeMs !== 0) { // 5 minutes tolerance
      // This is a new check for a small forward jump
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

        const result = await db.getAllAsync(
            `SELECT time_check_sequence FROM offline_users WHERE email = ?;`,
            [userEmail]
        );
        const currentSequence = result[0]?.time_check_sequence || 0;
        const newSequence = currentSequence + 1;
        
        await db.runAsync(
            `UPDATE offline_users SET last_time_check = ?, time_check_sequence = ? WHERE email = ?;`,
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
    
    await db.execAsync(
      `UPDATE offline_users SET 
       last_time_check = ?, 
       time_check_sequence = 0
       WHERE last_time_check IS NOT NULL;`
    );
    
    await db.execAsync(
      `DELETE FROM time_check_logs;`
    );
    
    console.log('✅ All time check data and logs have been cleared.');
  } catch (error) {
    console.error('❌ Error during emergency time reset:', error);
    throw error;
  }
};