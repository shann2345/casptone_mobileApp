// app/(auth)/verify-notice.tsx
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Animated, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import api, { clearAuthToken, getAuthToken } from '../../lib/api'; // Make sure 'api' is correctly imported

export default function VerificationNoticeScreen() {
  const [loading, setLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'pending' | 'verified' | 'error'>('pending');
  const [verificationCode, setVerificationCode] = useState(''); // State for the code
  
  // Animation values
  const fadeAnim = useState(new Animated.Value(0))[0];
  const scaleAnim = useState(new Animated.Value(0.8))[0];
  const pulseAnim = useState(new Animated.Value(1))[0];

  useEffect(() => {
    checkVerificationStatus();
    
    // Start animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();
    
    // Pulse animation loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
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

      // --- THIS BLOCK IS NOW FIXED ---
      if (response.data.is_verified) {
        setVerificationStatus('verified');
        
        // The Alert now controls the navigation
        Alert.alert(
          'Success', 
          response.data.message,
          [
            {
              text: 'OK',
              onPress: () => {
                // Navigation only happens AFTER user presses OK
                router.replace({
                  pathname: '/(app)',
                  params: { isNewUser: 'true' }
                });
              }
            }
          ]
        );
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
    } catch (error: any)
      {
      console.error('Error resending code:', error);
      Alert.alert('Resend Failed', error.response?.data?.message || 'Could not resend code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (isVerifying) {
    return (
      <LinearGradient colors={['#667eea', '#764ba2']} style={styles.container}>
        <Animated.View 
          style={[
            styles.loadingContainer,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }]
            }
          ]}
        >
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <LinearGradient
              colors={['#fff', '#f8f9fa']}
              style={styles.iconCircle}
            >
              <ActivityIndicator size="large" color="#667eea" />
            </LinearGradient>
          </Animated.View>
          <Text style={styles.loadingText}>Checking verification status...</Text>
        </Animated.View>
      </LinearGradient>
    );
  }

  if (verificationStatus === 'verified') {
    return (
      <LinearGradient colors={['#667eea', '#764ba2']} style={styles.container}>
        <Animated.View 
          style={[
            styles.centerContainer,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }]
            }
          ]}
        >
          <View style={styles.successCard}>
            <LinearGradient
              colors={['#28a745', '#20c997']}
              style={styles.successIconCircle}
            >
              <Ionicons name="checkmark-circle" size={60} color="#fff" />
            </LinearGradient>
            <Text style={styles.successTitle}>Email Verified!</Text>
            <Text style={styles.successMessage}>
              You can now access all features of the app.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.replace('/(app)')}
            >
              <LinearGradient
                colors={['#667eea', '#764ba2']}
                style={styles.buttonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons name="arrow-forward" size={20} color="#fff" />
                <Text style={styles.buttonText}>Go to App</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#667eea', '#764ba2']} style={styles.container}>
      <Animated.View 
        style={[
          styles.centerContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }]
          }
        ]}
      >
        <View style={styles.verifyCard}>
          {/* Icon */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <LinearGradient
              colors={['#667eea', '#764ba2']}
              style={styles.mailIconCircle}
            >
              <Ionicons name="mail-outline" size={50} color="#fff" />
            </LinearGradient>
          </Animated.View>

          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.message}>
            A 6-digit verification code has been sent to your email address. Please enter it below.
          </Text>

          {/* Code Input */}
          <View style={styles.codeInputContainer}>
            <Ionicons name="shield-checkmark-outline" size={20} color="#6c757d" style={styles.inputIcon} />
            <TextInput
              style={styles.codeInput}
              placeholder="Enter 6-digit code"
              placeholderTextColor="#adb5bd"
              keyboardType="numeric"
              maxLength={6}
              value={verificationCode}
              onChangeText={setVerificationCode}
            />
          </View>

          {/* Verify Button */}
          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.disabledButton]}
            onPress={handleVerifyCode}
            disabled={loading}
          >
            <LinearGradient
              colors={loading ? ['#adb5bd', '#6c757d'] : ['#667eea', '#764ba2']}
              style={styles.buttonGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                  <Text style={styles.buttonText}>Verify Code</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Resend Button */}
          <TouchableOpacity
            style={[styles.secondaryButton, loading && styles.disabledButton]}
            onPress={handleResendCode}
            disabled={loading}
          >
            <View style={styles.secondaryButtonContent}>
              {loading ? (
                <ActivityIndicator color="#667eea" />
              ) : (
                <>
                  <Ionicons name="reload-outline" size={18} color="#667eea" />
                  <Text style={styles.secondaryButtonText}>Resend Code</Text>
                </>
              )}
            </View>
          </TouchableOpacity>

          {/* Logout Button */}
          <TouchableOpacity
            style={[styles.logoutButton, loading && styles.disabledButton]}
            onPress={async () => {
              await clearAuthToken();
              router.replace('/login');
            }}
            disabled={loading}
          >
            <Ionicons name="log-out-outline" size={18} color="#dc3545" />
            <Text style={styles.logoutButtonText}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingContainer: {
    alignItems: 'center',
  },
  centerContainer: {
    width: '100%',
    alignItems: 'center',
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  loadingText: {
    fontSize: 18,
    color: '#fff',
    marginTop: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  verifyCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 25,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  successCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 25,
    padding: 40,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  mailIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  successIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#28a745',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    color: '#2c3e50',
  },
  successTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    color: '#28a745',
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 25,
    color: '#6c757d',
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  successMessage: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#6c757d',
    lineHeight: 24,
  },
  codeInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#f8f9fa',
    borderWidth: 2,
    borderColor: '#e9ecef',
    borderRadius: 12,
    paddingHorizontal: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  inputIcon: {
    marginRight: 10,
  },
  codeInput: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 18,
    color: '#343a40',
    fontWeight: '600',
    letterSpacing: 3,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 15,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonGradient: {
    paddingVertical: 16,
    paddingHorizontal: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    width: '100%',
    backgroundColor: '#f8f9fa',
    borderWidth: 2,
    borderColor: '#667eea',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 25,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  secondaryButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    color: '#667eea',
    fontSize: 16,
    fontWeight: '600',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
  },
  logoutButtonText: {
    color: '#dc3545',
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
});