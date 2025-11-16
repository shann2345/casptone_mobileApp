// context/NetworkContext.tsx
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import React, { createContext, useContext, useEffect, useState } from 'react';
// ‼️ IMPORT YOUR API_BASE_URL
import { API_BASE_URL } from '../lib/api';

interface NetworkContextType {
  netInfo: NetInfoState | null;
  isConnected: boolean;
  isInternetReachable: boolean | null;
  isBackendReachable: boolean | null; // ‼️ ADD NEW STATE
}

const NetworkContext = createContext<NetworkContextType | null>(null);

// Create a provider component that will wrap your app
export const NetworkProvider = ({ children }: { children: React.ReactNode }) => {
  const [netInfo, setNetInfo] = useState<NetInfoState | null>(null);
  // ‼️ NEW STATE FOR ACTUAL BACKEND REACHABILITY
  const [isBackendReachable, setIsBackendReachable] = useState<boolean | null>(null);

  // Original useEffect for NetInfo - This is correct.
  useEffect(() => {
    NetInfo.fetch().then(state => {
      setNetInfo(state);
    });

    const unsubscribe = NetInfo.addEventListener(state => {
      setNetInfo(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // ‼️ NEW EFFECT: The "Backend Ping" logic
  useEffect(() => {
    // This is the ping function
    const checkBackendReachable = async () => {
      // 1. If NetInfo says we're NOT reachable, we know the backend isn't.
      if (netInfo?.isInternetReachable === false) {
        if (isBackendReachable !== false) { // Only set if state changes
           console.log('🌐 [NetworkPing] NetInfo says offline. Setting backend: 🔴 FALSE');
           setIsBackendReachable(false);
        }
        return;
      }

      // 2. If NetInfo says we *are* reachable (or null/unknown), we must test.
      //    This handles "problematic Wi-Fi".
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout

      try {
        const response = await fetch(`${API_BASE_URL}/time`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
          },
        });
        
        clearTimeout(timeoutId);

        // 3. Check for a *valid* 200-299 response
        if (response.ok) {
          // Extra check: is it valid JSON?
          const data = await response.json();
          if (data.server_time) {
            if (isBackendReachable !== true) {
              console.log('🌐 [NetworkPing] Ping successful. Setting backend: 🟢 TRUE');
              setIsBackendReachable(true);
            }
          } else {
            // Got 200 OK, but not the /time endpoint. Captive portal?
            throw new Error('Invalid JSON response from /time');
          }
        } else {
          // Got a 4xx, 5xx, or redirect
          throw new Error(`Ping failed with status: ${response.status}`);
        }
      } catch (error: any) {
        clearTimeout(timeoutId);
        // 4. Any error (timeout, network error, bad JSON, bad status) means backend is NOT reachable.
        if (isBackendReachable !== false) {
          console.log(`🌐 [NetworkPing] Ping FAILED (${error.name}: ${error.message}). Setting backend: 🔴 FALSE`);
          setIsBackendReachable(false);
        }
      }
    };
    
    // Run the check immediately when netInfo changes
    checkBackendReachable();

    // 5. Set up an interval to keep checking.
    const intervalId = setInterval(() => {
      checkBackendReachable();
    }, 15000); // Check every 15 seconds

    // 6. Cleanup
    return () => {
      clearInterval(intervalId);
    };

  }, [netInfo, isBackendReachable]); // Re-run if netInfo changes

  const contextValue: NetworkContextType = {
    netInfo,
    isConnected: netInfo?.isConnected ?? false,
    isInternetReachable: netInfo?.isInternetReachable ?? null,
    isBackendReachable: isBackendReachable, // ‼️ ADDED
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