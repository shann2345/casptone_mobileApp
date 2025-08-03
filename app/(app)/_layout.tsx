// app/(app)/_layout.tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../context/NetworkContext'; // Adjust path as needed
import { getUserData } from '../../lib/api';

export default function AppLayout() {
  const router = useRouter();
  const [initials, setInitials] = useState<string>('');

  useEffect(() => {
    const fetchUserNameAndSetInitials = async () => {
      try {
        const userData = await getUserData();
        if (userData && userData.name) {
          const firstLetter = userData.name.charAt(0).toUpperCase();
          setInitials(firstLetter);
        } else {
          setInitials('?');
        }
      } catch (error) {
        console.error('Error fetching user data for initials:', error);
        setInitials('?');
      }
    };

    fetchUserNameAndSetInitials();
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
          headerTitle: 'Olin', // This is for the header title
          tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />,
          headerShown: true, // Show header for this screen
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.headerRightContainer}>
              <HeaderRight initials={initials} />
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
        name="assessments"
        options={{
          tabBarLabel: 'Assessment', // Tab label
          headerTitle: 'Olin', // Header title
          tabBarIcon: ({ color }) => <Ionicons name="document-text" size={24} color={color} />,
          headerShown: true, // Show header for this screen
          headerRight: () => <HeaderRight initials={initials} />,
          headerStyle: { backgroundColor: '#007bff' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarLabel: 'Settings', // Tab label
          headerTitle: 'Olin', // Header title
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

const HeaderRight = ({ initials }: { initials: string }) => {
  const { isConnected } = useNetworkStatus();

  return (
    <View style={{ justifyContent: 'center', alignItems: 'center' }}>
      <View>
        {initials ? (
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
          <View>
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
  initialsCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1E90FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  initialsText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#fff',
    zIndex: 2,
  },
});