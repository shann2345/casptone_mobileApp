import { Ionicons } from '@expo/vector-icons';
import * as Google from 'expo-auth-session/providers/google';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import api, { googleAuth, prepareOfflineMode, storeAuthToken, storeUserData } from '@/lib/api';
import { registerBackgroundSync } from '@/lib/backgroundSync';
import { useNetworkStatus } from '../../context/NetworkContext';
import { useOAuth } from '../../context/OAuthContext'; // NEW IMPORT
import { initDb, resetTimeCheckData } from '../../lib/localDb';

WebBrowser.maybeCompleteAuthSession();

const googleConfig = {
  androidClientId: '194606315101-b2ihku865cct78jmvnu9abl6niqed24f.apps.googleusercontent.com',
  webClientId: '194606315101-t6942gavub8kh16dogd0k600upkctcf2.apps.googleusercontent.com', 
};

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
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest(googleConfig);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  
  // Animation values
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(50)).current;

  const { isConnected, netInfo } = useNetworkStatus();
  const { startProcessing, stopProcessing } = useOAuth(); // NEW: Use global OAuth context

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  React.useEffect(() => {
    if (googleResponse?.type === 'success') {
      startProcessing(); // Show global overlay
      handleGoogleSuccess(googleResponse.authentication?.accessToken);
    }
  }, [googleResponse]);

  const handleGoogleLogin = () => {
    if (!isConnected) {
      Alert.alert(
        "No Network Connection",
        "You need an internet connection to sign in with Google."
      );
      return;
    }
    
    googlePromptAsync();
  };

  const handleGoogleSuccess = async (accessToken: string | undefined) => {
    if (!accessToken) {
      Alert.alert('Error', 'Google authentication failed - no access token received');
      stopProcessing();
      return;
    }
    
    try {
      const userInfoResponse = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
      );
      const googleUserData = await userInfoResponse.json();
      
      console.log('📋 Google user data:', googleUserData);
      
      const result = await googleAuth({
        id: googleUserData.id,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        given_name: googleUserData.given_name,
        family_name: googleUserData.family_name,
      });

      if (result.success) {
        console.log('✅ Google auth result:', result);
        await resetTimeCheckData(result.user.email);
        
        // Initialize database and prepare offline mode
        await initDb();
        await prepareOfflineMode();
        
        // Register background sync for offline work
        console.log('🔄 Registering background sync for Google user...');
        const syncRegistered = await registerBackgroundSync();
        if (syncRegistered) {
          console.log('✅ Background sync enabled - will sync even when app is closed');
        } else {
          console.log('⚠️ Background sync registration failed - only foreground sync available');
        }
        
        stopProcessing(); // Hide overlay before showing alert
        
        if (result.isVerified) {
          Alert.alert(
            'Success', 
            'Signed in successfully!',
            [
              {
                text: 'OK',
                onPress: () => {
                  console.log('➡️ Navigating to /(app)');
                  router.replace('/(app)');
                }
              }
            ]
          );
        } else {
          Alert.alert(
            result.isNewUser ? 'Account Created' : 'Verify Your Email', 
            'Please check your email for a verification code to complete your registration.',
            [
              {
                text: 'OK',
                onPress: () => {
                  console.log('➡️ Navigating to /(auth)/verify-notice');
                  router.replace('/(auth)/verify-notice');
                }
              }
            ]
          );
        }
      } else {
        stopProcessing();
        console.error('❌ Google auth failed:', result.message);
        
        if (result.error === 'invalid_role') {
          Alert.alert(
            'Access Denied', 
            result.message || 'This mobile app is only available for students. Please use the web portal.',
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert('Authentication Failed', result.message || 'Google sign-in failed');
        }
      }
    } catch (error: any) {
      stopProcessing();
      console.error('Google auth error:', error);
      Alert.alert('Error', 'Failed to authenticate with Google. Please try again.');
    }
  };

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

      const verificationResponse = await api.get('/user/verification-status');
      const isVerified = verificationResponse.data.is_verified;

      // Initialize database and prepare offline mode
      await initDb();
      await prepareOfflineMode();
      
      // Register background sync for offline work
      console.log('🔄 Registering background sync...');
      const syncRegistered = await registerBackgroundSync();
      if (syncRegistered) {
        console.log('✅ Background sync enabled - will sync even when app is closed');
      } else {
        console.log('⚠️ Background sync registration failed - only foreground sync available');
      }

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
      
      if (err.response?.status === 403 && err.response?.data?.error === 'invalid_role') {
        Alert.alert(
          'Access Denied',
          err.response.data.message || 'This mobile app is only available for students. Please use the web portal.',
          [{ text: 'OK' }]
        );
      } else if (err.response && err.response.data && err.response.data.errors) {
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
    <LinearGradient
      colors={['#667eea', '#764ba2']}
      style={styles.gradientBackground}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <Animated.View 
            style={[
              styles.contentContainer,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }]
              }
            ]}
          >
            {/* Logo Section */}
            <View style={styles.logoContainer}>
              <LinearGradient
                colors={['#667eea', '#764ba2']}
                style={styles.logoCircle}
              >
                <Ionicons name="school-outline" size={50} color="#fff" />
              </LinearGradient>
              <Text style={styles.logo}>OLIN</Text>
            </View>

            <Text style={styles.title}>Welcome</Text>
            
            {!isConnected && (
              <Animated.View style={styles.offlineNotice}>
                <Ionicons name="wifi-outline" size={24} color="#856404" />
                <View style={styles.offlineTextContainer}>
                  <Text style={styles.offlineText}>You're offline</Text>
                  <Text style={styles.offlineHint}>Connect to the internet to sign in</Text>
                </View>
              </Animated.View>
            )}
            
            {/* <View style={styles.inputGroup}>
              <Text style={styles.label}>
                <Ionicons name="mail-outline" size={16} color="#495057" /> Email
              </Text>
              <View style={styles.inputContainer}>
                <Ionicons name="mail-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, !isConnected && styles.inputDisabled]}
                  placeholder="Enter your email"
                  placeholderTextColor="#adb5bd"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={isConnected}
                />
              </View>
              {errors.email && (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle-outline" size={14} color="#dc3545" />
                  <Text style={styles.errorText}>{errors.email}</Text>
                </View>
              )}
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                <Ionicons name="lock-closed-outline" size={16} color="#495057" /> Password
              </Text>
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, !isConnected && styles.inputDisabled]}
                  placeholder="Enter your password"
                  placeholderTextColor="#adb5bd"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  editable={isConnected}
                />
                <TouchableOpacity 
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                >
                  <Ionicons 
                    name={showPassword ? "eye-outline" : "eye-off-outline"} 
                    size={20} 
                    color="#6c757d" 
                  />
                </TouchableOpacity>
              </View>
              {errors.password && (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle-outline" size={14} color="#dc3545" />
                  <Text style={styles.errorText}>{errors.password}</Text>
                </View>
              )}
            </View> */}
            
            {/* <TouchableOpacity
              style={[styles.button, (loading || !isConnected) && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading || !isConnected}
            >
              <LinearGradient
                colors={loading || !isConnected ? ['#adb5bd', '#6c757d'] : ['#667eea', '#764ba2']}
                style={styles.buttonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="log-in-outline" size={20} color="#fff" />
                    <Text style={styles.buttonText}>Sign In</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
            
            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
              <View style={styles.dividerLine} />
            </View> */}
            
            <TouchableOpacity 
              style={[styles.googleButton, loading && styles.buttonDisabled]} 
              onPress={handleGoogleLogin}
              disabled={loading}
            >
              <View style={styles.googleButtonContent}>
                <Ionicons name="logo-google" size={22} color="#db4437" />
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </View>
            </TouchableOpacity>

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradientBackground: {
    flex: 1,
  },
  container: { 
    flex: 1,
  },
  scrollContainer: { 
    flexGrow: 1, 
    justifyContent: 'center', 
    padding: 20,
  },
  contentContainer: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 10,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  logo: {
    fontSize: 30,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
    color: '#667eea',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 12,
    color: '#6c757d',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 25,
    color: '#2c3e50',
  },
  offlineNotice: {
    backgroundColor: '#fff3cd',
    borderLeftWidth: 4,
    borderLeftColor: '#ffc107',
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#ffc107',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  offlineTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  offlineText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#856404',
    marginBottom: 2,
  },
  offlineHint: {
    fontSize: 12,
    color: '#856404',
  },
  inputGroup: {
    width: '100%',
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#495057',
    marginBottom: 8,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderWidth: 2,
    borderColor: '#e9ecef',
    borderRadius: 12,
    paddingHorizontal: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 16,
    color: '#343a40',
  },
  eyeIcon: {
    padding: 5,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 5,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 13,
    marginLeft: 5,
    fontWeight: '500',
  },
  button: {
    marginTop: 10,
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
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
  buttonDisabled: {
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 25,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#dee2e6',
  },
  dividerText: {
    marginHorizontal: 15,
    color: '#6c757d',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  googleButton: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 25,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  googleButtonText: {
    color: '#495057',
    fontSize: 16,
    fontWeight: '600',
  },
});