// app/(auth)/login.tsx

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
import api, { clearAuthToken, getAuthToken, storeAuthToken, storeUserData } from '../../lib/api'; // Import getUserData, storeUserData

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

  React.useEffect(() => {
    const checkLocalAuth = async () => {
      try {
        const token = await getAuthToken();
        if (token) {
          console.log('Found existing token. Checking verification status...');
          const response = await api.get('/user/verification-status');
          if (response.data.is_verified) {
            router.replace('/(app)');
          } else {
            router.replace('/verify-notice');
          }
        }
      } catch (error) {
        console.error('Error checking local auth/verification:', error);
        await clearAuthToken();
      }
    };
    checkLocalAuth();
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    setErrors({});
    try {
      const response = await api.post('/login', {
        email,
        password,
      });

      const { token, user, is_verified } = response.data;

      if (token && user) { // Ensure user data is present
        await storeAuthToken(token);
        await storeUserData(user); // Store user data
        if (is_verified) {
          router.replace('/(app)');
        } else {
          router.replace('/verify-notice');
        }
      }
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.response && error.response.data && error.response.data.errors) {
        setErrors(error.response.data.errors);
      } else {
        Alert.alert('Login Failed', error.response?.data?.message || 'Invalid credentials or server error.');
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
        <Text style={styles.title}>Login</Text>

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
          style={styles.button}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signupLink}
          onPress={() => router.replace('/signup')}
        >
          <Text style={styles.signupLinkText}>Don't have an account? Sign Up</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#2c3e50', marginBottom: 30 },
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
  signupLink: { marginTop: 20 },
  signupLinkText: { color: '#007bff', fontSize: 16 },
});