// context/OAuthContext.tsx
import React, { createContext, useContext, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

interface OAuthContextType {
  isProcessing: boolean;
  startProcessing: () => void;
  stopProcessing: () => void;
}

const OAuthContext = createContext<OAuthContextType>({
  isProcessing: false,
  startProcessing: () => {},
  stopProcessing: () => {},
});

export const useOAuth = () => useContext(OAuthContext);

export const OAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const startProcessing = () => {
    console.log('🔄 OAuth processing started');
    setIsProcessing(true);
  };

  const stopProcessing = () => {
    console.log('✅ OAuth processing stopped');
    setIsProcessing(false);
  };

  return (
    <OAuthContext.Provider value={{ isProcessing, startProcessing, stopProcessing }}>
      {children}
      
      {/* Global OAuth Processing Overlay */}
      {isProcessing && (
        <View style={styles.overlay}>
          <View style={styles.content}>
            <ActivityIndicator size="large" color="#007bff" />
            <Text style={styles.text}>Completing sign in...</Text>
            <Text style={styles.subText}>Please wait a moment</Text>
          </View>
        </View>
      )}
    </OAuthContext.Provider>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99999, // Very high z-index to cover everything
  },
  content: {
    backgroundColor: '#ffffff',
    padding: 40,
    borderRadius: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
    minWidth: 280,
  },
  text: {
    fontSize: 18,
    fontWeight: '600',
    color: '#34495e',
    marginTop: 20,
    textAlign: 'center',
  },
  subText: {
    fontSize: 14,
    color: '#6c757d',
    marginTop: 8,
    textAlign: 'center',
  },
});