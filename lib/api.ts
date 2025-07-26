// lib/api.ts

import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// IMPORTANT: Replace with your actual Laravel API URL.
export const API_BASE_URL = 'http://192.168.1.4:8000/api'; // Or your actual IP/domain

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach the token
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('user_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error getting token from SecureStore:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Function to store the token
export const storeAuthToken = async (token: string) => {
  try {
    await SecureStore.setItemAsync('user_token', token);
    console.log('Auth token stored securely.');
  } catch (error) {
    console.error('Failed to store auth token:', error);
  }
};

// Function to get the token
export const getAuthToken = async () => {
  try {
    const token = await SecureStore.getItemAsync('user_token');
    return token;
  } catch (error) {
    console.error('Failed to get auth token:', error);
    return null;
  }
};

// Function to store user data (e.g., name, email, ID)
export const storeUserData = async (userData: any) => {
  try {
    await SecureStore.setItemAsync('user_data', JSON.stringify(userData));
    console.log('User data stored securely.');
  } catch (error) {
    console.error('Failed to store user data:', error);
  }
};

// Function to get user data
export const getUserData = async () => {
  try {
    const userDataString = await SecureStore.getItemAsync('user_data');
    return userDataString ? JSON.parse(userDataString) : null;
  } catch (error) {
    console.error('Failed to get user data:', error);
    return null;
  }
};

// Function to clear all auth related data
export const clearAuthToken = async () => {
  try {
    await SecureStore.deleteItemAsync('user_token');
    await SecureStore.deleteItemAsync('user_data'); // Clear user data too
    console.log('Auth token and user data cleared.');
  } catch (error) {
    console.error('Failed to clear auth data:', error);
  }
};

export default api;