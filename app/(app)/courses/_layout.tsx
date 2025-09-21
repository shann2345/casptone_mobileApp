// app/(app)/courses/_layout.tsx
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNetworkStatus } from '../../../context/NetworkContext'; // Adjust path as needed
import { getProfile, getUserData } from '../../../lib/api';

export default function CoursesLayout() {
  const router = useRouter();
  const [initials, setInitials] = useState<string>('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        // Try to get full profile first (includes profile_image)
        try {
          const profileData = await getProfile();
          if (profileData && profileData.name) {
            const firstLetter = profileData.name.charAt(0).toUpperCase();
            setInitials(firstLetter);
            setProfileImage(profileData.profile_image);
            return;
          }
        } catch (profileError) {
          console.log('Profile fetch failed, falling back to user data:', profileError);
        }

        // Fallback to stored user data if profile fetch fails
        const userData = await getUserData();
        if (userData && userData.name) {
          const firstLetter = userData.name.charAt(0).toUpperCase();
          setInitials(firstLetter);
        } else {
          setInitials('?');
        }
      } catch (error) {
        console.error('Error fetching user profile for header:', error);
        setInitials('?');
      }
    };

    fetchUserProfile();
  }, []);

  // Calculate proper header height including status bar
  const headerHeight = Platform.OS === 'ios' ? 44 + insets.top : 56 + insets.top;

  return (
    <>
      {/* Status Bar Configuration */}
      <StatusBar 
        barStyle="light-content" 
        backgroundColor="#007bff" 
        translucent={false}
      />
      
      <Stack
        screenOptions={{
          headerStyle: { 
            backgroundColor: '#007bff',
            height: headerHeight,
          },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/settings')}
            >
              <HeaderRight initials={initials} profileImage={profileImage} />
            </TouchableOpacity>
          ),
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'My Courses',
            headerShown: true,
          }}
        />
        <Stack.Screen
          name="[id]"
          options={{
            // Title will be set dynamically by the screen
          }}
        />
        <Stack.Screen
          name="materials/[materialId]"
          options={{
            // Title will be set dynamically by the screen
          }}
        />
        <Stack.Screen
          name="assessments/[assessmentId]"
          options={{
            // Title will be set dynamically by the screen
          }}
        />
      </Stack>
    </>
  );
}

const HeaderRight = ({ initials, profileImage }: { initials: string; profileImage: string | null }) => {
  const { isConnected } = useNetworkStatus();

  return (
    <View style={styles.headerRightWrapper}>
      <View style={styles.profileContainer}>
        {profileImage ? (
          // Show profile image if available
          <View style={styles.profileImageContainer}>
            <Image 
              source={{ uri: profileImage }} 
              style={styles.profileImage}
              onError={() => console.log('Failed to load profile image')}
            />
            {/* Status Dot */}
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#28a745' : '#dc3545' },
              ]}
            />
          </View>
        ) : initials ? (
          // Show initials circle if no profile image but has initials
          <View style={styles.initialsCircle}>
            <Text style={styles.initialsText}>{initials}</Text>
            {/* Status Dot */}
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#28a745' : '#dc3545' },
              ]}
            />
          </View>
        ) : (
          // Show default icon if no profile image and no initials
          <View style={styles.defaultIconContainer}>
            <Ionicons name="person-circle-outline" size={30} color="#fff" />
            {/* Status Dot */}
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#28a745' : '#dc3545' },
              ]}
            />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  headerRightContainer: {
    marginRight: 15,
  },
  headerRightWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44, // Ensure consistent touch target
    minWidth: 44,
  },
  profileContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImageContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  initialsCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E90FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  initialsText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  defaultIconContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#fff',
    zIndex: 2,
  },
});