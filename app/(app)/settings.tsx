// app/(app)/settings.tsx
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetworkStatus } from '../../context/NetworkContext';
import { clearAuthToken, deleteProfileImage, getProfile, updateProfile } from '../../lib/api';

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

export default function SettingsScreen() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Modal states
  const [isProfileModalVisible, setIsProfileModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isNotificationSettingsVisible, setIsNotificationSettingsVisible] = useState(false);
  const [isPrivacyModalVisible, setIsPrivacyModalVisible] = useState(false);
  const [isAboutModalVisible, setIsAboutModalVisible] = useState(false);
  
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();
  const { isInternetReachable } = useNetworkStatus();

  usePendingSyncNotification(isInternetReachable, 'settings');

  // Notification preferences
  const [notificationSettings, setNotificationSettings] = useState({
    pushNotifications: false,
    emailNotifications: false,
    courseUpdates: false,
    assignmentReminders: false,
    gradeNotifications: false,
    materialReminders: true,
  });

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
    if (isInternetReachable !== null) {
      fetchProfileData();
    }
  }, [isInternetReachable]);

  const fetchProfileData = async () => {
    if (!isInternetReachable) {
      console.log('⚠️ Offline - skipping profile data fetch');
      setLoading(false);
      Alert.alert('Offline Mode', 'You are currently offline. Profile data cannot be loaded.');
      return;
    }

    try {
      setLoading(true);
      const profileData = await getProfile();
      if (profileData) {
        setProfile(profileData);
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
    if (!isInternetReachable) {
      Alert.alert(
        '📵 Offline Mode', 
        'You are currently offline. Cannot refresh profile data.',
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }
    setRefreshing(true);
    await fetchProfileData();
    setRefreshing(false);
  };

  const pickImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.granted === false) {
        Alert.alert(
          "🚫 Permission Denied", 
          "Permission to access camera roll is required!",
          [{ text: 'OK', style: 'default' }]
        );
        return;
      }
      Alert.alert("📷 Select Image", "Choose an option", [
        { text: "📸 Camera", onPress: async () => {
            const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
            if (cameraPermission.granted) {
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7,
              });
              if (!result.canceled && result.assets[0]) setSelectedImage(result.assets[0]);
            }
          }},
        { text: "🖼️ Gallery", onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7,
            });
            if (!result.canceled && result.assets[0]) setSelectedImage(result.assets[0]);
          }},
        { text: "Cancel", style: "cancel" }
      ]);
    } catch (error) {
      console.error("Error picking image:", error);
      Alert.alert(
        "❌ Error", 
        "Failed to pick image",
        [{ text: 'OK', style: 'default' }]
      );
    }
  };

  const handleDeleteImage = async () => {
    if (!isInternetReachable) {
      Alert.alert(
        '📵 Offline Mode', 
        'Cannot delete profile image while offline.',
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }
    Alert.alert("🗑️ Delete Profile Image", "Are you sure you want to delete your profile image?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
          try {
            setIsUpdating(true);
            const result = await deleteProfileImage();
            if (result.success) {
              Alert.alert(
                "✅ Success", 
                "Profile image deleted successfully",
                [{ text: 'OK', style: 'default' }]
              );
              await fetchProfileData();
            } else {
              Alert.alert(
                "❌ Error", 
                result.message,
                [{ text: 'OK', style: 'default' }]
              );
            }
          } catch (error) {
            Alert.alert(
              "❌ Error", 
              "Failed to delete profile image",
              [{ text: 'OK', style: 'default' }]
            );
          } finally {
            setIsUpdating(false);
          }
        }}
    ]);
  };

  const handleUpdateProfile = async () => {
    if (!isInternetReachable) {
      Alert.alert(
        '📵 Offline Mode', 
        'Cannot update profile while offline.',
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }
    try {
      setIsUpdating(true);
      if (!editForm.name.trim()) {
        Alert.alert(
          "⚠️ Validation Error", 
          "Name is required",
          [{ text: 'OK', style: 'default' }]
        );
        return;
      }
      let formattedData = { ...editForm };
      if (editForm.birth_date && editForm.birth_date.trim()) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(editForm.birth_date)) {
          const date = new Date(editForm.birth_date);
          if (isNaN(date.getTime())) {
            Alert.alert(
              "⚠️ Validation Error", 
              "Please enter birth date in YYYY-MM-DD format.",
              [{ text: 'OK', style: 'default' }]
            );
            return;
          }
          formattedData.birth_date = date.toISOString().split('T')[0];
        }
      } else {
        formattedData.birth_date = '';
      }
      const result = await updateProfile(formattedData, selectedImage);
      if (result.success) {
        Alert.alert(
          "✅ Success", 
          "Profile updated successfully",
          [{ text: 'OK', style: 'default' }]
        );
        setProfile(result.profile);
        setIsEditModalVisible(false);
        setSelectedImage(null);
        await fetchProfileData();
      } else {
        if (result.errors) {
          const errorMessages = Object.values(result.errors).flat().join('\n');
          Alert.alert(
            "⚠️ Validation Error", 
            errorMessages,
            [{ text: 'OK', style: 'default' }]
          );
        } else {
          Alert.alert(
            "❌ Error", 
            result.message,
            [{ text: 'OK', style: 'default' }]
          );
        }
      }
    } catch (error) {
      console.error('🚨 Profile update error in component:', error);
      Alert.alert(
        "❌ Error", 
        "Failed to update profile. Please try again.",
        [{ text: 'OK', style: 'default' }]
      );
    } finally {
      setIsUpdating(false);
    }
  };

  // ❌ handleLogout function has been removed from here

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Not specified';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading settings...</Text>
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
          enabled={isInternetReachable ?? false}
        />
      }
    >
      {/* User Info Header */}
      <View style={styles.userInfoHeader}>
        <View style={styles.userInfoContent}>
          <Image 
            source={profile?.profile_image ? { uri: profile.profile_image } : require('../../assets/images/icon.png')}
            style={styles.smallProfileImage}
          />
          <View style={styles.userTextInfo}>
            <Text style={styles.userNameSmall}>{profile?.name}</Text>
            <Text style={styles.userEmailSmall}>{profile?.email}</Text>
          </View>
        </View>
        {!isInternetReachable && (
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-offline-outline" size={14} color="#dc3545" />
            <Text style={styles.offlineBadgeText}>Offline</Text>
          </View>
        )}
      </View>

      {/* Account Section */}
      <View style={styles.settingsSection}>
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <SettingsButton
          icon="person-outline"
          title="Profile"
          subtitle="View and edit your profile"
          onPress={() => setIsProfileModalVisible(true)}
        />
        <SettingsButton
          icon="notifications-outline"
          title="Notifications"
          subtitle="Manage notification preferences"
          onPress={() => setIsNotificationSettingsVisible(true)}
        />
        <SettingsButton
          icon="lock-closed-outline"
          title="Privacy & Security"
          subtitle="Manage your privacy settings"
          onPress={() => setIsPrivacyModalVisible(true)}
        />
      </View>

      {/* General Section */}
      <View style={styles.settingsSection}>
        <Text style={styles.sectionTitle}>GENERAL</Text>
        <SettingsButton
          icon="language-outline"
          title="Language"
          subtitle="English (US)"
          onPress={() => Alert.alert('🌐 Language', 'Language settings coming soon', [{ text: 'OK', style: 'default' }])}
        />
        <SettingsButton
          icon="download-outline"
          title="Download Preferences"
          subtitle="Manage offline content"
          onPress={() => Alert.alert('📥 Downloads', 'Download preferences coming soon', [{ text: 'OK', style: 'default' }])}
        />
        <SettingsButton
          icon="color-palette-outline"
          title="Appearance"
          subtitle="Light mode"
          onPress={() => Alert.alert('🎨 Appearance', 'Theme settings coming soon', [{ text: 'OK', style: 'default' }])}
        />
      </View>

      {/* Support Section */}
      <View style={styles.settingsSection}>
        <Text style={styles.sectionTitle}>SUPPORT</Text>
        <SettingsButton
          icon="help-circle-outline"
          title="Help & Support"
          subtitle="Get help with the app"
          onPress={() => Alert.alert('❓ Help', 'Help center coming soon', [{ text: 'OK', style: 'default' }])}
        />
        <SettingsButton
          icon="information-circle-outline"
          title="About"
          subtitle="App version and information"
          onPress={() => setIsAboutModalVisible(true)}
        />
      </View>

      {/* App Version */}
      <View style={styles.versionContainer}>
        <Text style={styles.versionText}>Version 1.0.0</Text>
        <Text style={styles.copyrightText}>© 2025 LMS Mobile App</Text>
      </View>

      {/* Profile View Modal */}
      <ProfileModal
        visible={isProfileModalVisible}
        onClose={() => setIsProfileModalVisible(false)}
        onEdit={() => {
          setIsProfileModalVisible(false);
          setIsEditModalVisible(true);
        }}
        profile={profile}
        formatDate={formatDate}
        isInternetReachable={isInternetReachable}
      />

      {/* Edit Profile Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={isEditModalVisible}
        onRequestClose={() => setIsEditModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={handleUpdateProfile} disabled={isUpdating || !isInternetReachable}>
              {isUpdating ? <ActivityIndicator size="small" color="#007bff" /> : <Text style={[styles.saveButton, !isInternetReachable && styles.disabledText]}>Save</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            {!isInternetReachable && (
              <Text style={styles.offlineModalHint}>You are offline. Profile picture changes and saving are disabled.</Text>
            )}
            <View style={styles.imageSection}>
              <Text style={styles.fieldLabel}>Profile Image</Text>
              <View style={styles.imageEditContainer}>
                <Image 
                  source={selectedImage?.uri ? { uri: selectedImage.uri } : profile?.profile_image ? { uri: profile.profile_image } : require('../../assets/images/icon.png')}
                  style={styles.editProfileImage}
                />
                <View style={styles.imageButtons}>
                  <TouchableOpacity style={[styles.imageButton, !isInternetReachable && styles.disabledButton]} onPress={pickImage} disabled={!isInternetReachable}>
                    <Ionicons name="camera" size={20} color="#007bff" />
                    <Text style={styles.imageButtonText}>Change</Text>
                  </TouchableOpacity>
                  {(profile?.profile_image || selectedImage) && (
                    <TouchableOpacity style={[styles.imageButton, styles.deleteImageButton, !isInternetReachable && styles.disabledButton]} onPress={() => { if (selectedImage) setSelectedImage(null); else handleDeleteImage(); }} disabled={!isInternetReachable}>
                      <Ionicons name="trash" size={20} color="#dc3545" />
                      <Text style={[styles.imageButtonText, styles.deleteText]}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
            <EditField label="Name *" value={editForm.name} onChangeText={(text: string) => setEditForm({...editForm, name: text})} placeholder="Enter your full name" />
            <EditField label="Phone" value={editForm.phone} onChangeText={(text: string) => setEditForm({...editForm, phone: text})} placeholder="Enter your phone number" keyboardType="phone-pad" />
            <EditField label="Bio" value={editForm.bio} onChangeText={(text: string) => setEditForm({...editForm, bio: text})} placeholder="Tell us about yourself" multiline numberOfLines={4} />
            <EditField label="Birth Date (YYYY-MM-DD)" value={editForm.birth_date} onChangeText={(text: string) => setEditForm({...editForm, birth_date: text})} placeholder="e.g., 1990-01-15" />
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Gender</Text>
              <View style={styles.genderContainer}>
                {['male', 'female', 'other'].map((gender) => (
                  <TouchableOpacity key={gender} style={[styles.genderOption, editForm.gender === gender && styles.selectedGender]} onPress={() => setEditForm({...editForm, gender})}>
                    <Text style={[styles.genderText, editForm.gender === gender && styles.selectedGenderText]}>{gender.charAt(0).toUpperCase() + gender.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <EditField label="Address" value={editForm.address} onChangeText={(text: string) => setEditForm({...editForm, address: text})} placeholder="Enter your address" multiline numberOfLines={3} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Notification Settings Modal */}
      <NotificationSettingsModal
        visible={isNotificationSettingsVisible}
        onClose={() => setIsNotificationSettingsVisible(false)}
        settings={notificationSettings}
        onSettingChange={(key: string, value: boolean) => setNotificationSettings({...notificationSettings, [key]: value})}
      />

      {/* Privacy Modal */}
      <PrivacyModal
        visible={isPrivacyModalVisible}
        onClose={() => setIsPrivacyModalVisible(false)}
      />

      {/* About Modal */}
      <AboutModal
        visible={isAboutModalVisible}
        onClose={() => setIsAboutModalVisible(false)}
      />
    </ScrollView>
  );
}

