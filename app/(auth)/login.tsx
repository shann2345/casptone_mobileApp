// app/(auth)/login.tsx - Fixed with corrected emergency reset

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { useNetworkStatus } from '../../context/NetworkContext';
import api, {
  clearAuthData,
  getAuthToken,
  storeAuthToken,
  storeUserData
} from '../../lib/api';
import {
  emergencyResetTimeDetection // Import the exported function
  ,

  getAllOfflineUsers,
  initDb,
  saveUserForOfflineAccess,
  validateOfflineLogin
} from '../../lib/localDb';

interface Errors {
  email?: string;
  password?: string;
  [key: string]: string | undefined;
}

interface OfflineUser {
  id: string;
  name: string;
  email: string;
  last_login: string;
  login_count: number;
}

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<Errors>({});
  const [offlineUsers, setOfflineUsers] = useState<OfflineUser[]>([]);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  const { isConnected, netInfo } = useNetworkStatus();

  React.useEffect(() => {
    const initialize = async () => {
      try {
        setIsInitializing(true);
        console.log('🔧 Initializing login screen...');
        
        // FIRST: Reset time detection to prevent cascading errors
        await emergencyResetTimeDetection(); // Use the imported function
        console.log('🔄 Time detection reset completed');
        
        // Initialize database
        await initDb();
        console.log('✅ Database initialized');

        // Load offline users for UI
        const users = await getAllOfflineUsers();
        setOfflineUsers(users as OfflineUser[]);
        console.log(`📋 Loaded ${users.length} offline users`);

        // Check existing auth only after network status is known
        if (netInfo !== null) {
          await checkExistingAuth();
        }
      } catch (error) {
        console.error('❌ Login screen initialization error:', error);
        Alert.alert(
          'Initialization Error',
          'Failed to initialize the app. Please restart the application.',
          [{ text: 'OK' }]
        );
      } finally {
        setIsInitializing(false);
      }
    };

    initialize();
  }, [netInfo]); // Only re-run when netInfo changes

  const checkExistingAuth = async () => {
    try {
      const token = await getAuthToken();
      if (token && isConnected) {
        console.log('🔍 Checking existing token...');
        try {
          const response = await api.get('/user/verification-status');
          if (response.data.is_verified) {
            router.replace('/(app)');
          } else {
            router.replace('/verify-notice');
          }
        } catch (error) {
          console.log('❌ Token invalid, clearing...');
          await clearAuthData();
        }
      }
    } catch (error) {
      console.error('❌ Auth check error:', error);
    }
  };

 const handleLogin = async () => {
    setLoading(true);
    setErrors({});

    // Validation
    if (!email.trim()) {
      setErrors({ email: 'Email is required' });
      setLoading(false);
      return;
    }
    if (!password.trim()) {
      setErrors({ password: 'Password is required' });
      setLoading(false);
      return;
    }

    try {
      // --- OFFLINE LOGIN LOGIC ---
      if (!isConnected) {
        console.log('🔴 Attempting offline login for:', email);
        
        const result = await validateOfflineLogin(email, password);
        
        if (result.success && result.user) {
          console.log('✅ Offline login successful');
          
          // Store user data for the session (no token needed for offline)
          await storeUserData(result.user);
          
          Alert.alert(
            'Offline Login Successful', 
            `Welcome back ${result.user.name}! This is login #${result.loginCount}.`,
            [{ text: 'Continue', onPress: () => router.replace('/(app)') }]
          );
        } else {
          Alert.alert(
            'Offline Login Failed',
            result.error || 'Invalid email or password, or account not found offline. Connect to internet to login with a new account.'
          );
        }
        return;
      }

      // --- ONLINE LOGIN LOGIC ---
      console.log('🟢 Attempting online login for:', email);
      
      const response = await api.post('/login', {
        email,
        password,
      });

      const { token, user, is_verified } = response.data;

      if (token && user) {
        console.log('✅ Online login successful');
        await storeAuthToken(token);
        await storeUserData(user);

        // Save for offline access (this stores the password hash)
        try {
          await saveUserForOfflineAccess(user, password);
          console.log('💾 Account saved for offline access');
        } catch (saveError) {
          console.error('⚠️ Failed to save for offline access:', saveError);
          // Don't block login if offline save fails
        }

        // Only navigate after DB/user data is ready
        if (is_verified) {
          router.replace('/(app)');
        } else {
          router.replace('/verify-notice');
        }
      } else {
        Alert.alert('Login Error', 'Invalid response from server');
      }
    } catch (error: any) {
      console.error('❌ Login error:', error);
      
      // Removed the emergency reset call here, as it's now handled by the initial setup
      if (error.response?.data?.errors) {
        setErrors(error.response.data.errors);
      } else {
        Alert.alert(
          'Login Failed', 
          error.response?.data?.message || 'Invalid credentials or server error.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const fillEmailFromOfflineUser = (userEmail: string) => {
    setEmail(userEmail);
  };

  // Add manual reset button for debugging (remove in production)
  const handleManualTimeReset = async () => {
    try {
      await emergencyResetTimeDetection(); // Use the imported function
      Alert.alert('Success', 'Time detection system has been reset.');
    } catch (error) {
      Alert.alert('Error', 'Failed to reset time detection system.');
    }
  };

  // Show loading screen while initializing
  if (isInitializing) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Initializing...</Text>
        <Text style={styles.subLoadingText}>Resetting time detection...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Login</Text>
        
        {/* Network Status */}
        {netInfo !== null && (
          <View style={[styles.networkStatus, { backgroundColor: isConnected ? 'rgba(40, 167, 69, 0.1)' : 'rgba(220, 53, 69, 0.1)' }]}>
            {!isConnected && (
              <Text style={styles.offlineHint}>
                Enter credentials for any previously used account
              </Text>
            )}
          </View>
        )}

        {/* Offline Users Quick Select (only show when offline and have users) */}
        {!isConnected && offlineUsers.length > 0 && (
          <View style={styles.offlineUsersContainer}>
            <Text style={styles.offlineUsersTitle}>Previously used accounts:</Text>
            {offlineUsers.slice(0, 3).map((user, index) => (
              <TouchableOpacity
                key={`${user.email}-${index}`}
                style={styles.offlineUserItem}
                onPress={() => fillEmailFromOfflineUser(user.email)}
              >
                <Text style={styles.offlineUserName}>{user.name}</Text>
                <Text style={styles.offlineUserEmail}>{user.email}</Text>
                <Text style={styles.offlineUserInfo}>
                  Last login: {new Date(user.last_login).toLocaleDateString()} 
                  • {user.login_count} logins
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email:</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
        </View>
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password:</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
        </View>
        
        <TouchableOpacity
          style={[styles.button, !isConnected && styles.offlineButton]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {!isConnected ? 'Login (Offline)' : 'Login'}
            </Text>
          )}
        </TouchableOpacity>
        
        {/* Debug button - remove in production */}
        {__DEV__ && (
          <TouchableOpacity
            style={[styles.button, styles.debugButton]}
            onPress={handleManualTimeReset}
          >
            <Text style={styles.buttonText}>Reset Time Detection (Debug)</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={styles.signupLink}
          onPress={() => router.replace('/signup')}
          disabled={!isConnected}
        >
          <Text style={[styles.signupLinkText, !isConnected && styles.disabledText]}>
            Don't have an account? Sign Up {!isConnected ? '(Requires Internet)' : ''}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  loadingContainer: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#007bff' },
  subLoadingText: { marginTop: 5, fontSize: 12, color: '#6c757d' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#2c3e50', marginBottom: 30 },
  networkStatus: { marginBottom: 20, padding: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
  networkText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  offlineHint: { fontSize: 12, color: '#6c757d', textAlign: 'center', marginTop: 4 },
  
  // Offline users styles
  offlineUsersContainer: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  offlineUsersTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 10,
  },
  offlineUserItem: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007bff',
  },
  offlineUserName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212529',
  },
  offlineUserEmail: {
    fontSize: 14,
    color: '#6c757d',
    marginTop: 2,
  },
  offlineUserInfo: {
    fontSize: 12,
    color: '#6c757d',
    marginTop: 4,
  },
  
  inputGroup: { width: '100%', marginBottom: 15 },
  label: { fontSize: 16, color: '#34495e', marginBottom: 5, fontWeight: '600' },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ced4da', borderRadius: 8,
    paddingVertical: 12, paddingHorizontal: 15, fontSize: 16, color: '#343a40',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2,
  },
  errorText: { color: '#dc3545', fontSize: 13, marginTop: 5, marginLeft: 5 },
  button: {
    backgroundColor: '#007bff', paddingVertical: 15, paddingHorizontal: 25, borderRadius: 8, marginTop: 20, 
    width: '100%', alignItems: 'center', shadowColor: '#007bff', shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  offlineButton: { backgroundColor: '#6c757d', shadowColor: '#6c757d' },
  debugButton: { backgroundColor: '#ffc107', shadowColor: '#ffc107', marginTop: 10 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  signupLink: { marginTop: 20 },
  signupLinkText: { color: '#007bff', fontSize: 16, textAlign: 'center' },
  disabledText: { color: '#6c757d' },
});