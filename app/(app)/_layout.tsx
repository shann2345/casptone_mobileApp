// app/(app)/_layout.tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react'; // Import useEffect and useState
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'; // Import Text

import { getUserData } from '../../lib/api'; // Import getUserData

export default function AppLayout() {
  const router = useRouter();
  const [initials, setInitials] = useState<string>(''); // State to store initials

  useEffect(() => {
    const fetchUserNameAndSetInitials = async () => {
      try {
        const userData = await getUserData();
        if (userData && userData.name) {
          const firstLetter = userData.name.charAt(0).toUpperCase();
          setInitials(firstLetter);
        } else {
          // Fallback if no user data or name, perhaps show a default icon
          setInitials('?'); // Or an empty string to hide it, or 'U' for 'User'
        }
      } catch (error) {
        console.error('Error fetching user data for initials:', error);
        setInitials('?'); // Fallback on error
      }
    };

    fetchUserNameAndSetInitials();
  }, []); // Empty dependency array means this runs once on mount

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#007bff',
        tabBarInactiveTintColor: '#888',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#ccc',
          height: 60,
          paddingBottom: 5,
        },
        tabBarLabelStyle: {
          fontSize: 12,
        },
        headerStyle: {
          backgroundColor: '#007bff',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Tabs.Screen
        name="index" // This matches app/(app)/index.tsx (Dashboard)
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              style={styles.headerRightContainer} // Use a style for the container
            >
              {initials ? (
                <View style={styles.initialsCircle}>
                  <Text style={styles.initialsText}>{initials}</Text>
                </View>
              ) : (
                // Fallback to a default icon if initials are not yet loaded or available
                <Ionicons name="person-circle-outline" size={30} color="#fff" />
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: 'Courses',
          tabBarIcon: ({ color }) => <Ionicons name="book" size={24} color={color} />,
          headerShown: true,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              style={styles.headerRightContainer} // Use a style for the container
            >
              {initials ? (
                <View style={styles.initialsCircle}>
                  <Text style={styles.initialsText}>{initials}</Text>
                </View>
              ) : (
                // Fallback to a default icon if initials are not yet loaded or available
                <Ionicons name="person-circle-outline" size={30} color="#fff" />
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="assessments"
        options={{
          title: 'Assessments',
          tabBarIcon: ({ color }) => <Ionicons name="document-text" size={24} color={color} />,
          headerShown: true,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              style={styles.headerRightContainer} // Use a style for the container
            >
              {initials ? (
                <View style={styles.initialsCircle}>
                  <Text style={styles.initialsText}>{initials}</Text>
                </View>
              ) : (
                // Fallback to a default icon if initials are not yet loaded or available
                <Ionicons name="person-circle-outline" size={30} color="#fff" />
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
          headerShown: true,
        }}
      />
      {/* Add more tabs here as needed */}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // ... (keep existing styles)

  headerRightContainer: {
    marginRight: 15,
    // Add any container specific styles if needed
  },
  initialsCircle: {
    width: 30, // Adjust size as needed
    height: 30, // Adjust size as needed
    borderRadius: 15, // Half of width/height to make it a circle
    backgroundColor: '#1E90FF', // A distinct background color for the circle
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1, // Optional: add a border
    borderColor: '#fff', // Optional: border color
  },
  initialsText: {
    color: '#fff', // White text color
    fontSize: 16, // Adjust font size to fit the circle
    fontWeight: 'bold',
  },
});