// Settings Button Component
const SettingsButton = ({ icon, title, subtitle, onPress, showArrow = true }: {
  icon: any;
  title: string;
  subtitle: string;
  onPress: () => void;
  showArrow?: boolean;
}) => (
  <TouchableOpacity style={styles.settingsButton} onPress={onPress}>
    <View style={styles.settingsButtonLeft}>
      <View style={styles.iconContainer}>
        <Ionicons name={icon} size={24} color="#007bff" />
      </View>
      <View style={styles.settingsButtonText}>
        <Text style={styles.settingsButtonTitle}>{title}</Text>
        <Text style={styles.settingsButtonSubtitle}>{subtitle}</Text>
      </View>
    </View>
    {showArrow && <Ionicons name="chevron-forward" size={20} color="#adb5bd" />}
  </TouchableOpacity>
);

// Profile Modal Component
const ProfileModal = ({ visible, onClose, onEdit, profile, formatDate, isInternetReachable }: any) => (
  <Modal
    animationType="slide"
    transparent={false}
    visible={visible}
    onRequestClose={onClose}
  >
    <SafeAreaView style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Profile</Text>
        <TouchableOpacity onPress={onEdit} disabled={!isInternetReachable}>
          <Ionicons name="pencil" size={24} color={isInternetReachable ? "#007bff" : "#adb5bd"} />
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.modalContent}>
        <View style={styles.profileModalHeader}>
          <Image 
            source={profile?.profile_image ? { uri: profile.profile_image } : require('../../assets/images/icon.png')}
            style={styles.profileImage}
          />
          <Text style={styles.userName}>{profile?.name}</Text>
          <Text style={styles.userEmail}>{profile?.email}</Text>
          {profile?.program && (
            <View style={styles.programBadge}>
              <Text style={styles.programText}>{profile.program.name}</Text>
            </View>
          )}
        </View>

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
            <View style={styles.bioCard}><Text style={styles.bioText}>{profile.bio}</Text></View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Academic Information</Text>
          <ProfileCard title="Role" value={profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : 'Not specified'} icon="school" />
          {profile?.program && <ProfileCard title="Program" value={`${profile.program.name}${profile.program.code ? ` (${profile.program.code})` : ''}`} icon="library" />}
          {profile?.section && <ProfileCard title="Section" value={profile.section.name} icon="people" />}
        </View>
      </ScrollView>
    </SafeAreaView>
  </Modal>
);

