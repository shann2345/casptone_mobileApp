// context/OAuthContext.tsx
import React, { createContext, useContext, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

interface OAuthContextType {
  isProcessing: boolean;
  message: string; // NEW: To hold the current message
  startProcessing: (message: string) => void; // UPDATED: Now accepts a message
  stopProcessing: () => void;
}

const OAuthContext = createContext<OAuthContextType>({
  isProcessing: false,
  message: '',
  startProcessing: () => {},
  stopProcessing: () => {},
});

export const useOAuth = () => useContext(OAuthContext);

export const OAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // UPDATED: State is now the message string, or null if not processing
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);

  const startProcessing = (message: string) => {
    console.log(`🔄 OAuth processing started: ${message}`);
    setProcessingMessage(message);
  };

  const stopProcessing = () => {
    console.log('✅ OAuth processing stopped');
    setProcessingMessage(null);
  };

  const isProcessing = processingMessage !== null;

  return (
    <OAuthContext.Provider
      value={{
        isProcessing,
        message: processingMessage || '', // Provide the message
        startProcessing,
        stopProcessing,
      }}>
      {children}

      {/* Global OAuth Processing Overlay */}
      {/* UPDATED: Show if isProcessing is true */}
      {isProcessing && (
        <View style={styles.overlay}>
          <View style={styles.content}>
            <ActivityIndicator size="large" color="#007bff" />
            {/* UPDATED: Render the dynamic message from state */}
            <Text style={styles.text}>{processingMessage}</Text>
            <Text style={styles.subText}>Please wait a moment</Text>
          </View>
        </View>
      )}
    </OAuthContext.Provider>
  );
};

// Styles remain exactly the same
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
    zIndex: 99999,
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