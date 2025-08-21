// app/(auth)/login.tsx

import { Ionicons } from '@expo/vector-icons';
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
  initDb,
  resetTimeCheckData
} from '../../lib/localDb';

interface Errors {
  email?: string;
  password?: string;
  [key: string]: string | undefined;
}

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<Errors>({});
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  const { isConnected, netInfo } = useNetworkStatus();

  React.useEffect(() => {
    const initialize = async () => {
      try {
        setIsInitializing(true);
        console.log('🔧 Initializing login screen...');
        
        // Removed the time detection reset logic.
        
        await initDb();
        console.log('✅ Database initialized');

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
  }, [netInfo]);

  // --- MODIFIED FUNCTION: checkExistingAuth ---
  const checkExistingAuth = async () => {
    try {
      const token = await getAuthToken();
      if (token) {
        console.log('🔍 Existing token found.');
        if (isConnected) {
            // If online, verify the token with the server
            try {
                const response = await api.get('/user/verification-status');
                if (response.data.is_verified) {
                    router.replace('/(app)');
                } else {
                    router.replace('/verify-notice');
                }
            } catch (error) {
                console.log('❌ Token invalid, clearing and redirecting to login...');
                await clearAuthData();
                router.replace('/login');
            }
        } else {
            // If offline with a token, allow access to the app
            console.log('⚠️ Offline: Allowing access with existing token.');
            router.replace('/(app)');
        }
      }
    } catch (error) {
      console.error('❌ Auth check error:', error);
    }
  };

  // --- MODIFIED FUNCTION: handleLogin ---
  const handleLogin = async () => {
    // New logic: Check network status before attempting login.
    if (!isConnected) {
        Alert.alert(
            "No Network Connection",
            "You must be connected to the internet to log in for the first time or to restore your session."
        );
        return;
    }

    setLoading(true);
    setErrors({});

    try {
      const response = await api.post('/login', { email, password });
      const { user, token } = response.data;
      await storeAuthToken(token);
      await storeUserData(user);

      // ✅ NEW: Reset time check data on successful login
      await resetTimeCheckData(user.email); 

      Alert.alert('Success', 'Logged in successfully!');
      router.replace('/(app)');
    } catch (err: any) {
      console.error('Login error:', err.response?.data || err.message);
      if (err.response && err.response.data && err.response.data.errors) {
        const validationErrors: Errors = {};
        for (const key in err.response.data.errors) {
          validationErrors[key as keyof Errors] = err.response.data.errors[key][0];
        }
        setErrors(validationErrors);
      } else {
        Alert.alert('Login Failed', err.response?.data?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.contentContainer}>
          <Text style={styles.logo}>OLIN</Text>
          <Text style={styles.title}>Sign In to Your Account</Text>
          
          {isInitializing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007bff" />
              <Text style={styles.loadingText}>Initializing...</Text>
            </View>
          ) : (
            <>
              {isConnected !== true && (
                <View style={styles.offlineNotice}>
                  <Text style={styles.offlineText}>
                    <Ionicons name="wifi-outline" size={16} color="#856404" /> You're offline.
                  </Text>
                  <Text style={styles.offlineHint}>
                    Login requires a network connection.
                  </Text>
                </View>
              )}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={isConnected}
                />
                {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  editable={isConnected}
                />
                {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
              </View>
              <TouchableOpacity
                style={[styles.button, (loading || !isConnected) && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading || !isConnected}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Sign In</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/forgot-password')}>
                <Text style={styles.linkText}>Forgot password?</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/register')}>
                <Text style={styles.linkText}>Don't have an account? Sign Up</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f7' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  contentContainer: {
    backgroundColor: '#ffffff',
    padding: 30,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  logo: {
    fontSize: 48,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
    color: '#34495e',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
    color: '#555',
  },
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#6c757d',
  },
  offlineNotice: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffeeba',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 20,
  },
  offlineText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    color: '#856404',
  },
  offlineHint: {
    fontSize: 12,
    color: '#856404',
    textAlign: 'center',
    marginTop: 4,
  },
  inputGroup: {
    width: '100%',
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    color: '#34495e',
    marginBottom: 5,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ced4da',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 15,
    fontSize: 16,
    color: '#343a40',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 13,
    marginTop: 5,
    marginLeft: 5,
  },
  button: {
    backgroundColor: '#007bff',
    paddingVertical: 15,
    paddingHorizontal: 25,
    borderRadius: 8,
    marginTop: 20,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#007bff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  buttonDisabled: {
    backgroundColor: '#adb5bd',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  linkText: {
    color: '#007bff',
    textAlign: 'center',
    marginTop: 15,
    fontSize: 14,
    fontWeight: '500',
  },
});
