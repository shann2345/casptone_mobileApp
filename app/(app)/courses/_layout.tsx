// app/(app)/courses/_layout.tsx
import { CustomHeader } from '@/components/CustomHeader';
import { unregisterBackgroundSync } from '@/lib/backgroundSync';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Stack, usePathname, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { useNetworkStatus } from '../../../context/NetworkContext';
import { API_BASE_URL, clearAuthToken, getAuthorizationHeader, getProfile, getUserData } from '../../../lib/api';
import { clearOfflineData } from '../../../lib/localDb';

export default function CoursesLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { isConnected, netInfo } = useNetworkStatus();
  const [initials, setInitials] = useState<string>('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isNotificationModalVisible, setIsNotificationModalVisible] = useState<boolean>(false);
  const [isProfileMenuVisible, setIsProfileMenuVisible] = useState<boolean>(false);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

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
              console.log('🔄 Unregistering background sync...');
              await unregisterBackgroundSync();
              console.log('✅ Background sync unregistered');
              
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

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        if (netInfo?.isInternetReachable) {
          try {
            const profileData = await getProfile();
            if (profileData && profileData.name) {
              const firstLetter = profileData.name.charAt(0).toUpperCase();
              setInitials(firstLetter);
              setProfileImage(profileData.profile_image);
              return;
            }
          } catch (profileError) {
            console.log('Profile fetch failed, falling back to user data:', profileError);
          }
        }
        const userData = await getUserData();
        if (userData && userData.name) {
          const firstLetter = userData.name.charAt(0).toUpperCase();
          setInitials(firstLetter);
        } else {
          setInitials('?');
        }
      } catch (error) {
        console.error('Error fetching user profile for header:', error);
        setInitials('?');
      }
    };
    fetchUserProfile();
  }, [netInfo?.isInternetReachable]);

  const handleDownloadNotificationAttachment = async (item: any) => {
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline Mode', 'File downloading requires an internet connection.');
      return;
    }
    if (downloadingId) return;

    setDownloadingId(item.id);
    setDownloadProgress(0);

    try {
      const authHeader = await getAuthorizationHeader();
      const materialResponse = await fetch(`${API_BASE_URL}/materials/${item.item_id}`, {
        headers: { 'Authorization': String(authHeader || '') }
      });

      if (!materialResponse.ok) throw new Error('Could not fetch material details.');
      
      const materialData = await materialResponse.json();
      const material = materialData.material;

      if (!material || !material.file_path) throw new Error('No file associated with this material.');
      
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Media library access is needed to save the file.');
        setDownloadingId(null);
        return;
      }

      const downloadUrl = `${API_BASE_URL}/materials/${material.id}/view`;
      const fileExtension = material.file_path.split('.').pop();
      const sanitizedTitle = material.title.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${sanitizedTitle}_${material.id}${fileExtension ? `.${fileExtension}` : ''}`;
      const localUri = FileSystem.documentDirectory + fileName;
      
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists) {
        Alert.alert('File Exists', 'This file has already been downloaded.');
        setDownloadingId(null);
        return;
      }

      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl, localUri,
        { headers: { 'Authorization': String(authHeader) } },
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite > 0) {
            const progress = totalBytesWritten / totalBytesExpectedToWrite;
            setDownloadProgress(Math.round(progress * 100));
          }
        }
      );

      const result = await downloadResumable.downloadAsync();
      if (result?.uri) {
        Alert.alert('Download Complete!', `"${material.title}" has been saved to your device.`);
      } else {
        throw new Error('Download failed.');
      }
    } catch (err: any) {
      Alert.alert('Download Failed', err.message || 'Could not download the file. Please try again.');
    } finally {
      setDownloadingId(null);
      setDownloadProgress(0);
    }
  };

  const loadNotifications = async () => {
    try {
      if (!netInfo?.isInternetReachable) {
        console.log('🔵 No internet connection - skipping notification fetch');
        return;
      }
      const userData = await getUserData();
      if (!userData?.email) {
        console.log('No user data for notifications');
        return;
      }
      console.log('🔔 Loading notifications from student endpoint...');
      const authHeader = await getAuthorizationHeader();
      const response = await fetch(`${API_BASE_URL}/student/notifications`, {
        headers: {
          'Authorization': String(authHeader || ''),
          'Accept': 'application/json',
        },
      });
      if (response.ok) {
        const data = await response.json();
        console.log('📱 Notifications response:', data);
        setNotifications(data.notifications || []);
        const unreadNotifications = (data.notifications || []).filter((n: any) => !n.read);
        setUnreadCount(unreadNotifications.length);
      } else {
        console.error('Failed to fetch notifications:', response.status);
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (error) {
      console.error('❌ Error loading notifications:', error);
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch(type) {
      case 'material': return '📚';
      case 'assessment': return '📝';
      default: return '🔔';
    }
  };

  const formatDate = (dateInput: string | Date): string => {
    if (!dateInput) return 'Date unavailable';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) {
      console.warn('Received an invalid date string:', dateInput);
      return 'Invalid date';
    }
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffMinutes = Math.floor(diffTime / (1000 * 60));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  useEffect(() => {
    let notificationInterval: ReturnType<typeof setInterval> | null = null;
    const startNotificationInterval = () => {
      loadNotifications();
      if (netInfo?.isInternetReachable) {
        notificationInterval = setInterval(() => {
          if (netInfo?.isInternetReachable) {
            loadNotifications();
          }
        }, 30000);
      }
    };
    if (netInfo?.isInternetReachable) {
      startNotificationInterval();
    } else {
      if (notificationInterval) {
        clearInterval(notificationInterval);
        notificationInterval = null;
      }
      console.log('🔵 Offline mode - notification interval disabled');
    }
    return () => {
      if (notificationInterval) {
        clearInterval(notificationInterval);
      }
    };
  }, [netInfo?.isInternetReachable]);

  const markAsRead = async (id: string) => {
    try {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(prev - 1, 0));
      if (!netInfo?.isInternetReachable) {
        console.log('🔵 No internet connection - marking as read locally only');
        return;
      }
      const authHeader = await getAuthorizationHeader();
      const response = await fetch(`${API_BASE_URL}/student/mark-notification-as-read`, {
        method: 'POST',
        headers: {
          'Authorization': String(authHeader || ''),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notification_id: id }),
      });
      if (!response.ok) {
        console.error('Failed to mark notification as read on the server:', response.status);
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    const unreadNotifications = notifications.filter((n) => !n.read);
    if (unreadNotifications.length === 0) return;
    try {
      const previousNotifications = [...notifications];
      const previousUnreadCount = unreadCount;
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      if (!netInfo?.isInternetReachable) {
        console.log('🔵 No internet connection - marking all as read locally only');
        return;
      }
      const notificationIds = unreadNotifications.map((n) => n.id);
      const authHeader = await getAuthorizationHeader();
      const response = await fetch(`${API_BASE_URL}/student/mark-all-notifications-as-read`, {
        method: 'POST',
        headers: {
          'Authorization': String(authHeader || ''),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notification_ids: notificationIds }),
      });
      if (!response.ok) {
        setNotifications(previousNotifications);
        setUnreadCount(previousUnreadCount);
        console.error('Failed to mark all notifications as read on server:', response.status);
      }
    } catch (error) {
      const previousUnreadCount = notifications.filter(n => !n.read).length;
      setNotifications((prev) => prev.map((n) => ({ ...n, read: false })));
      setUnreadCount(previousUnreadCount);
      console.error('Error marking all notifications as read:', error);
    }
  };

  const toggleNotificationModal = () => setIsNotificationModalVisible(!isNotificationModalVisible);
  const toggleProfileMenu = () => setIsProfileMenuVisible(!isProfileMenuVisible);

  // Check if we're on a detail screen (not the courses index)
  const isOnDetailScreen = () => {
    return pathname.includes('/materials/') || 
           pathname.includes('/assessments/') || 
           (pathname.includes('/courses/') && !pathname.endsWith('/courses') && !pathname.endsWith('/courses/'));
  };

  // Get title for detail screens
  const getDetailScreenTitle = () => {
    if (pathname.includes('/materials/')) return 'Material Details';
    if (pathname.includes('/assessments/')) return 'Assessment Details';
    return 'Course Details';
  };

  const handleBackPress = () => {
    router.back();
  };

  return (
    <>
      {/* Only show CustomHeader on detail screens */}
      {isOnDetailScreen() && (
        <>
          <StatusBar barStyle="light-content" backgroundColor="#007bff" translucent={false} />
          <CustomHeader
            title={getDetailScreenTitle()}
            initials={initials}
            profileImage={profileImage}
            unreadCount={unreadCount}
            onNotificationPress={netInfo?.isInternetReachable ? toggleNotificationModal : () => console.log('🔵 Notifications disabled - no internet')}
            onProfilePress={toggleProfileMenu}
            showBackButton={true}
            onBackPress={handleBackPress}
            isInternetReachable={netInfo?.isInternetReachable ?? false}
          />
        </>
      )}
      
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="[id]" />
        <Stack.Screen name="assessments/[assessmentId]" />
        <Stack.Screen name="materials/[materialId]" />
      </Stack>

      {/* Notification Modal */}
      <Modal visible={isNotificationModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Notifications</Text>
              <View style={styles.modalHeaderButtons}>
                {unreadCount > 0 && (
                  <TouchableOpacity onPress={markAllAsRead} style={styles.markAllReadButton}>
                    <Text style={styles.markAllReadText}>Mark all as read</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={toggleNotificationModal} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color="#000" />
                </TouchableOpacity>
              </View>
            </View>
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.notificationItem, !item.read && styles.unreadNotification]} onPress={() => markAsRead(item.id)}>
                  <View style={styles.notificationContent}>
                    <View style={styles.notificationMainContent}>
                      <View style={[styles.notificationIcon, item.type === 'assessment' && styles.assessmentIcon, item.type === 'material' && styles.materialIcon]}>
                        <Text style={styles.iconText}>{getNotificationIcon(item.type)}</Text>
                      </View>
                      <View style={styles.notificationTextContainer}>
                        <Text style={styles.notificationText}>{item.description}</Text>
                        {item.course && <Text style={styles.courseText}>📚 {item.course}</Text>}
                        <Text style={styles.notificationDate}>🗓️ {formatDate(item.date)}</Text>
                      </View>
                    </View>
                    
                    <View style={styles.notificationActions}>
                      {item.type === 'material' && item.material_type?.toLowerCase() !== 'link' && (
                        <View>
                          {downloadingId === item.id ? (
                            <View style={styles.progressContainer}>
                              <ActivityIndicator size="small" color="#007bff" />
                              <Text style={styles.progressText}>{downloadProgress}%</Text>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={[styles.downloadButton, (!!downloadingId || !netInfo?.isInternetReachable) && styles.downloadButtonDisabled]}
                              onPress={(e) => {
                                e.stopPropagation();
                                handleDownloadNotificationAttachment(item);
                              }}
                              disabled={!!downloadingId || !netInfo?.isInternetReachable}
                            >
                              <Ionicons name="download-outline" size={22} color={!!downloadingId || !netInfo?.isInternetReachable ? "#adb5bd" : "#007bff"} />
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                      {!item.read && <View style={styles.unreadDot} />}
                    </View>
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.noNotificationsContainer}>
                  <Text style={styles.noNotificationsIcon}>📕</Text>
                  <Text style={styles.noNotificationsText}>You're all caught up!</Text>
                </View>
              }
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>

      {/* Profile Dropdown Menu Modal */}
      <Modal visible={isProfileMenuVisible} transparent={true} animationType="fade" onRequestClose={toggleProfileMenu}>
        <TouchableOpacity style={styles.profileMenuOverlay} activeOpacity={1} onPress={toggleProfileMenu}>
          <View style={styles.profileMenuContainer}>
            <TouchableOpacity style={styles.profileMenuItem} onPress={() => { toggleProfileMenu(); router.push('/settings'); }}>
              <Ionicons name="person-circle-outline" size={22} color="#495057" />
              <Text style={styles.profileMenuItemText}>Profile</Text>
            </TouchableOpacity>
            <View style={styles.profileMenuDivider} />
            <TouchableOpacity style={styles.profileMenuItem} onPress={() => { toggleProfileMenu(); handleLogout(); }}>
              <Ionicons name="log-out-outline" size={22} color="#dc3545" />
              <Text style={[styles.profileMenuItemText, { color: '#dc3545' }]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContainer: { width: '100%', maxWidth: 500, maxHeight: '85%', backgroundColor: '#fff', borderRadius: 20, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1f2937' },
  modalHeaderButtons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  markAllReadButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  markAllReadText: { color: '#007bff', fontSize: 14, fontWeight: '600' },
  closeButton: { padding: 6, borderRadius: 20 },
  notificationItem: { padding: 18, borderRadius: 14, marginBottom: 10, backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e5e7eb' },
  unreadNotification: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1.5 },
  notificationContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  notificationIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#6b7280', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  assessmentIcon: { backgroundColor: '#7c3aed' },
  materialIcon: { backgroundColor: '#10b981' },
  iconText: { fontSize: 18 },
  notificationTextContainer: { flex: 1, gap: 6 },
  notificationText: { fontSize: 15, color: '#1f2937', fontWeight: '500', lineHeight: 22 },
  courseText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  notificationDate: { fontSize: 12, color: '#9ca3af' },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#3b82f6', flexShrink: 0 },
  noNotificationsContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  noNotificationsIcon: { fontSize: 56, marginBottom: 20 },
  noNotificationsText: { textAlign: 'center', color: '#6b7280', fontSize: 16, fontWeight: '500' },
  profileMenuOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.3)' },
  profileMenuContainer: { position: 'absolute', top: 80, right: 16, backgroundColor: '#fff', borderRadius: 14, width: 200, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 10, paddingVertical: 10 },
  profileMenuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 },
  profileMenuItemText: { fontSize: 16, color: '#343a40', marginLeft: 14, fontWeight: '500' },
  profileMenuDivider: { height: 1, backgroundColor: '#e9ecef', marginVertical: 6, marginHorizontal: 12 },
  notificationMainContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, flex: 1 },
  notificationActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  downloadButton: { padding: 8, borderRadius: 20, backgroundColor: '#e7f3ff' },
  downloadButtonDisabled: { backgroundColor: '#f1f3f4' },
  progressContainer: { width: 38, height: 38, justifyContent: 'center', alignItems: 'center', gap: 2 },
  progressText: { fontSize: 10, color: '#007bff' },
});