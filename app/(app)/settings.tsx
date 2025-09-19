import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useNetworkStatus } from '../../context/NetworkContext'; // 👈 Import the hook
import { clearAuthToken, deleteProfileImage, getProfile, updateProfile } from '../../lib/api';
import { clearOfflineData } from '../../lib/localDb';

const { width: screenWidth } = Dimensions.get('window');

interface ProfileData {
  id: number;
  name: string;
  email: string;
  phone?: string;
  bio?: string;
  department?: string;
  title?: string;
  birth_date?: string;
  gender?: string;
  address?: string;
  profile_image?: string;
  role: string;
  program?: {
    id: number;
    name: string;
    code?: string;
  };
  section?: {
    id: number;
    name: string;
  };
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();
  const { isInternetReachable } = useNetworkStatus(); // 👈 Use the network hook

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: '',
    phone: '',
    bio: '',
    birth_date: '',
    gender: '',
    address: '',
  });
  const [selectedImage, setSelectedImage] = useState<any>(null);

  useEffect(() => {
    fetchProfileData();
  }, []);

  const fetchProfileData = async () => {
    try {
      setLoading(true);
      const profileData = await getProfile();
      
      if (profileData) {
        setProfile(profileData);
        // Initialize edit form with current data
        setEditForm({
          name: profileData.name || '',
          phone: profileData.phone || '',
          bio: profileData.bio || '',
          birth_date: profileData.birth_date || '',
          gender: profileData.gender || '',
          address: profileData.address || '',
        });
      } else {
        Alert.alert("Error", "Could not load profile data. Please log in again.");
        await clearAuthToken();
        router.replace('/login');
      }
    } catch (error) {
      console.error("Failed to fetch profile data:", error);
      Alert.alert("Error", "Failed to load profile. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchProfileData();
    setRefreshing(false);
  };

  const pickImage = async () => {
    try {
      // Request permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (permissionResult.granted === false) {
        Alert.alert("Permission Denied", "Permission to access camera roll is required!");
        return;
      }

      // Show options
      Alert.alert(
        "Select Image",
        "Choose an option",
        [
          {
            text: "Camera",
            onPress: async () => {
              const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
              if (cameraPermission.granted) {
                const result = await ImagePicker.launchCameraAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: true,
                  aspect: [1, 1],
                  quality: 0.7,
                });
                
                if (!result.canceled && result.assets[0]) {
                  setSelectedImage(result.assets[0]);
                }
              }
            }
          },
          {
            text: "Gallery",
            onPress: async () => {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.7,
              });
              
              if (!result.canceled && result.assets[0]) {
                setSelectedImage(result.assets[0]);
              }
            }
          },
          {
            text: "Cancel",
            style: "cancel"
          }
        ]
      );
    } catch (error) {
      console.error("Error picking image:", error);
      Alert.alert("Error", "Failed to pick image");
    }
  };

  const handleDeleteImage = async () => {
    Alert.alert(
      "Delete Profile Image",
      "Are you sure you want to delete your profile image?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setIsUpdating(true);
              const result = await deleteProfileImage();
              
              if (result.success) {
                Alert.alert("Success", "Profile image deleted successfully");
                await fetchProfileData(); // Refresh profile data
              } else {
                Alert.alert("Error", result.message);
              }
            } catch (error) {
              Alert.alert("Error", "Failed to delete profile image");
            } finally {
              setIsUpdating(false);
            }
          }
        }
      ]
    );
  };

  const handleUpdateProfile = async () => {
    try {
      setIsUpdating(true);
      
      // Validate required fields
      if (!editForm.name.trim()) {
        Alert.alert("Validation Error", "Name is required");
        return;
      }

      // Validate and format birth date
      let formattedData = { ...editForm };
      if (editForm.birth_date && editForm.birth_date.trim()) {
        // Check if it's already in YYYY-MM-DD format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(editForm.birth_date)) {
          // Try to parse and format the date
          const date = new Date(editForm.birth_date);
          if (isNaN(date.getTime())) {
            Alert.alert("Validation Error", "Please enter birth date in YYYY-MM-DD format (e.g., 1990-01-15)");
            return;
          }
          // Format to YYYY-MM-DD
          formattedData.birth_date = date.toISOString().split('T')[0];
        }
      } else {
        // Set to empty string instead of deleting
        formattedData.birth_date = '';
      }

      console.log('🔄 Starting profile update...');
      console.log('Form data to send:', formattedData);
      console.log('Selected image details:', selectedImage ? {
        fileName: selectedImage.fileName || 'unnamed',
        fileSize: selectedImage.fileSize || 'unknown size',
        type: selectedImage.type,
        uri: selectedImage.uri?.substring(0, 50) + '...'
      } : 'None');

      const result = await updateProfile(formattedData, selectedImage);
      
      console.log('🔄 Update result:', result);
      
      if (result.success) {
        Alert.alert("Success", "Profile updated successfully");
        setProfile(result.profile);
        setIsEditModalVisible(false);
        setSelectedImage(null);
        // Refresh profile data to get updated image URL
        await fetchProfileData();
      } else {
        if (result.errors) {
          // Show validation errors
          const errorMessages = Object.values(result.errors).flat().join('\n');
          Alert.alert("Validation Error", errorMessages);
        } else {
          Alert.alert("Error", result.message);
        }
      }
    } catch (error) {
      console.error('🚨 Profile update error in component:', error);
      Alert.alert(
        "Error", 
        "Failed to update profile. Please check:\n• Your internet connection\n• Laravel backend is running\n• Try again in a moment"
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out? This will clear all offline data.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          onPress: async () => {
            try {
              setLoading(true);
              await clearAuthToken();
              await clearOfflineData();
              router.replace('/login');
            } catch (error) {
              console.error('Logout error:', error);
              router.replace('/login');
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Not specified';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl 
          refreshing={refreshing} 
          onRefresh={handleRefresh} 
          enabled={isInternetReachable ?? false} // 👈 Disable refresh when offline
        />
      }
    >
      {/* Header Section */}
      <View style={styles.header}>
        <View style={styles.profileImageContainer}>
          <Image 
            source={
              profile?.profile_image 
                ? { uri: profile.profile_image }
                : require('../../assets/images/icon.png')
            }
            style={styles.profileImage}
          />
          <TouchableOpacity 
            style={[
              styles.editImageButton,
              !isInternetReachable && styles.disabledButton // 👈 Style for disabled state
            ]}
            onPress={() => setIsEditModalVisible(true)}
            disabled={!isInternetReachable} // 👈 Disable when offline
          >
            <Ionicons name="pencil" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
        
        <Text style={styles.userName}>{profile?.name}</Text>
        <Text style={styles.userEmail}>{profile?.email}</Text>
        
        {profile?.program && (
          <View style={styles.programBadge}>
            <Text style={styles.programText}>{profile.program.name}</Text>
          </View>
        )}
        
        {/* 👇 Offline Indicator */}
        {!isInternetReachable && (
          <View style={styles.offlineNotice}>
            <Ionicons name="cloud-offline-outline" size={18} color="#dc3545" />
            <Text style={styles.offlineText}>Offline Mode</Text>
          </View>
        )}
      </View>

      {/* Profile Information Cards */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Personal Information</Text>
        
        <ProfileCard title="Phone" value={profile?.phone} icon="call" />
        <ProfileCard title="Birth Date" value={formatDate(profile?.birth_date || '')} icon="calendar" />
        <ProfileCard title="Gender" value={profile?.gender} icon="person" />
        <ProfileCard title="Address" value={profile?.address} icon="location" />
      </View>

      {profile?.bio && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About Me</Text>
          <View style={styles.bioCard}>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        </View>
      )}

      {/* Academic Information */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Academic Information</Text>
        
        <ProfileCard 
          title="Role" 
          value={profile?.role?.charAt(0).toUpperCase() + profile?.role?.slice(1)} 
          icon="school" 
        />
        
        {profile?.program && (
          <ProfileCard 
            title="Program" 
            value={`${profile.program.name}${profile.program.code ? ` (${profile.program.code})` : ''}`} 
            icon="library" 
          />
        )}
        
        {profile?.section && (
          <ProfileCard title="Section" value={profile.section.name} icon="people" />
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actionSection}>
        <TouchableOpacity 
          style={[
            styles.editButton, 
            !isInternetReachable && styles.disabledButton // 👈 Style for disabled state
          ]} 
          onPress={() => setIsEditModalVisible(true)}
          disabled={!isInternetReachable} // 👈 Disable when offline
        >
          <Ionicons name="pencil" size={20} color="#fff" />
          <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[
            styles.logoutButton,
            !isInternetReachable && styles.disabledButton // 👈 Style for disabled state
          ]} 
          onPress={handleLogout}
          disabled={!isInternetReachable} // 👈 Disable when offline
        >
          <Ionicons name="log-out" size={20} color="#fff" />
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Edit Profile Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={isEditModalVisible}
        onRequestClose={() => setIsEditModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity 
              onPress={handleUpdateProfile}
              disabled={isUpdating || !isInternetReachable} // 👈 Disable save when offline
            >
              {isUpdating ? (
                <ActivityIndicator size="small" color="#007bff" />
              ) : (
                <Text style={[styles.saveButton, !isInternetReachable && styles.disabledText]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {/* 👇 Offline hint inside modal */}
            {!isInternetReachable && (
              <Text style={styles.offlineModalHint}>
                You are offline. Profile picture changes and saving are disabled.
              </Text>
            )}
            
            {/* Profile Image Section */}
            <View style={styles.imageSection}>
              <Text style={styles.fieldLabel}>Profile Image</Text>
              <View style={styles.imageEditContainer}>
                <Image 
                  source={
                    selectedImage?.uri ? { uri: selectedImage.uri } :
                    profile?.profile_image ? { uri: profile.profile_image } :
                    require('../../assets/images/icon.png')
                  }
                  style={styles.editProfileImage}
                />
                <View style={styles.imageButtons}>
                  <TouchableOpacity 
                    style={[styles.imageButton, !isInternetReachable && styles.disabledButton]} 
                    onPress={pickImage}
                    disabled={!isInternetReachable} // 👈 Disable when offline
                  >
                    <Ionicons name="camera" size={20} color="#007bff" />
                    <Text style={styles.imageButtonText}>Change</Text>
                  </TouchableOpacity>
                  {(profile?.profile_image || selectedImage) && (
                    <TouchableOpacity 
                      style={[
                        styles.imageButton, 
                        styles.deleteImageButton, 
                        !isInternetReachable && styles.disabledButton
                      ]} 
                      onPress={() => {
                        if (selectedImage) {
                          setSelectedImage(null);
                        } else {
                          handleDeleteImage();
                        }
                      }}
                      disabled={!isInternetReachable} // 👈 Disable when offline
                    >
                      <Ionicons name="trash" size={20} color="#dc3545" />
                      <Text style={[styles.imageButtonText, styles.deleteText]}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            {/* Form Fields */}
            <EditField
              label="Name *"
              value={editForm.name}
              onChangeText={(text) => setEditForm({...editForm, name: text})}
              placeholder="Enter your full name"
            />

            <EditField
              label="Phone"
              value={editForm.phone}
              onChangeText={(text) => setEditForm({...editForm, phone: text})}
              placeholder="Enter your phone number"
              keyboardType="phone-pad"
            />

            <EditField
              label="Bio"
              value={editForm.bio}
              onChangeText={(text) => setEditForm({...editForm, bio: text})}
              placeholder="Tell us about yourself"
              multiline
              numberOfLines={4}
            />

            <EditField
              label="Birth Date (YYYY-MM-DD)"
              value={editForm.birth_date}
              onChangeText={(text) => setEditForm({...editForm, birth_date: text})}
              placeholder="e.g., 1990-01-15"
            />

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Gender</Text>
              <View style={styles.genderContainer}>
                {['male', 'female', 'other'].map((gender) => (
                  <TouchableOpacity
                    key={gender}
                    style={[
                      styles.genderOption,
                      editForm.gender === gender && styles.selectedGender
                    ]}
                    onPress={() => setEditForm({...editForm, gender})}
                  >
                    <Text style={[
                      styles.genderText,
                      editForm.gender === gender && styles.selectedGenderText
                    ]}>
                      {gender.charAt(0).toUpperCase() + gender.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <EditField
              label="Address"
              value={editForm.address}
              onChangeText={(text) => setEditForm({...editForm, address: text})}
              placeholder="Enter your address"
              multiline
              numberOfLines={3}
            />
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

// Profile Card Component
const ProfileCard = ({ title, value, icon }: { title: string; value?: string; icon: any }) => (
  <View style={styles.profileCard}>
    <View style={styles.cardLeft}>
      <Ionicons name={icon} size={20} color="#007bff" />
      <Text style={styles.cardTitle}>{title}</Text>
    </View>
    <Text style={styles.cardValue}>{value || 'Not specified'}</Text>
  </View>
);

// Edit Field Component
const EditField = ({ 
  label, 
  value, 
  onChangeText, 
  placeholder, 
  multiline = false, 
  numberOfLines = 1,
  keyboardType = 'default'
}: any) => (
  <View style={styles.fieldContainer}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={[styles.textInput, multiline && styles.multilineInput]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      multiline={multiline}
      numberOfLines={numberOfLines}
      keyboardType={keyboardType}
    />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#6c757d',
  },
  
  // Header Section
  header: {
    backgroundColor: '#fff',
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    marginBottom: 20,
  },
  profileImageContainer: {
    position: 'relative',
    marginBottom: 15,
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#007bff',
  },
  editImageButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#007bff',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  userEmail: {
    fontSize: 16,
    color: '#6c757d',
    marginBottom: 10,
  },
  programBadge: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 15,
    paddingVertical: 5,
    borderRadius: 20,
  },
  programText: {
    color: '#1976d2',
    fontSize: 14,
    fontWeight: '600',
  },

  // Section Styles
  section: {
    marginHorizontal: 20,
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 15,
    paddingLeft: 5,
  },

  // Profile Card Styles
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 18,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#2c3e50',
    marginLeft: 12,
  },
  cardValue: {
    fontSize: 15,
    color: '#6c757d',
    textAlign: 'right',
    flex: 1,
  },

  // Bio Card
  bioCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  bioText: {
    fontSize: 15,
    color: '#495057',
    lineHeight: 22,
  },

  // Action Section
  actionSection: {
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 40,
  },
  editButton: {
    backgroundColor: '#007bff',
    borderRadius: 15,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
    shadowColor: '#007bff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  editButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  logoutButton: {
    backgroundColor: '#dc3545',
    borderRadius: 15,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#dc3545',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },

  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#dee2e6',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
  },
  saveButton: {
    color: '#007bff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },

  // Image Section
  imageSection: {
    marginBottom: 30,
  },
  imageEditContainer: {
    alignItems: 'center',
  },
  editProfileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 15,
    borderWidth: 3,
    borderColor: '#dee2e6',
  },
  imageButtons: {
    flexDirection: 'row',
    gap: 15,
  },
  imageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#007bff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  deleteImageButton: {
    borderColor: '#dc3545',
  },
  imageButtonText: {
    color: '#007bff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 5,
  },
  deleteText: {
    color: '#dc3545',
  },

  // Form Field Styles
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#2c3e50',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#dee2e6',
    color: '#495057',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },

  // Gender Selection
  genderContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  genderOption: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  selectedGender: {
    backgroundColor: '#007bff',
    borderColor: '#007bff',
  },
  genderText: {
    fontSize: 15,
    color: '#495057',
    fontWeight: '500',
  },
  selectedGenderText: {
    color: '#fff',
  },
  
  // 👇 New Styles for offline state
  disabledButton: {
    opacity: 0.5,
  },
  disabledText: {
    color: '#6c757d',
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8d7da',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 15,
  },
  offlineText: {
    color: '#721c24',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  offlineModalHint: {
    fontSize: 14,
    color: '#721c24',
    textAlign: 'center',
    marginBottom: 20,
    fontStyle: 'italic',
    backgroundColor: '#f8d7da',
    padding: 10,
    borderRadius: 8,
  },
});