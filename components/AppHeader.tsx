// components/AppHeader.tsx
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../context/NetworkContext';

interface AppHeaderProps {
  initials: string;
  profileImage: string | null;
  unreadCount: number;
  onNotificationPress: () => void;
  onProfilePress: () => void;
  isInternetReachable?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  initials,
  profileImage,
  unreadCount,
  onNotificationPress,
  onProfilePress,
  isInternetReachable,
}) => {
  const { isConnected } = useNetworkStatus();

  return (
    <View style={styles.headerRightWrapper}>
      {/* Notification Bell */}
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

      {/* Profile Icon */}
      <TouchableOpacity onPress={onProfilePress} style={styles.profileContainer}>
        {profileImage ? (
          <View style={styles.profileImageContainer}>
            <Image
              source={{ uri: profileImage }}
              style={styles.profileImage}
              onError={() => console.log('Failed to load profile image')}
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
  );
};

const styles = StyleSheet.create({
  headerRightWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    gap: 12,
  },
  bellIconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  disabledBellIcon: {
    opacity: 0.5,
  },
  notificationBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#dc3545',
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: '#007bff',
  },
  notificationBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  profileContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    width: 44,
    height: 44,
  },
  profileImageContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    borderColor: '#fff',
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  initialsCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E90FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
  },
  initialsText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  defaultIconContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: '#007bff',
    zIndex: 2,
  },
});
