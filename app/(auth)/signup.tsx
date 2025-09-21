// app/(auth)/signup.tsx - Updated for multi-account system

import { Ionicons } from '@expo/vector-icons';
import * as Google from 'expo-auth-session/providers/google';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import api, { googleAuth, storeAuthToken, storeUserData } from '../../lib/api';
// Import the new multi-account function

WebBrowser.maybeCompleteAuthSession();

// Add this configuration before the SignupScreen component (same as login)
const googleConfig = {
  androidClientId: '194606315101-6q4mh9qqbhvuds8ndqck1g5ug94t9g11.apps.googleusercontent.com',
  iosClientId: 'YOUR_IOS_CLIENT_ID',
  webClientId: 'YOUR_WEB_CLIENT_ID', // Optional, for web testing
};

interface Errors {
  name?: string;
  email?: string;
  password?: string;
  password_confirmation?: string;
  [key: string]: string | undefined;
}

export default function SignupScreen() {
  const router = useRouter();
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [passwordConfirmation, setPasswordConfirmation] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<Errors>({});
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest(googleConfig);


  React.useEffect(() => {
    if (googleResponse?.type === 'success') {
      handleGoogleSuccess(googleResponse.authentication?.accessToken);
    }
  }, [googleResponse]);

  const handleGoogleSignup = () => {
    googlePromptAsync();
  };

  const handleGoogleSuccess = async (accessToken: string | undefined) => {
    if (!accessToken) {
      Alert.alert('Error', 'Google authentication failed - no access token received');
      return;
    }

    setLoading(true);
    
    try {
      // Get user info from Google
      const userInfoResponse = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
      );
      const googleUserData = await userInfoResponse.json();
      
      // Authenticate with your backend
      const result = await googleAuth({
        id: googleUserData.id,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
      });

      if (result.success) {
        Alert.alert(
          'Success', 
          result.isNewUser 
            ? 'Account created successfully with Google! Your account is ready to use offline.'
            : 'Welcome back! Signed in with your existing Google account.'
        );
        
        router.replace('/(app)');
      } else {
        Alert.alert('Authentication Failed', result.message || 'Google sign-up failed');
      }
    } catch (error: any) {
      console.error('Google auth error:', error);
      Alert.alert('Error', 'Failed to authenticate with Google. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  const validateForm = (): boolean => {
    let newErrors: Errors = {};
    if (!name.trim()) newErrors.name = 'Name is required.';
    if (!email.trim()) newErrors.email = 'Email is required.';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Email is invalid.';
    if (!password) newErrors.password = 'Password is required.';
    else if (password.length < 8) newErrors.password = 'Password must be at least 8 characters.';
    if (password !== passwordConfirmation) newErrors.password_confirmation = 'Passwords do not match.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignup = async () => {
    if (!validateForm()) return;
    setLoading(true);
    setErrors({});

    try {
      console.log('📡 Creating new account...');
      
      const response = await api.post('/register', {
        name,
        email,
        password,
        password_confirmation: passwordConfirmation,
      });

      const { token, user, needs_verification } = response.data;

      if (token && user) {
        console.log('✅ Account created successfully');
        
        // Store for current online session
        await storeAuthToken(token);
        await storeUserData(user); 
        

        Alert.alert(
          'Success', 
          `${response.data.message || 'Registration successful!'}\n\nYour account has been saved for offline access.`
        );

        if (needs_verification) {
          router.replace('/verify-notice');
        } else {
          router.replace('/(app)');
        }
      }
    } catch (error: any) {
      console.error('❌ Signup error:', error);
      if (error.response && error.response.data && error.response.data.errors) {
        setErrors(error.response.data.errors);
      } else if (error.response && error.response.data && error.response.data.message) {
        Alert.alert('Error', error.response.data.message);
      } else {
        Alert.alert('Error', 'An unexpected error occurred during registration.');
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
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Create Account</Text>
        
        {/* Info about offline access */}
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            ℹ️ Your account will be saved for offline access after registration
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Name:</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            keyboardType="default"
            autoCorrect={false}
          />
          {errors.name && <Text style={styles.errorText}>{errors.name}</Text>}
        </View>

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

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Confirm Password:</Text>
          <TextInput
            style={styles.input}
            placeholder="Confirm your password"
            value={passwordConfirmation}
            onChangeText={setPasswordConfirmation}
            secureTextEntry
          />
          {errors.password_confirmation && <Text style={styles.errorText}>{errors.password_confirmation}</Text>}
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign Up</Text>
          )}
        </TouchableOpacity>

        <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
            style={[styles.googleButton, loading && styles.buttonDisabled]}
            onPress={handleGoogleSignup}
            disabled={loading}
          >
            <View style={styles.googleButtonContent}>
              <Ionicons name="logo-google" size={22} color="#fff" style={styles.googleIcon} />
              <Text style={styles.googleButtonText}>Sign Up with Google</Text>
            </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.loginLink}
          onPress={() => router.replace('/login')}
        >
          <Text style={styles.loginLinkText}>Already have an account? Log In</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#2c3e50', marginBottom: 20 },
  
  infoBox: {
    backgroundColor: '#e7f3ff',
    borderLeftWidth: 4,
    borderLeftColor: '#007bff',
    padding: 12,
    borderRadius: 6,
    marginBottom: 20,
    width: '100%',
  },
  infoText: {
    fontSize: 14,
    color: '#0056b3',
    textAlign: 'center',
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
    backgroundColor: '#007bff', paddingVertical: 15, paddingHorizontal: 25,
    borderRadius: 8, marginTop: 10, width: '100%', alignItems: 'center',
    shadowColor: '#007bff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  buttonDisabled: {
    backgroundColor: '#adb5bd',
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
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
  loginLink: { marginTop: 20 },
  loginLinkText: { color: '#007bff', fontSize: 16 },
});