// app/(app)/courses/materials/[materialId].tsx
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as MediaLibrary from 'expo-media-library';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNetworkStatus } from '../../../../context/NetworkContext';
import api, { getAuthorizationHeader, getUserData, initializeAuth } from '../../../../lib/api';
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

type FileType = 'image' | 'pdf' | 'document' | 'video' | 'audio' | 'other';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function MaterialDetailsScreen() {
  const { id: courseId, materialId } = useLocalSearchParams();
  const { isConnected } = useNetworkStatus();
  const [materialDetail, setMaterialDetail] = useState<MaterialDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [fileViewerOpen, setFileViewerOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    // Initialize auth when component mounts
    initializeAuth();
    
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
        console.log('📡 API Request URL:', `${api.defaults.baseURL}/materials/${materialId}`);
        console.log('🔐 Auth Header:', api.defaults.headers.common['Authorization'] ? 'Present' : 'Missing');
        
        const response = await api.get(`/materials/${materialId}`);
        if (response.status === 200) {
          console.log("API Response for Material Details:", JSON.stringify(response.data, null, 2));
          const material = response.data.material;
          setMaterialDetail(material);
          
          // Log file details for debugging
          if (material.file_path) {
            console.log('📁 Material has file:', material.file_path);
            console.log('🆔 Material ID:', material.id);
          } else {
            console.log('⚠️ Material has no file attached');
          }
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
      console.error('Error details:', {
        status: err.response?.status,
        statusText: err.response?.statusText,
        url: err.config?.url,
        headers: err.config?.headers
      });
      const errorMessage = err.response?.data?.message || 'Network error or unable to load material details.';
      setError(errorMessage);
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const getFileType = (filePath: string): FileType => {
    if (!filePath) return 'other';
    
    const extension = filePath.split('.').pop()?.toLowerCase();
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension || '')) {
      return 'image';
    }
    if (['pdf'].includes(extension || '')) {
      return 'pdf';
    }
    if (['doc', 'docx', 'txt', 'rtf'].includes(extension || '')) {
      return 'document';
    }
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension || '')) {
      return 'video';
    }
    if (['mp3', 'wav', 'aac', 'm4a'].includes(extension || '')) {
      return 'audio';
    }
    
    return 'other';
  };

  const getFileIcon = (fileType: FileType) => {
    switch (fileType) {
      case 'image': return 'image-outline';
      case 'pdf': return 'document-text-outline';
      case 'document': return 'document-outline';
      case 'video': return 'videocam-outline';
      case 'audio': return 'musical-notes-outline';
      default: return 'attach-outline';
    }
  };

  const getFileUrl = () => {
    if (!materialDetail?.file_path || !materialDetail?.id) {
      console.log('❌ No file path or material ID available');
      return '';
    }
    const url = `${api.defaults.baseURL}/materials/${materialDetail.id}/view`;
    console.log('🔗 File URL generated:', url);
    return url;
  };

  const getAuthenticatedFileUrl = async () => {
    if (!materialDetail?.file_path || !materialDetail?.id) {
      return '';
    }
    
    try {
      console.log('🔗 Getting signed URL for material:', materialDetail.id);
      
      // Get a temporary signed URL from your backend
      const response = await api.get(`/materials/${materialDetail.id}/view-link`);
      
      if (response.data && response.data.url) {
        console.log('✅ Signed URL received successfully');
        return response.data.url;
      } else {
        console.error('❌ No URL in response:', response.data);
        throw new Error('No signed URL received');
      }
    } catch (error) {
      console.error('❌ Error getting signed URL:', error);
      // Fallback to regular URL (which will likely redirect to login)
      return getFileUrl();
    }
  };


  const handleViewFile = async () => {
    if (!isConnected) {
      Alert.alert('Offline Mode', 'File viewing and downloading require an internet connection.');
      return;
    }

    const fileType = getFileType(materialDetail?.file_path || '');
    
    // Always open images and PDFs in a WebBrowser for consistent in-app viewing
    if (fileType === 'image' || fileType === 'pdf') {
        const fileUrl = await getAuthenticatedFileUrl();
        if (fileUrl) {
            WebBrowser.openBrowserAsync(fileUrl);
        } else {
            Alert.alert('Error', 'Unable to open file. Please try again.');
        }
        return;
    }

    // For other document types, continue to handle with the system browser
    const fileUrl = await getAuthenticatedFileUrl();
    if (fileUrl) {
        WebBrowser.openBrowserAsync(fileUrl);
    } else {
        Alert.alert('Error', 'Unable to open file. Please try again.');
    }
  };


  const handleDownload = async () => {
    if (!materialDetail?.file_path || !materialDetail?.id) {
      Alert.alert('No File', 'This material does not have an attached file or valid ID.');
      return;
    }

    setIsDownloading(true);

    try {
      // Request permissions
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Permission to access your media library is required to save files. Please enable it in settings.'
        );
        setIsDownloading(false);
        return;
      }

      const downloadUrl = `${api.defaults.baseURL}/materials/${materialDetail.id}/download`;
      const fileExtension = materialDetail.file_path.split('.').pop();
      const fileName = materialDetail.title.replace(/[^a-zA-Z0-9]/g, '_') + (fileExtension ? `.${fileExtension}` : '');
      const localUri = FileSystem.documentDirectory + fileName;

      console.log('📥 Starting download from:', downloadUrl);
      console.log('💾 Saving to:', localUri);

      // Create download with headers for authentication
      const { uri } = await FileSystem.downloadAsync(
        downloadUrl, 
        localUri,
        {
          headers: {
            'Authorization': getAuthorizationHeader(),
          }
        }
      );
      
      console.log('✅ Download completed:', uri);

      // Try to open the downloaded file
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/octet-stream',
          UTI: 'public.data',
        });
        Alert.alert(
          'Download Complete!', 
          'File downloaded successfully and opened for viewing/sharing.'
        );
      } else {
        // Fallback: try to open with system
        try {
          await Linking.openURL(uri);
          Alert.alert('Download Complete!', 'File downloaded and opened.');
        } catch (openError) {
          Alert.alert(
            'Download Complete', 
            `File downloaded to: ${fileName}\n\nThe file has been saved but could not be opened automatically. You can find it in your file manager.`
          );
        }
      }

    } catch (err: any) {
      console.error("Download failed:", err);
      
      let errorMessage = 'Could not download the file. Please try again.';
      
      if (err.message.includes('permission')) {
        errorMessage = 'File download failed: Permissions were denied.';
      } else if (err.message.includes('404') || err.message.includes('File not found')) {
        errorMessage = 'File not found on the server or no file attached.';
      } else if (err.message.includes('403') || err.message.includes('Unauthorized')) {
        errorMessage = 'You are not authorized to download this file.';
      } else if (err.message.includes('Network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }
      
      Alert.alert('Download Failed', errorMessage);
    } finally {
      setIsDownloading(false);
    }
  };

  const renderFileViewer = () => {
    if (!materialDetail?.file_path) return null;
    
    const fileType = getFileType(materialDetail.file_path);
    const fileUrl = getFileUrl();

    return (
      <View style={styles.fileViewerContainer}>
        <View style={styles.fileViewerHeader}>
          <Text style={styles.fileViewerTitle}>Attached File</Text>
          <View style={styles.fileViewerActions}>
            <TouchableOpacity 
              style={styles.downloadIconButton} 
              onPress={handleDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#007bff" />
              ) : (
                <Ionicons name="download-outline" size={24} color="#007bff" />
              )}
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.viewButton} 
              onPress={handleViewFile}
              disabled={!isConnected}
            >
              <Ionicons 
                name="eye-outline" 
                size={24} 
                color={isConnected ? "#007bff" : "#ccc"} 
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Enhanced Preview Section */}
        {isConnected ? (
          <View style={styles.previewContainer}>
            {fileType === 'image' || fileType === 'pdf' ? (
              <TouchableOpacity onPress={handleViewFile} style={styles.imagePreviewContainer}>
                <Image 
                  source={{ 
                    uri: fileUrl,
                    headers: {
                      'Authorization': getAuthorizationHeader(),
                    }
                  }}
                  style={styles.imagePreview}
                  resizeMode="contain"
                  onLoadStart={() => setPreviewLoading(true)}
                  onLoadEnd={() => setPreviewLoading(false)}
                />
                {previewLoading && (
                  <View style={styles.previewLoadingOverlay}>
                    <ActivityIndicator size="large" color="#007bff" />
                  </View>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                onPress={handleViewFile} // This calls the function updated above
                style={styles.filePreviewContainer}
              >
                <Ionicons 
                  name={getFileIcon(fileType)} 
                  size={64} 
                  color="#007bff" 
                />
                <Text style={styles.filePreviewText}>
                  View File in Browser
                </Text>
                <Text style={styles.fileName}>
                  {materialDetail.file_path.split('/').pop()}
                </Text>
                <Text style={styles.fileTypeLabel}>
                  {fileType.toUpperCase()} File
                </Text>
                <View style={styles.browserHint}>
                  <Ionicons name="information-circle-outline" size={16} color="#666" />
                  <Text style={styles.browserHintText}>
                    Opens in a new browser tab.
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          // Offline message is already good
          <TouchableOpacity 
            onPress={handleDownload} 
            style={styles.filePreviewContainer}
          >
            <Ionicons 
              name={getFileIcon(fileType)} 
              size={64} 
              color="#007bff" 
            />
            <Text style={styles.filePreviewText}>Download to view offline</Text>
            <Text style={styles.fileName}>
              {materialDetail.file_path.split('/').pop()}
            </Text>
            <Text style={styles.offlineHint}>
              Internet connection required for online viewing
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderImageViewer = () => {
    if (!materialDetail?.file_path || !fileViewerOpen) return null;
    
    const fileType = getFileType(materialDetail.file_path);
    if (fileType !== 'image') return null;
    
    const fileUrl = getFileUrl();

    return (
      <Modal
        visible={fileViewerOpen}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <View style={styles.fullScreenViewer}>
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity 
              onPress={() => setFileViewerOpen(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.fullScreenTitle} numberOfLines={1}>
              {materialDetail.title}
            </Text>
            <TouchableOpacity 
              onPress={handleDownload}
              style={styles.downloadButton}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="download" size={24} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.fullScreenContent}>
            <ScrollView 
              maximumZoomScale={3}
              minimumZoomScale={1}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.zoomContainer}
            >
              <Image 
                source={{ 
                  uri: fileUrl,
                  headers: {
                    'Authorization': getAuthorizationHeader(),
                  }
                }}
                style={styles.fullScreenImage}
                resizeMode="contain"
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    };
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

        {materialDetail.file_path && renderFileViewer()}

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

      {renderImageViewer()}
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
  fileViewerContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  fileViewerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  fileViewerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  fileViewerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  downloadIconButton: {
    padding: 8,
    marginRight: 8,
    borderRadius: 6,
    backgroundColor: '#f0f8ff',
  },
  viewButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f0f8ff',
  },
  previewContainer: {
    position: 'relative',
  },
  imagePreviewContainer: {
    height: 250,
    backgroundColor: '#f8f9fa',
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  previewLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(248, 249, 250, 0.8)',
  },
  filePreviewContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 20,
  },
  filePreviewText: {
    fontSize: 16,
    color: '#007bff',
    marginTop: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
  fileName: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  fileTypeLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 5,
    fontWeight: '600',
  },
  browserHint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
  },
  browserHintText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
    fontStyle: 'italic',
  },
  offlineHint: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  fullScreenViewer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingTop: Platform.OS === 'ios' ? 44 : 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeButton: {
    padding: 8,
  },
  fullScreenTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginHorizontal: 12,
  },
  downloadButton: {
    padding: 8,
  },
  fullScreenContent: {
    flex: 1,
  },
  zoomContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: screenWidth,
    height: screenHeight - 100,
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