// Notification Settings Modal
const NotificationSettingsModal = ({ visible, onClose, settings, onSettingChange }: any) => (
  <Modal
    animationType="slide"
    transparent={false}
    visible={visible}
    onRequestClose={onClose}
  >
    <SafeAreaView style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView style={styles.modalContent}>
        <View style={styles.notificationInfoBanner}>
          <Ionicons name="information-circle" size={20} color="#0c5460" />
          <Text style={styles.notificationInfoText}>
            Notification settings are managed by your institution and cannot be changed.
          </Text>
        </View>
        <NotificationToggle
          title="Push Notifications"
          subtitle="Receive push notifications"
          value={settings.pushNotifications}
          onValueChange={(value: boolean) => onSettingChange('pushNotifications', value)}
          disabled={true}
        />
        <NotificationToggle
          title="Email Notifications"
          subtitle="Receive email updates"
          value={settings.emailNotifications}
          onValueChange={(value: boolean) => onSettingChange('emailNotifications', value)}
          disabled={true}
        />
        <NotificationToggle
          title="Course Updates"
          subtitle="Get notified about course changes"
          value={settings.courseUpdates}
          onValueChange={(value: boolean) => onSettingChange('courseUpdates', value)}
          disabled={true}
        />
        <NotificationToggle
          title="Assignment Reminders"
          subtitle="Reminders for upcoming assignments"
          value={settings.assignmentReminders}
          onValueChange={(value: boolean) => onSettingChange('assignmentReminders', value)}
          disabled={true}
        />
        <NotificationToggle
          title="Grade Notifications"
          subtitle="Get notified when grades are posted"
          value={settings.gradeNotifications}
          onValueChange={(value: boolean) => onSettingChange('gradeNotifications', value)}
          disabled={true}
        />
        <NotificationToggle
          title="Material Reminders"
          subtitle="Get notified about new course materials"
          value={settings.materialReminders}
          onValueChange={(value: boolean) => onSettingChange('materialReminders', value)}
          disabled={true}
        />
      </ScrollView>
    </SafeAreaView>
  </Modal>
);

