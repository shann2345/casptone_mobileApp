// app/(auth)/verify-notice.tsx
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import api, { clearAuthToken, getAuthToken } from '../../lib/api'; // Make sure 'api' is correctly imported

export default function VerificationNoticeScreen() {
  const [loading, setLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'pending' | 'verified' | 'error'>('pending');
  const [verificationCode, setVerificationCode] = useState(''); // State for the code

  useEffect(() => {
    checkVerificationStatus();
  }, []);

  const checkVerificationStatus = async () => {
    setIsVerifying(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const response = await api.get('/user/verification-status');
      if (response.data.is_verified) {
        setVerificationStatus('verified');
        Alert.alert('Email Verified!', 'You can now access the app.');
        router.replace('/(app)');
      } else {
        setVerificationStatus('pending');
      }
    } catch (error: any) {
      console.error('Error checking verification status:', error);
      if (error.response && error.response.status === 401) {
        Alert.alert('Session Expired', 'Please log in again.');
        clearAuthToken();
        router.replace('/login');
      } else {
        Alert.alert('Error', 'Could not check verification status. Please try again.');
        setVerificationStatus('error');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyCode = async () => {
    setLoading(true);
    try {
      const response = await api.post('/email/verify-code', {
        verification_code: verificationCode,
      });

      if (response.data.is_verified) {
        Alert.alert('Success', response.data.message);
        setVerificationStatus('verified');
        router.replace('/(app)'); // Navigate to main app
      } else {
        Alert.alert('Verification Failed', response.data.message || 'Invalid code. Please try again.');
      }
    } catch (error: any) {
      console.error('Error verifying code:', error);
      let errorMessage = 'An error occurred during verification.';
      if (error.response && error.response.data && error.response.data.errors) {
        // Laravel validation errors
        errorMessage = Object.values(error.response.data.errors).flat().join('\n');
      } else if (error.response && error.response.data && error.response.data.message) {
        errorMessage = error.response.data.message;
      }
      Alert.alert('Verification Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setLoading(true);
    try {
      const response = await api.post('/email/verification-notification');
      Alert.alert('Resent!', response.data.message);
    } catch (error: any) {
      console.error('Error resending code:', error);
      Alert.alert('Resend Failed', error.response?.data?.message || 'Could not resend code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (isVerifying) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.message}>Checking verification status...</Text>
      </View>
    );
  }

  if (verificationStatus === 'verified') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Email Verified!</Text>
        <Text style={styles.message}>You can now access all features of the app.</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/(app)')}
        >
          <Text style={styles.buttonText}>Go to App</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify Your Email</Text>
      <Text style={styles.message}>
        A 6-digit verification code has been sent to your email address. Please enter it below.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Enter 6-digit code"
        keyboardType="numeric"
        maxLength={6}
        value={verificationCode}
        onChangeText={setVerificationCode}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleVerifyCode}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Verify Code</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.resendButton]}
        onPress={handleResendCode}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Resend Code</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.logoutButton]}
        onPress={async () => {
          await clearAuthToken();
          router.replace('/login');
        }}
        disabled={loading}
      >
        <Text style={styles.buttonText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 15,
    color: '#333',
  },
  input: {
    width: '80%',
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 18,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#007bff',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
    marginTop: 10,
    minWidth: 200,
    alignItems: 'center',
  },
  resendButton: {
    backgroundColor: '#6c757d',
    marginTop: 10,
  },
  logoutButton: { // Added for explicit logout option
    backgroundColor: '#dc3545',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});