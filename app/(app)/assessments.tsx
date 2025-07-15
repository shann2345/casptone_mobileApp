import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function AssessmentsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Assessments</Text>
      <Text>View your quizzes, assignments, and exam results here.</Text>
      {/* Add your assessment listing components here */}
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