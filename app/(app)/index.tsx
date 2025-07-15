import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'; // Import Modal and TextInput
import { clearAuthToken, getUserData } from '../../lib/api';

export default function HomeScreen() {
  const router = useRouter();
  const [userName, setUserName] = useState<string>('Guest');
  const [isSearchModalVisible, setSearchModalVisible] = useState<boolean>(false); // State for modal visibility
  const [searchQuery, setSearchQuery] = useState<string>(''); // State for search input

  useEffect(() => {
    const fetchUserName = async () => {
      try {
        const userData = await getUserData();
        if (userData && userData.name) {
          setUserName(userData.name);
        } else {
          console.warn('User data or name not found in local storage. Redirecting to login.');
          await clearAuthToken();
          router.replace('/login');
        }
      } catch (error) {
        console.error('Error fetching user name:', error);
        await clearAuthToken();
        router.replace('/login');
      }
    };

    fetchUserName();
  }, []);

  const handleSearchPress = () => {
    setSearchModalVisible(true); // Open the search modal
  };

  const handleSearchSubmit = () => {
    // Here you would typically perform your search logic
    console.log('Searching for:', searchQuery);
    alert(`Searching for: ${searchQuery}`);
    setSearchModalVisible(false); // Close the modal after search
    setSearchQuery(''); // Clear the search query
    // In a real app, you'd navigate to a search results page or update the current view
    // router.push(`/search-results?query=${searchQuery}`);
  };

  return (
    <ScrollView style={styles.container}>
      {/* Header/Welcome Section */}
      <View style={styles.header}>
        <Text style={styles.welcomeText}>Welcome, {userName}!</Text>
        <Text style={styles.subText}>Start learning something new today.</Text>
      </View>

      {/* Search Button */}
      <TouchableOpacity style={styles.searchButton} onPress={handleSearchPress}>
        <Ionicons name="search" size={20} color="#fff" style={styles.searchIcon} />
        <Text style={styles.searchButtonText}>Search for Courses, Topics, etc.</Text>
      </TouchableOpacity>

      {/* New Section/Space below search button */}
      <View style={styles.newSection}>
        <Text style={styles.newSectionTitle}>Featured Content</Text>
        <Text style={styles.newSectionText}>
          Explore popular courses and trending topics designed for you.
        </Text>
        {/* You can add more components here, e.g., a horizontal scroll view of featured items */}
      </View>

      {/* Quick Access Section - Your existing content */}
      <View style={styles.quickAccessContainer}>
        <Text style={styles.quickAccessTitle}>Quick Access</Text>
        <View style={styles.cardsGrid}>
          {/* Example Cards (you'd replace this with dynamic data) */}
          <TouchableOpacity style={styles.card} onPress={() => console.log('My Courses')}>
            <Ionicons name="book-outline" size={40} color="#007bff" />
            <Text style={styles.cardText}>My Courses</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.card} onPress={() => console.log('Progress')}>
            <Ionicons name="stats-chart-outline" size={40} color="#28a745" />
            <Text style={styles.cardText}>My Progress</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.card} onPress={() => console.log('Saved')}>
            <Ionicons name="bookmark-outline" size={40} color="#ffc107" />
            <Text style={styles.cardText}>Saved Items</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.card} onPress={() => console.log('Help')}>
            <Ionicons name="help-circle-outline" size={40} color="#6c757d" />
            <Text style={styles.cardText}>Help & Support</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Other Content Section - Your existing content */}
      <View style={styles.otherContent}>
        <Text style={styles.quickAccessTitle}>Your Learning Journey</Text>
        <Text style={styles.subText}>
          Continue where you left off or discover new materials.
        </Text>
        {/* Potentially a list of recent courses or recommendations */}
      </View>

      {/* Search Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isSearchModalVisible}
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => setSearchModalVisible(false)} style={styles.closeButton}>
              <Ionicons name="close-circle-outline" size={30} color="#6c757d" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Search</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Enter your search query"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearchSubmit} // Trigger search on keyboard "Done"
            />
            <TouchableOpacity style={styles.modalSearchButton} onPress={handleSearchSubmit}>
              <Text style={styles.modalSearchButtonText}>Search</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5', // Light background for the whole screen
    padding: 20, // Global padding
  },
  header: {
    marginBottom: 25, // Space below the welcome message
  },
  welcomeText: {
    fontSize: 26, // Slightly larger for emphasis
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  subText: {
    fontSize: 16,
    color: '#7f8c8d',
  },
  // --- New Styles for Search Button ---
  searchButton: {
    flexDirection: 'row', // Arrange icon and text horizontally
    alignItems: 'center',
    backgroundColor: '#007bff', // A primary color for the button
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 10, // Rounded corners
    marginBottom: 25, // Space below the button
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3, // For Android shadow
  },
  searchIcon: {
    marginRight: 10, // Space between icon and text
  },
  searchButtonText: {
    color: '#fff', // White text
    fontSize: 16,
    fontWeight: '600',
  },
  // --- New Styles for New Section ---
  newSection: {
    backgroundColor: '#ffffff', // White background
    borderRadius: 15, // Rounded corners
    padding: 20,
    marginBottom: 20, // Space below this section
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  newSectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 10,
  },
  newSectionText: {
    fontSize: 15,
    color: '#7f8c8d',
    lineHeight: 22, // Improve readability
  },
  // --- Existing Styles (adjust margins as needed after adding new elements) ---
  quickAccessContainer: {
    marginBottom: 20, // Keep some space before the next section
  },
  quickAccessTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 15,
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    width: '48%', // Approx half-width with spacing
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 3,
  },
  cardText: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '600',
    color: '#34495e',
  },
  otherContent: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20, // Adjust as needed
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
   modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // Dim the background
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 20,
    width: '90%',
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  closeButton: {
    alignSelf: 'flex-end',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 20,
    textAlign: 'center',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  modalSearchButton: {
    backgroundColor: '#007bff',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalSearchButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});