// components/LogoutModal.tsx - Smart logout with options

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import api, { clearAllAuthData, getUserData } from '../lib/api';
import { getAllOfflineUsers, removeOfflineAccount } from '../lib/localDb';

interface LogoutModalProps {
  visible: boolean;
  onClose: () => void;
}

export const LogoutModal: React.FC<LogoutModalProps> = ({ visible, onClose }) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Standard logout - keeps offline data
  const handleStandardLogout = async () => {
    setLoading(true);
    try {
      console.log('🚪 Standard logout...');
      
      // Call API logout endpoint
      try {
        await api.post('/logout');
        console.log('✅ Server session cleared');
      } catch (error) {
        console.log('⚠️ Server logout failed (might be offline)');
      }
      
      // Clear current session data (token and user data)
      await clearAllAuthData();
      console.log('✅ Local session cleared');
      
      // Note: Offline accounts remain for future offline access
      
      onClose();
      router.replace('/login');
      
    } catch (error) {
      console.error('❌ Logout error:', error);
      Alert.alert('Logout Error', 'An error occurred during logout');
    } finally {
      setLoading(false);
    }
  };

  // Complete logout - removes this account from offline storage
  const handleCompleteLogout = async () => {
    Alert.alert(
      'Complete Logout',
      'This will remove your account from offline storage. You will need internet connection to login again. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Yes, Remove', 
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              console.log('🗑️ Complete logout...');
              
              // Get current user email before clearing
              const userData = await getUserData();
              const userEmail = userData?.email;
              
              // Call API logout
              try {
                await api.post('/logout');
              } catch (error) {
                console.log('Server logout failed');
              }
              
              // Clear current session
              await clearAllAuthData();
              
              // Remove from offline storage
              if (userEmail) {
                await removeOfflineAccount(userEmail);
                console.log('✅ Account removed from offline storage');
              }
              
              onClose();
              router.replace('/login');
              
            } catch (error) {
              console.error('❌ Complete logout error:', error);
              Alert.alert('Error', 'Failed to complete logout');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // Show account management info
  const showAccountInfo = async () => {
    try {
      const offlineUsers = await getAllOfflineUsers();
      const currentUser = await getUserData();
      
      const info = `Current Account: ${currentUser?.name || 'Unknown'} (${currentUser?.email || 'Unknown'})

Offline Accounts Available: ${offlineUsers.length}
${offlineUsers.map(user => `• ${user.name} (${user.email})`).join('\n')}

Options:
• Standard Logout: Keeps offline access for all accounts
• Complete Logout: Removes current account from offline storage`;

      Alert.alert('Account Information', info);
    } catch (error) {
      console.error('Error getting account info:', error);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Logout Options</Text>
          
          <Text style={styles.description}>Choose how you want to logout:</Text>
          
          <TouchableOpacity
            style={[styles.button, styles.standardButton]}
            onPress={handleStandardLogout}
            disabled={loading}
          >
            <Text style={styles.buttonText}>🔄 Standard Logout</Text>
            <Text style={styles.buttonSubtext}>Keep offline access for all accounts</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, styles.completeButton]}
            onPress={handleCompleteLogout}
            disabled={loading}
          >
            <Text style={styles.buttonText}>🗑️ Complete Logout</Text>
            <Text style={styles.buttonSubtext}>Remove this account from offline storage</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, styles.infoButton]}
            onPress={showAccountInfo}
            disabled={loading}
          >
            <Text style={styles.buttonText}>ℹ️ Account Info</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={[styles.buttonText, { color: '#6c757d' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  standardButton: {
    backgroundColor: '#007bff',
  },
  completeButton: {
    backgroundColor: '#dc3545',
  },
  infoButton: {
    backgroundColor: '#28a745',
  },
  cancelButton: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  buttonSubtext: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    marginTop: 4,
  },
});

// Usage in your app component:
export const useLogout = () => {
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  
  const logout = () => setShowLogoutModal(true);
  
  const LogoutModalComponent = () => (
    <LogoutModal 
      visible={showLogoutModal} 
      onClose={() => setShowLogoutModal(false)} 
    />
  );
  
  return { logout, LogoutModalComponent };
};