// Notification Toggle Component
const NotificationToggle = ({ title, subtitle, value, onValueChange, disabled = false }: any) => (
  <View style={[styles.notificationToggle, disabled && styles.disabledToggle]}>
    <View style={styles.notificationToggleText}>
      <Text style={[styles.notificationToggleTitle, disabled && styles.disabledToggleText]}>{title}</Text>
      <Text style={styles.notificationToggleSubtitle}>{subtitle}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={disabled ? undefined : onValueChange}
      trackColor={{ false: '#d1d5db', true: disabled ? '#adb5bd' : '#93c5fd' }}
      thumbColor={value ? (disabled ? '#6c757d' : '#007bff') : '#f3f4f6'}
      disabled={disabled}
    />
  </View>
);

// Privacy Modal
const PrivacyModal = ({ visible, onClose }: any) => (
  <Modal
    animationType="slide"
    transparent={false}
    visible={visible}
    onRequestClose={onClose}
  >
    <SafeAreaView style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Privacy & Security</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView style={styles.modalContent}>
        <View style={styles.privacySection}>
          <Ionicons name="lock-closed" size={48} color="#007bff" />
          <Text style={styles.privacyTitle}>Your Privacy Matters</Text>
          <Text style={styles.privacyText}>
            We take your privacy seriously. Your personal information is encrypted and stored securely.
          </Text>
        </View>
        <SettingsButton
          icon="shield-checkmark-outline"
          title="Data Protection"
          subtitle="How we protect your data"
          onPress={() => Alert.alert('🛡️ Data Protection', 'Data protection coming soon', [{ text: 'OK', style: 'default' }])}
        />
        <SettingsButton
          icon="eye-off-outline"
          title="Privacy Policy"
          subtitle="Read our privacy policy"
          onPress={() => Alert.alert('🔒 Privacy Policy', 'Privacy policy coming soon', [{ text: 'OK', style: 'default' }])}
        />
        <SettingsButton
          icon="document-text-outline"
          title="Terms of Service"
          subtitle="Read our terms of service"
          onPress={() => Alert.alert('📄 Terms', 'Terms of service coming soon', [{ text: 'OK', style: 'default' }])}
        />
      </ScrollView>
    </SafeAreaView>
  </Modal>
);

