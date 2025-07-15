// lib/database.ts

// UPDATED IMPORT: Use the new Expo SQLite API
import * as SQLite from 'expo-sqlite';

// Open or create the database using the new API
const db = SQLite.openDatabaseSync('lms.db');

// Initialize the database: create tables if they don't exist
export const initDatabase = async (): Promise<void> => {
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT
      );
    `);
    console.log('Users table created or already exists.');
  } catch (error) {
    console.error('Error creating users table:', error);
    throw error;
  }
};

// Save user data to SQLite
export const saveUser = async (user: { id: number; name: string; email: string; role?: string }): Promise<void> => {
  try {
    await db.runAsync(
      `INSERT OR REPLACE INTO users (id, name, email, role) VALUES (?, ?, ?, ?);`,
      [user.id, user.name, user.email, user.role || 'student']
    );
    console.log('User saved to local database:', user.email);
  } catch (error) {
    console.error('Error saving user to local database:', error);
    throw error;
  }
};

// Get the currently logged-in user from SQLite
export const getLocalUser = async (): Promise<{ id: number; name: string; email: string; role: string } | null> => {
  try {
    const result = await db.getFirstAsync<{ id: number; name: string; email: string; role: string }>(
      `SELECT * FROM users LIMIT 1;`
    );
    
    if (result) {
      console.log('Local user retrieved:', result.email);
      return result;
    } else {
      console.log('No local user found.');
      return null;
    }
  } catch (error) {
    console.error('Error getting local user:', error);
    throw error;
  }
};

// Clear user data from SQLite (e.g., on logout)
export const clearLocalUser = async (): Promise<void> => {
  try {
    await db.runAsync(`DELETE FROM users;`);
    console.log('Local user data cleared.');
  } catch (error) {
    console.error('Error clearing local user data:', error);
    throw error;
  }
};

// Alternative: Get all users (if needed)
export const getAllUsers = async (): Promise<{ id: number; name: string; email: string; role: string }[]> => {
  try {
    const results = await db.getAllAsync<{ id: number; name: string; email: string; role: string }>(`SELECT * FROM users;`);
    console.log('All local users:', results);
    return results;
  } catch (error) {
    console.error('Error getting all local users:', error);
    throw error;
  }
};