// app/(app)/_layout.tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../context/NetworkContext'; // Adjust path as needed
import { getProfile, getUserData } from '../../lib/api';

export default function AppLayout() {
  const router = useRouter();
  const [initials, setInitials] = useState<string>('');
  const [profileImage, setProfileImage] = useState<string | null>(null);

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

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#007bff',
        tabBarInactiveTintColor: '#888',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#ccc',
          height: 80,
          paddingBottom: 5,
        },
        tabBarLabelStyle: {
          fontSize: 12,
        },
        headerShown: false, // Ensure the Tabs component itself doesn't render a header
      }}
    >
      <Tabs.Screen
        name="index" // Dashboard
        options={{
          tabBarLabel: 'Home', // This is for the tab label at the bottom
          headerTitle: 'Dashboard', // This is for the header title
          tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />,
          headerShown: true, // Show header for this screen
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.headerRightContainer}>
              <HeaderRight initials={initials} profileImage={profileImage} />
            </TouchableOpacity>
          ),
          headerStyle: { backgroundColor: '#007bff' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
      <Tabs.Screen
        name="courses" // My Courses tab
        options={{
          tabBarLabel: 'Courses', // Tab label
          tabBarIcon: ({ color }) => <Ionicons name="book" size={24} color={color} />,
          headerShown: false, // The nested Stack in app/(app)/courses/_layout.tsx will handle the header for courses
        }}
      />
      <Tabs.Screen
        name="to-do"
        options={{
          tabBarLabel: 'To-do', // Tab label
          headerTitle: 'To-do', // Header title
          tabBarIcon: ({ color }) => <Ionicons name="document-text" size={24} color={color} />,
          headerShown: true, // Show header for this screen
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.headerRightContainer}>
              <HeaderRight initials={initials} profileImage={profileImage} />
            </TouchableOpacity>
          ),
          headerStyle: { backgroundColor: '#007bff' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarLabel: 'Settings', // Tab label
          headerTitle: 'Settings', // Header title
          tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
          headerShown: true, // Show header for this screen
          headerStyle: { backgroundColor: '#007bff' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
    </Tabs>
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
    width: 32,
    height: 32,
    borderRadius: 16,
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