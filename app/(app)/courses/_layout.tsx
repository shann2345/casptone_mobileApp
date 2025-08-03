// app/(app)/courses/_layout.tsx (Example if you needed to customize materials/[materialId] specifically)
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../../context/NetworkContext'; // Adjust path as needed
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
              <HeaderRight initials={initials} />
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
          headerRight: () => <HeaderRight initials={initials} />,
        }}
      />
      {/* If you wanted specific options for material details */}
      <Stack.Screen
        name="materials/[materialId]" // Match the folder structure
        options={{
          headerStyle: { backgroundColor: '#007bff' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          headerRight: () => <HeaderRight initials={initials} />,
        }}
      />
      <Stack.Screen
        name="assessments/[assessmentId]" // Match the folder structure
        options={{
          headerStyle: { backgroundColor: '#007bff' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          headerRight: () => <HeaderRight initials={initials} />,
        }}
      />
    </Stack>
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