// About Modal
const AboutModal = ({ visible, onClose }: any) => (
  <Modal
    animationType="slide"
    transparent={false}
    visible={visible}
    onRequestClose={onClose}
  >
    <SafeAreaView style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>About</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView style={styles.modalContent}>
        <View style={styles.aboutSection}>
          <Image 
            source={require('../../assets/images/icon.png')}
            style={styles.aboutLogo}
          />
          <Text style={styles.aboutAppName}>LMS Mobile App</Text>
          <Text style={styles.aboutVersion}>Version 1.0.0</Text>
          <Text style={styles.aboutDescription}>
            A comprehensive Learning Management System designed to enhance your educational experience.
          </Text>
        </View>
        <View style={styles.aboutInfoSection}>
          <Text style={styles.aboutInfoTitle}>Features</Text>
          <Text style={styles.aboutInfoText}>• Access courses and materials offline</Text>
          <Text style={styles.aboutInfoText}>• Real-time notifications</Text>
          <Text style={styles.aboutInfoText}>• Assignment tracking</Text>
          <Text style={styles.aboutInfoText}>• Grade monitoring</Text>
          <Text style={styles.aboutInfoText}>• Interactive quizzes and assessments</Text>
        </View>
        <View style={styles.aboutInfoSection}>
          <Text style={styles.aboutInfoTitle}>Contact</Text>
          <Text style={styles.aboutInfoText}>Email: olinlms123@gmail.com</Text>
          <Text style={styles.aboutInfoText}>Website: https://www.olinlms.com (Note: This website is for instructors only)</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  </Modal>
);

