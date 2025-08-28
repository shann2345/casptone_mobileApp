// app/(auth)/signup.tsx - Updated for multi-account system

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
import api, { storeAuthToken, storeUserData } from '../../lib/api';
// Import the new multi-account function

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
        <Text style={styles.title}>Sign Up</Text>
        
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
          style={styles.button}
          onPress={handleSignup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign Up</Text>
          )}
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
  title: { fontSize: 32, fontWeight: 'bold', color: '#2c3e50', marginBottom: 30 },
  
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
    borderRadius: 8, marginTop: 20, width: '100%', alignItems: 'center',
    shadowColor: '#007bff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  loginLink: { marginTop: 20 },
  loginLinkText: { color: '#007bff', fontSize: 16 },
});