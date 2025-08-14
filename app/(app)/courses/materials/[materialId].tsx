// app/(app)/courses/materials/[materialId].tsx
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNetworkStatus } from '../../../../context/NetworkContext';
import api, { getUserData } from '../../../../lib/api';
import { getMaterialDetailsFromDb } from '../../../../lib/localDb';

interface MaterialDetail {
  id: number;
  title: string;
  description?: string;
  file_path?: string;
  content?: string;
  material_type?: string;
  created_at: string;
  available_at?: string;
  unavailable_at?: string;
}

export default function MaterialDetailsScreen() {
  const { id: courseId, materialId } = useLocalSearchParams();
  const { isConnected } = useNetworkStatus();
  const [materialDetail, setMaterialDetail] = useState<MaterialDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (materialId) {
      fetchMaterialDetails();
    }
  }, [materialId, isConnected]);

  const fetchMaterialDetails = async () => {
    setLoading(true);
    setError(null);
    const user = await getUserData();
    const userEmail = user?.email;

    if (!userEmail) {
      setError('User not logged in.');
      setLoading(false);
      return;
    }

    try {
      if (isConnected) {
        // ONLINE MODE
        console.log('✅ Online: Fetching material details from API.');
        const response = await api.get(`/materials/${materialId}`);
        if (response.status === 200) {
          console.log("API Response for Material Details:", JSON.stringify(response.data, null, 2));
          setMaterialDetail(response.data.material);
        } else {
          const errorMessage = response.data?.message || 'Failed to fetch material details.';
          setError(errorMessage);
          Alert.alert('Error', errorMessage);
        }
      } else {
        // OFFLINE MODE
        console.log('⚠️ Offline: Fetching material details from local DB.');
        const offlineMaterial = await getMaterialDetailsFromDb(materialId as string, userEmail);
        if (offlineMaterial) {
          setMaterialDetail(offlineMaterial as MaterialDetail);
        } else {
          setError('Offline: Material details not available locally.');
          Alert.alert('Offline Mode', 'Material details not found in local storage. Please connect to the internet to load.');
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch material details:', err.response?.data || err.message);
      const errorMessage = err.response?.data?.message || 'Network error or unable to load material details.';
      setError(errorMessage);
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!materialDetail?.file_path || !materialDetail?.id) {
      Alert.alert('No File', 'This material does not have an attached file or valid ID.');
      return;
    }

    setIsDownloading(true); // Start downloading indicator

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Permission to access your media library is required to save files. Please enable it in settings.'
        );
        setIsDownloading(false);
        return;
      }

      // 2. Construct the full URL to the download endpoint
      const downloadUrl = `${api.defaults.baseURL}/materials/${materialDetail.id}/download`;

      // 3. Determine the local file URI to save the downloaded file
      const fileExtension = materialDetail.file_path.split('.').pop();
      const fileName = materialDetail.title.replace(/[^a-zA-Z0-9]/g, '_') + (fileExtension ? `.${fileExtension}` : ''); // Sanitize filename
      const localUri = FileSystem.documentDirectory + fileName; // Or FileSystem.cacheDirectory for temporary files

      // 4. Download the file
      const { uri } = await FileSystem.downloadAsync(downloadUrl, localUri);
      console.log('Finished downloading to ', uri);

      // 5. Share the downloaded file
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/octet-stream', // Generic MIME type, or infer based on fileExtension
          UTI: 'public.data', // Universal Type Identifier for iOS (generic data)
        });
        Alert.alert('Success', 'File downloaded and ready to open/share!');
      } else {
        // Fallback if sharing is not available (should be rare)
        Alert.alert('Download Complete', 'File downloaded to app storage. Sharing not available on this device.');
      }

    } catch (err: any) {
      console.error("Failed to download or share file:", err);
      // More specific error messages
      if (err.message.includes('permission')) {
          Alert.alert('Error', 'File download failed: Permissions were denied.');
      } else if (err.message.includes('404') || err.message.includes('File not found')) {
          Alert.alert('Error', 'File not found on the server or no file attached.');
      } else if (err.message.includes('403') || err.message.includes('Unauthorized')) {
          Alert.alert('Error', 'You are not authorized to download this file.');
      }
      else {
          Alert.alert('Error', 'Could not download or share the file. Please try again.');
      }
    } finally {
      setIsDownloading(false); // End downloading indicator
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Loading material...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchMaterialDetails}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!materialDetail) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>Material not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: materialDetail.title || 'Material Details' }} />
      <ScrollView contentContainerStyle={styles.scrollViewContent}>

        <View style={styles.sectionContainer}>
          <Text style={styles.materialTitle}>{materialDetail.title}</Text>
          {materialDetail.material_type && (
            <View style={styles.typeContainer}>
              <Ionicons name="bookmark-outline" size={18} color="#666" style={styles.icon} />
              <Text style={styles.materialType}>{materialDetail.material_type.toUpperCase()}</Text>
            </View>
          )}
          {materialDetail.description && (
            <Text style={styles.materialDescription}>{materialDetail.description}</Text>
          )}
        </View>

        {materialDetail.content && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Content</Text>
            <Text style={styles.materialContent}>{materialDetail.content}</Text>
          </View>
        )}

        {materialDetail.file_path && (
          <TouchableOpacity
            style={styles.downloadButton}
            onPress={handleDownload}
            disabled={isDownloading} // Disable button while downloading
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="document-text-outline" size={24} color="#fff" style={styles.icon} />
            )}
            <View style={styles.downloadTextContainer}>
              <Text style={styles.downloadButtonText}>
                {isDownloading ? 'Downloading...' : 'Download Material File'}
              </Text>
              <Text style={styles.downloadFileName}>
                {materialDetail.file_path.split('/').pop() || 'Click to download'}
              </Text>
            </View>
            {!isDownloading && <Ionicons name="download-outline" size={24} color="#fff" />}
          </TouchableOpacity>
        )}

        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeader}>Details</Text>
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={18} color="#666" style={styles.icon} />
            <Text style={styles.detailText}>
              <Text style={styles.detailLabel}>Created:</Text> {formatDate(materialDetail.created_at)}
            </Text>
          </View>
          {materialDetail.available_at && (
            <View style={styles.detailRow}>
              <Ionicons name="hourglass-outline" size={18} color="#666" style={styles.icon} />
              <Text style={styles.detailText}>
                <Text style={styles.detailLabel}>Available From:</Text> {formatDate(materialDetail.available_at)}
              </Text>
            </View>
          )}
          {materialDetail.unavailable_at && (
            <View style={styles.detailRow}>
              <Ionicons name="close-circle-outline" size={18} color="#666" style={styles.icon} />
              <Text style={styles.detailText}>
                <Text style={styles.detailLabel}>Available Until:</Text> {formatDate(materialDetail.unavailable_at)}
              </Text>
            </View>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f2f5',
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#555',
  },
  errorText: {
    fontSize: 16,
    color: '#dc3545',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 15,
  },
  retryButton: {
    backgroundColor: '#007bff',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  scrollViewContent: {
    padding: 15,
    paddingBottom: 30,
  },
  sectionContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  materialTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: 5,
    textAlign: 'center',
  },
  typeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  materialType: {
    fontSize: 15,
    color: '#666',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  materialDescription: {
    fontSize: 15,
    color: '#555',
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 5,
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 5,
  },
  materialContent: {
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007bff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    justifyContent: 'center',
  },
  downloadTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  downloadButtonText: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#fff',
  },
  downloadFileName: {
    fontSize: 13,
    color: '#e6f2ff',
    marginTop: 3,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  icon: {
    marginRight: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#666',
  },
  detailLabel: {
    fontWeight: 'bold',
    color: '#333',
  },
});