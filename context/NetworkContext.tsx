// context/NetworkContext.tsx
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface NetworkContextType {
  netInfo: NetInfoState | null;
  isConnected: boolean;
  isInternetReachable: boolean | null;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

// Create a provider component that will wrap your app
export const NetworkProvider = ({ children }: { children: React.ReactNode }) => {
  const [netInfo, setNetInfo] = useState<NetInfoState | null>(null);

  useEffect(() => {
    // Get initial network state
    NetInfo.fetch().then(state => {
      setNetInfo(state);
    });

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener(state => {
      setNetInfo(state);
    });

    // Clean up the subscription when the component unmounts
    return () => {
      unsubscribe();
    };
  }, []);

  const contextValue: NetworkContextType = {
    netInfo,
    isConnected: netInfo?.isConnected ?? false,
    isInternetReachable: netInfo?.isInternetReachable ?? null,
  };

  return <NetworkContext.Provider value={contextValue}>{children}</NetworkContext.Provider>;
};

// Custom hook to easily access the network state from any component
export const useNetworkStatus = (): NetworkContextType => {
  const context = useContext(NetworkContext);
  if (context === null) {
    throw new Error('useNetworkStatus must be used within a NetworkProvider');
  }
  return context;
};