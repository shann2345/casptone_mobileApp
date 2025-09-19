// app/(auth)/login.tsx

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useNetworkStatus } from '../../context/NetworkContext';
import api, { storeAuthToken, storeUserData } from '../../lib/api';
import { resetTimeCheckData } from '../../lib/localDb';

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

  const { isConnected, netInfo } = useNetworkStatus();

  const handleLogin = async () => {
    if (!netInfo?.isInternetReachable) {
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

      // After successful login and token storage, check verification status
      const verificationResponse = await api.get('/user/verification-status');
      const isVerified = verificationResponse.data.is_verified;

      if (isVerified) {
        Alert.alert('Success', 'Logged in successfully!');
        await resetTimeCheckData(user.email);
        router.replace('/(app)');
      } else {
        Alert.alert('Pending Verification', 'Please check your email to verify your account.');
        router.replace('/(auth)/verify-notice');
      }
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
          
          {!isConnected && (
            <View style={styles.offlineNotice}>
              <Ionicons name="wifi-outline" size={20} color="#856404" />
              <Text style={styles.offlineText}>You're offline</Text>
              <Text style={styles.offlineHint}>Connect to the internet to sign in</Text>
            </View>
          )}
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, !isConnected && styles.inputDisabled]}
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
              style={[styles.input, !isConnected && styles.inputDisabled]}
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
          
          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>
          
          <TouchableOpacity
            style={[styles.googleButton, !isConnected && styles.buttonDisabled]}
            onPress={() => Alert.alert('Google Sign-In', 'Google Sign-In functionality not implemented yet.')}
            disabled={!isConnected}
          >
            <View style={styles.googleButtonContent}>
              <Ionicons name="logo-google" size={22} color="#fff" style={styles.googleIcon} />
              <Text style={styles.googleButtonText}>Sign In with Google</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
            <Text style={styles.linkText}>Don't have an account? Sign Up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#f0f4f7' 
  },
  scrollContainer: { 
    flexGrow: 1, 
    justifyContent: 'center', 
    padding: 20 
  },
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
  offlineNotice: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffeeba',
    borderWidth: 1,
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
    alignItems: 'center',
    gap: 5,
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
  inputDisabled: {
    backgroundColor: '#f8f9fa',
    color: '#6c757d',
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
    marginTop: 10,
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
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ced4da',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#6c757d',
    fontSize: 14,
    fontWeight: '600',
  },
  googleButton: {
    backgroundColor: '#db4437',
    paddingVertical: 15,
    paddingHorizontal: 25,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#db4437',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  googleIcon: {
    marginRight: 10,
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  linkText: {
    color: '#007bff',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
    fontWeight: '500',
  },
});