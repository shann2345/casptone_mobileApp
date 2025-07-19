// app/(app)/courses/_layout.tsx
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react'; // Import useEffect and useState
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'; // Import Text

import { getUserData } from '../../../lib/api'; // Import getUserData

export default function CoursesLayout() {
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
    <Stack>
      <Stack.Screen 
        name="index" 
        options={{
          title: 'Olin', 
          headerShown: true, // Let Settings manage its own header
          headerStyle: { backgroundColor: '#007bff' }, // Apply header styles here
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
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
        }} 
      />
      <Stack.Screen 
        name="[id]"
        options={{
          presentation: 'modal',
          headerStyle: { backgroundColor: '#007bff' }, // Apply header styles here
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
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
        }} 
      />
    </Stack>
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