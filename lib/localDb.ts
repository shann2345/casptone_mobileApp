// lib/localDb.ts - Fixed multi-account offline system with proper DB management

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

const getDb = async (): Promise<SQLite.SQLiteDatabase> => {
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

// Hash password for secure storage (simple hash - in production use bcrypt or similar)
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
  // If already initialized, return immediately
  if (dbInitialized && dbInstance) {
    console.log('✅ Database already initialized');
    return;
  }

  // If initialization is already in progress, wait for it
  if (initializationPromise) {
    console.log('⏳ Database initialization in progress, waiting...');
    await initializationPromise;
    return;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      console.log('🔧 Initializing database...');
      const db = await getDb();

      // Create offline_users table
      console.log('📋 Creating offline_users table...');
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
          is_verified INTEGER DEFAULT 0
        );`
      );

      // MIGRATION: Add user_email column if missing
      const columns = await db.getAllAsync(
        `PRAGMA table_info(offline_courses);`
      );
      const hasUserEmail = columns.some((col: any) => col.name === 'user_email');
      if (!hasUserEmail) {
        console.log('⚠️ Migrating offline_courses table: adding user_email column...');
        await db.execAsync(`ALTER TABLE offline_courses ADD COLUMN user_email TEXT;`);
      }

      // Create offline_courses table (if not exists)
      console.log('📋 Creating offline_courses table...');
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

// Save user account for offline access (called after successful online login)
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
         last_login = ?, login_count = login_count + 1, is_verified = ?
         WHERE email = ?;`,
        [
          user.name,
          passwordHash,
          JSON.stringify(user),
          currentTime,
          currentTime,
          isVerified,
          user.email
        ]
      );
      console.log('✅ Updated existing offline user:', user.email);
    } else {
      // Insert new user
      await db.runAsync(
        `INSERT INTO offline_users
         (id, name, email, password_hash, user_data, created_at, updated_at, last_login, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          user.id.toString(),
          user.name,
          user.email,
          passwordHash,
          JSON.stringify(user),
          user.created_at || currentTime,
          currentTime,
          currentTime,
          isVerified
        ]
      );
      console.log('✅ Saved new offline user:', user.email);
    }
  } catch (error) {
    console.error('❌ Failed to save user for offline access:', error);
    throw error;
  }
};

// Validate offline login credentials
export const validateOfflineLogin = async (email: string, password: string) => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    console.log('🔍 Validating offline login for:', email);
    
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

// Get all offline users (for account switching UI)
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

// Save an enrolled course to the local database
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

// Get enrolled courses from the local database
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

// Clear all data from tables (e.g., on logout)
export const clearAllData = async (): Promise<void> => {
  try {
    await initDb(); // Ensure DB is initialized
    const db = await getDb();
    
    console.log('🗑️ Clearing all local data...');
    
    await db.execAsync(`DELETE FROM offline_users;`);
    await db.execAsync(`DELETE FROM offline_courses;`);
    
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

// Helper function to close database (call this when app is closing)
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

// Helper function to reset database state (useful for debugging)
export const resetDatabaseState = (): void => {
  dbInstance = null;
  dbInitialized = false;
  initializationPromise = null;
  console.log('🔄 Database state reset');
};