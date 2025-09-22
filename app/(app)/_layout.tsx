// app/(app)/_layout.tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../context/NetworkContext'; // Adjust path as needed
import { API_BASE_URL, getAuthorizationHeader, getProfile, getUserData } from '../../lib/api';

export default function AppLayout() {
  const router = useRouter();
  const [initials, setInitials] = useState<string>('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        // Try to get full profile first (includes profile_image)
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

        // Fallback to stored user data if profile fetch fails
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
    loadNotifications();
    
    // Refresh notifications every 30 seconds
    const notificationInterval = setInterval(loadNotifications, 30000);
    
    return () => {
      clearInterval(notificationInterval);
    };
  }, []);

  const loadNotifications = async () => {
    try {
      const userData = await getUserData();
      if (!userData?.email) {
        console.log('No user data for notifications');
        return;
      }

      console.log('🔔 Loading notifications from student endpoint...');

      const response = await fetch(`${API_BASE_URL}/student/notifications`, {
        headers: {
          'Authorization': await getAuthorizationHeader(),
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('📱 Notifications response:', data);
        
        setNotifications(data.notifications || []);
        
        // Calculate unread count based on actual unread notifications
        const unreadNotifications = (data.notifications || []).filter(n => !n.read);
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
      case 'material':
        return '📚';
      case 'assessment':
        return '📝';
      default:
        return '🔔';
    }
  };

  const formatDate = (dateInput: string | Date): string => {
  // Guard against null or undefined input
  if (!dateInput) {
    return 'Date unavailable';
  }

  // Create a new Date object from the input string
  const date = new Date(dateInput);

  // Check if the created date is valid
  if (isNaN(date.getTime())) {
    console.warn('Received an invalid date string:', dateInput);
    return 'Invalid date';
  }

  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffMinutes = Math.floor(diffTime / (1000 * 60));
  const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
};

  const markAsRead = async (id: string) => {
    try {
      // Update local state immediately
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(prev - 1, 0));

      // Persist the read status on the server
      const response = await fetch(`${API_BASE_URL}/student/mark-notification-as-read`, {
        method: 'POST',
        headers: {
          'Authorization': await getAuthorizationHeader(),
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

    if (unreadNotifications.length === 0) {
      return;
    }

    try {
      // Store previous state in case we need to revert
      const previousNotifications = [...notifications];
      const previousUnreadCount = unreadCount;

      // Update local state immediately
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);

      // Persist the read status on the server
      const notificationIds = unreadNotifications.map((n) => n.id);
      const response = await fetch(`${API_BASE_URL}/student/mark-all-notifications-as-read`, {
        method: 'POST',
        headers: {
          'Authorization': await getAuthorizationHeader(),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notification_ids: notificationIds }),
      });

      if (!response.ok) {
        // Revert local state if server update fails
        setNotifications(previousNotifications);
        setUnreadCount(previousUnreadCount);
        console.error('Failed to mark all notifications as read on server:', response.status);
      }
    } catch (error) {
      // Revert local state on error
      const previousUnreadCount = notifications.filter(n => !n.read).length;
      setNotifications((prev) => prev.map((n) => ({ ...n, read: false })));
      setUnreadCount(previousUnreadCount);
      console.error('Error marking all notifications as read:', error);
    }
  };

  const toggleModal = () => {
    setIsModalVisible(!isModalVisible);
  };

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#007bff',
          tabBarInactiveTintColor: '#888',
          tabBarStyle: {
            backgroundColor: '#fff',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: '#ccc',
          },
          tabBarLabelStyle: {
            fontSize: 12,
          },
          headerStyle: {
            backgroundColor: '#007bff',
            height: 80, // Adjust height to include padding
          },
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          headerTintColor: '#fff',
          headerShown: true, // Ensure headers are shown
        }}
      >
        <Tabs.Screen
          name="index" // Dashboard
          options={{
            tabBarLabel: 'Home', // This is for the tab label at the bottom
            headerTitle: 'Dashboard', // This is for the header title
            tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />,
            headerShown: true, // Show header for this screen
            headerRight: () => (
              <TouchableOpacity onPress={() => router.push('/settings')} style={styles.headerRightContainer}>
                <HeaderRight
                  initials={initials}
                  profileImage={profileImage}
                  toggleModal={toggleModal}
                  unreadCount={unreadCount}
                />
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
            tabBarLabel: 'Courses', // Tab label
            tabBarIcon: ({ color }) => <Ionicons name="book" size={24} color={color} />,
            headerShown: false, // The nested Stack in app/(app)/courses/_layout.tsx will handle the header for courses
          }}
        />
        <Tabs.Screen
          name="to-do"
          options={{
            tabBarLabel: 'To-do', // Tab label
            headerTitle: 'To-do', // Header title
            tabBarIcon: ({ color }) => <Ionicons name="document-text" size={24} color={color} />,
            headerShown: true, // Show header for this screen
            headerRight: () => (
              <TouchableOpacity onPress={() => router.push('/settings')} style={styles.headerRightContainer}>
                <HeaderRight
                  initials={initials}
                  profileImage={profileImage}
                  toggleModal={toggleModal}
                  unreadCount={unreadCount}
                />
              </TouchableOpacity>
            ),
            headerStyle: { backgroundColor: '#007bff' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            tabBarLabel: 'Settings', // Tab label
            headerTitle: 'Settings', // Header title
            tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
            headerShown: true, // Show header for this screen
            headerStyle: { backgroundColor: '#007bff' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
          }}
        />
      </Tabs>

      {/* Notification Modal */}
      <Modal visible={isModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Notifications</Text>
              <View style={styles.modalHeaderButtons}>
                <TouchableOpacity onPress={markAllAsRead} style={styles.markAllReadButton}>
                  <Text style={styles.markAllReadText}>Mark all as read</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={toggleModal} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color="#000" />
                </TouchableOpacity>
              </View>
            </View>
            
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.notificationItem,
                    !item.read && styles.unreadNotification,
                  ]}
                  onPress={() => markAsRead(item.id)}
                >
                  <View style={styles.notificationContent}>
                    <View style={[
                      styles.notificationIcon,
                      item.type === 'assessment' && styles.assessmentIcon,
                      item.type === 'material' && styles.materialIcon,
                    ]}>
                      <Text style={styles.iconText}>
                        {getNotificationIcon(item.type)}
                      </Text>
                    </View>
                    <View style={styles.notificationTextContainer}>
                      <Text style={styles.notificationText}>{item.description}</Text>
                      {item.course && (
                        <Text style={styles.courseText}>📚 {item.course}</Text>
                      )}
                      <Text style={styles.notificationDate}>
                        🕐 {formatDate(item.date)}
                      </Text>
                    </View>
                    {!item.read && <View style={styles.unreadDot} />}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.noNotificationsContainer}>
                  <Text style={styles.noNotificationsIcon}>🔔</Text>
                  <Text style={styles.noNotificationsText}>
                    No notifications available.
                  </Text>
                </View>
              }
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const HeaderRight = ({
  initials,
  profileImage,
  toggleModal,
  unreadCount,
}: {
  initials: string;
  profileImage: string | null;
  toggleModal: () => void;
  unreadCount: number;
}) => {
  const { isConnected } = useNetworkStatus();

  return (
    <View style={styles.headerRightWrapper}>
      {/* Bell Icon with Badge */}
      <TouchableOpacity style={styles.bellIconContainer} onPress={toggleModal}>
        <Ionicons name="notifications-outline" size={24} color="#fff" />
        {unreadCount > 0 && (
          <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      
      {/* Profile Section */}
      <View style={styles.profileContainer}>
        {profileImage ? (
          // Show profile image if available
          <View style={styles.profileImageContainer}>
            <Image 
              source={{ uri: profileImage }} 
              style={styles.profileImage}
              onError={() => console.log('Failed to load profile image')}
            />
            {/* Status Dot */}
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#28a745' : '#dc3545' },
              ]}
            />
          </View>
        ) : initials ? (
          // Show initials circle if no profile image but has initials
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
          // Show default icon if no profile image and no initials
          <View style={styles.defaultIconContainer}>
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
  headerRightWrapper: {
    flexDirection: 'row', // Added to align bell icon and profile section
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44, // Ensure consistent touch target
    minWidth: 44,
  },
  bellIconContainer: {
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#dc3545',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  notificationBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  profileContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImageContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  initialsCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E90FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  initialsText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  defaultIconContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#fff',
    zIndex: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  modalHeaderButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  markAllReadButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  markAllReadText: {
    color: '#007bff',
    fontSize: 14,
    fontWeight: '500',
  },
  closeButton: {
    padding: 4,
  },
  notificationItem: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  unreadNotification: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  notificationContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#6b7280',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  assessmentIcon: {
    backgroundColor: '#7c3aed',
  },
  materialIcon: {
    backgroundColor: '#10b981',
  },
  iconText: {
    fontSize: 16,
  },
  notificationTextContainer: {
    flex: 1,
    gap: 4,
  },
  notificationText: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
    lineHeight: 20,
  },
  courseText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  notificationDate: {
    fontSize: 12,
    color: '#9ca3af',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
    flexShrink: 0,
    marginTop: 4,
  },
  noNotificationsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  noNotificationsIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  noNotificationsText: {
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '500',
  },
});