const ProfileCard = ({ title, value, icon }: { title: string; value?: string; icon: any }) => (
  <View style={styles.profileCard}>
    <View style={styles.cardLeft}>
      <Ionicons name={icon} size={20} color="#007bff" />
      <Text style={styles.cardTitle}>{title}</Text>
    </View>
    <Text style={styles.cardValue}>{value || 'Not specified'}</Text>
  </View>
);

const EditField = ({ label, value, onChangeText, placeholder, multiline = false, numberOfLines = 1, keyboardType = 'default'}: any) => (
  <View style={styles.fieldContainer}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput style={[styles.textInput, multiline && styles.multilineInput]} value={value} onChangeText={onChangeText} placeholder={placeholder} multiline={multiline} numberOfLines={numberOfLines} keyboardType={keyboardType} />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7fa' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#6c757d' },
  
  // User Info Header
  userInfoHeader: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    marginBottom: 10,
  },
  userInfoContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  smallProfileImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#007bff',
    marginRight: 15,
  },
  userTextInfo: {
    flex: 1,
  },
  userNameSmall: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  userEmailSmall: {
    fontSize: 14,
    color: '#6c757d',
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8d7da',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    alignSelf: 'flex-start',
  },
  offlineBadgeText: {
    color: '#721c24',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 5,
  },

  // Settings Section
  settingsSection: {
    backgroundColor: '#fff',
    marginBottom: 10,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6c757d',
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  
  // Settings Button
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e9ecef',
  },
  settingsButtonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e7f3ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  settingsButtonText: {
    flex: 1,
  },
  settingsButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 3,
  },
  settingsButtonSubtitle: {
    fontSize: 13,
    color: '#6c757d',
  },

  // Version Container
  versionContainer: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  versionText: {
    fontSize: 14,
    color: '#adb5bd',
    marginBottom: 5,
  },
  copyrightText: {
    fontSize: 12,
    color: '#adb5bd',
  },

  // Modal Styles
  modalContainer: { flex: 1, backgroundColor: '#f8f9fa' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#dee2e6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50' },
  saveButton: { color: '#007bff', fontSize: 17, fontWeight: '600' },
  modalContent: { flex: 1, padding: 20 },

  // Profile Modal
  profileModalHeader: {
    alignItems: 'center',
    paddingVertical: 30,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  profileImage: { 
    width: 130, 
    height: 130, 
    borderRadius: 65, 
    borderWidth: 4, 
    borderColor: '#007bff', 
    marginBottom: 15,
    backgroundColor: '#fff',
  },
  userName: { fontSize: 26, fontWeight: 'bold', color: '#2c3e50', marginBottom: 5 },
  userEmail: { fontSize: 16, color: '#6c757d', marginBottom: 12 },
  programBadge: { 
    backgroundColor: '#e3f2fd', 
    paddingHorizontal: 18, 
    paddingVertical: 8, 
    borderRadius: 20,
  },
  programText: { color: '#1976d2', fontSize: 14, fontWeight: '600' },
  section: { marginBottom: 25 },
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
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '500', color: '#2c3e50', marginLeft: 12 },
  cardValue: { fontSize: 15, color: '#6c757d', textAlign: 'right', flex: 1 },
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
  bioText: { fontSize: 15, color: '#495057', lineHeight: 22 },
  actionSection: { marginHorizontal: 20, marginTop: 10, marginBottom: 40 },
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
  editButtonText: { color: '#fff', fontSize: 16, fontWeight: '600', marginLeft: 8 },
  imageSection: { marginBottom: 30 },
  imageEditContainer: { alignItems: 'center', paddingVertical: 10 },
  editProfileImage: { 
    width: 130, 
    height: 130, 
    borderRadius: 65, 
    marginBottom: 20, 
    borderWidth: 4, 
    borderColor: '#007bff',
    backgroundColor: '#fff',
  },
  imageButtons: { flexDirection: 'row', gap: 15 },
  imageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#007bff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  deleteImageButton: { borderColor: '#dc3545' },
  imageButtonText: { color: '#007bff', fontSize: 15, fontWeight: '600', marginLeft: 6 },
  deleteText: { color: '#dc3545' },
  fieldContainer: { marginBottom: 20 },
  fieldLabel: { fontSize: 16, fontWeight: '500', color: '#2c3e50', marginBottom: 8 },
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
  multilineInput: { minHeight: 100, textAlignVertical: 'top' },
  genderContainer: { flexDirection: 'row', gap: 10 },
  genderOption: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 15, alignItems: 'center', borderWidth: 1, borderColor: '#dee2e6' },
  selectedGender: { backgroundColor: '#007bff', borderColor: '#007bff' },
  genderText: { fontSize: 15, color: '#495057', fontWeight: '500' },
  selectedGenderText: { color: '#fff' },
  disabledButton: { opacity: 0.5 },
  disabledText: { color: '#6c757d' },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8d7da',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 15,
  },
  offlineText: { color: '#721c24', fontSize: 14, fontWeight: '600', marginLeft: 8 },
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

  // Notification Toggle
  notificationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  disabledToggle: {
    opacity: 0.6,
    backgroundColor: '#f8f9fa',
  },
  notificationToggleText: {
    flex: 1,
    marginRight: 15,
  },
  notificationToggleTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 3,
  },
  disabledToggleText: {
    color: '#6c757d',
  },
  notificationToggleSubtitle: {
    fontSize: 13,
    color: '#6c757d',
  },
  notificationInfoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#d1ecf1',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#0c5460',
  },
  notificationInfoText: {
    flex: 1,
    fontSize: 14,
    color: '#0c5460',
    lineHeight: 20,
    marginLeft: 10,
  },

  // Privacy Modal
  privacySection: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 15,
    marginBottom: 20,
  },
  privacyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 15,
    marginBottom: 10,
  },
  privacyText: {
    fontSize: 15,
    color: '#6c757d',
    textAlign: 'center',
    lineHeight: 22,
  },

  // About Modal
  aboutSection: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 15,
    marginBottom: 20,
  },
  aboutLogo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 20,
  },
  aboutAppName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  aboutVersion: {
    fontSize: 14,
    color: '#6c757d',
    marginBottom: 15,
  },
  aboutDescription: {
    fontSize: 15,
    color: '#6c757d',
    textAlign: 'center',
    lineHeight: 22,
  },
  aboutInfoSection: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
  },
  aboutInfoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 12,
  },
  aboutInfoText: {
    fontSize: 14,
    color: '#6c757d',
    lineHeight: 24,
  },
});