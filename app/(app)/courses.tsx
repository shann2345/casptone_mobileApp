import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function CoursesScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Courses</Text>
      <Text>Here you can see all your enrolled courses.</Text>
      {/* Add your course listing components here */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
});