import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react'; // Import useState
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNetworkStatus } from '../context/NetworkContext';

interface CustomHeaderProps {
  title: string;
  initials: string;
  profileImage: string | null;
  unreadCount: number;
  onNotificationPress: () => void;
  onProfilePress: () => void;
  onBackPress?: () => void;
  showBackButton?: boolean;
  isInternetReachable?: boolean;
  hideNotifications?: boolean;
}

export const CustomHeader: React.FC<CustomHeaderProps> = ({
  title,
  initials,
  profileImage,
  unreadCount,
  onNotificationPress,
  onProfilePress,
  onBackPress,
  showBackButton = false,
  isInternetReachable,
  hideNotifications = false,
}) => {
  const { isConnected } = useNetworkStatus();
  const insets = useSafeAreaInsets();

  // NEW STATE: Track if profile image has failed to load
  const [profileImageFailed, setProfileImageFailed] = useState(false);

  // Reset state when profileImage prop changes
  React.useEffect(() => {
    setProfileImageFailed(false); // Reset failure state when profileImage changes
  }, [profileImage]);

  // Determine if a valid image URL is provided AND hasn't failed
  const hasValidProfileImage = profileImage && profileImage.trim().length > 0 && !profileImageFailed;

  return (
    <View style={[styles.headerContainer, { paddingTop: insets.top }]}>
      <View style={styles.headerContent}>
        {/* Left Section - Back Button or Empty Space */}
        <View style={styles.leftSection}>
          {showBackButton && onBackPress ? (
            <TouchableOpacity onPress={onBackPress} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={styles.backButtonPlaceholder} />
          )}
        </View>

        {/* Center Section - Title */}
        <View style={styles.centerSection}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>

        {/* Right Section - Notifications & Profile */}
        <View style={styles.rightSection}>
          {/* Notification Bell - Hidden when hideNotifications is true */}
          {!hideNotifications && (
            <TouchableOpacity
              style={[styles.bellIconContainer, !isInternetReachable && styles.disabledBellIcon]}
              onPress={onNotificationPress}
              disabled={!isInternetReachable}
            >
              <Ionicons
                name={isInternetReachable ? 'notifications-outline' : 'notifications-off-outline'}
                size={24}
                color={isInternetReachable ? '#fff' : '#ccc'}
              />
              {unreadCount > 0 && isInternetReachable && (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Profile Icon */}
          <TouchableOpacity onPress={onProfilePress} style={styles.profileContainer}>
            {hasValidProfileImage ? (
              <View style={styles.profileImageContainer}>
                <Image
                  source={{ uri: profileImage }}
                  style={styles.profileImage}
                  // On error, set state to true to trigger fallback
                  onError={() => setProfileImageFailed(true)}
                />
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: isConnected ? '#28a745' : '#dc3545' },
                  ]}
                />
              </View>
            ) : initials ? (
              <View style={styles.initialsCircle}>
                <Text style={styles.initialsText}>{initials}</Text>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: isConnected ? '#28a745' : '#dc3545' },
                  ]}
                />
              </View>
            ) : (
              <View style={styles.defaultIconContainer}>
                <Ionicons name="person-circle-outline" size={30} color="#fff" />
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: isConnected ? '#28a745' : '#dc3545' },
                  ]}
                />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: '#007bff',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    ...Platform.select({
      android: {
        elevation: 4,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
    }),
  },
  headerContent: {
    height: Platform.OS === 'ios' ? 44 : 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  leftSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  backButton: {
    padding: 8,
    marginLeft: 4,
  },
  backButtonPlaceholder: {
    width: 40,
  },
  centerSection: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  rightSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingRight: 8,
  },
  bellIconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  disabledBellIcon: {
    opacity: 0.5,
  },
  notificationBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#dc3545',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#007bff',
  },
  notificationBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  profileContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
    height: 40,
  },
  profileImageContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
    backgroundColor: '#fff', // This white background could be the culprit if Image fails
  },
  profileImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  initialsCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E90FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  initialsText: {
    color: '#fff',
    fontSize: 16,
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
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#007bff',
    zIndex: 2,
  },
});