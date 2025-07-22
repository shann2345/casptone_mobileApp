// app/(app)/courses/_layout.tsx (Example if you needed to customize materials/[materialId] specifically)
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getUserData } from '../../../lib/api';

export default function CoursesLayout() {
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
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Olin',
          headerShown: true,
          headerStyle: { backgroundColor: '#007bff' },
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
          headerStyle: { backgroundColor: '#007bff' },
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
      {/* If you wanted specific options for material details */}
      <Stack.Screen
        name="materials/[materialId]" // Match the folder structure
        options={{
          headerStyle: { backgroundColor: '#007bff' },
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
});