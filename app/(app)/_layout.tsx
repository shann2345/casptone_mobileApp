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
        // IMPORTANT: Remove headerStyle, headerTintColor, headerTitleStyle from here
        // These should be managed by the nested Stack if headerShown is false
        // for the Tabs.
        headerShown: false, // This should make the Tabs *not* render a header at all
      }}
    >
       <Tabs.Screen
        name="index" // Dashboard
        options={{
          title: 'Olin', 
          tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />,
          headerShown: true,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              style={styles.headerRightContainer}
            >
              {initials ? (
                <View style={styles.initialsCircle}>
                  <Text style={styles.initialsText}>{initials}</Text>
                </View>
              ) : (
                <Ionicons name="person-circle-outline" size={30} color="#fff" />
              )}
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
          title: 'Olin', 
          tabBarIcon: ({ color }) => <Ionicons name="book" size={24} color={color} />,
          headerShown: false, // <--- **THIS IS THE KEY CHANGE for the Courses Tab**
                              // The nested Stack in app/(app)/courses/_layout.tsx will handle the header
        }}
      />
      <Tabs.Screen
        name="assessments"
        options={{
          title: 'Olin', 
          tabBarIcon: ({ color }) => <Ionicons name="document-text" size={24} color={color} />,
          headerShown: true, // Let Assessments manage its own header
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              style={styles.headerRightContainer}
            >
              {initials ? (
                <View style={styles.initialsCircle}>
                  <Text style={styles.initialsText}>{initials}</Text>
                </View>
              ) : (
                <Ionicons name="person-circle-outline" size={30} color="#fff" />
              )}
            </TouchableOpacity>
          ),
          headerStyle: { backgroundColor: '#007bff' }, // Apply header styles here
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Olin', 
          tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
          headerShown: true, // Let Settings manage its own header
          headerStyle: { backgroundColor: '#007bff' }, // Apply header styles here
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
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