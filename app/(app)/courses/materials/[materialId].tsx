import { Ionicons } from '@expo/vector-icons';
import { Audio, ResizeMode, Video } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { getCompletedOfflineQuizzes, getMaterialDetailsFromDb, getUnsyncedSubmissions } from '@/lib/localDb';
import { syncAllOfflineData } from '@/lib/offlineSync';
import * as IntentLauncher from 'expo-intent-launcher';
import { useNetworkStatus } from '../../../../context/NetworkContext';
import api, { getAuthorizationHeader, getUserData, initializeAuth } from '../../../../lib/api';

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

type FileType = 'image' | 'pdf' | 'document' | 'video' | 'audio' | 'code' | 'other';

const getMimeType = (filePath: string): string => {
  const extension = filePath.split('.').pop()?.toLowerCase();
  switch (extension) {
    // Documents
    case 'pdf': return 'application/pdf';
    case 'doc': return 'application/msword';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls': return 'application/vnd.ms-excel';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ppt': return 'application/vnd.ms-powerpoint';
    case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'txt': return 'text/plain';
    
    // Images
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    
    // Audio
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'm4a': return 'audio/mp4';
    case 'ogg': return 'audio/ogg';
    
    // Video
    case 'mp4': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'mkv': return 'video/x-matroska';
    case 'webm': return 'video/webm';
    
    // Code (as text)
    case 'js': return 'text/javascript';
    case 'json': return 'application/json';
    case 'html': return 'text/html';
    case 'css': return 'text/css';
    
    // Fallback
    default: return 'application/octet-stream';
  }
};

const getMaterialIcon = (type: string) => {
  const lowerType = type.toLowerCase();
  switch (lowerType) {
    case 'document': return 'document-text';
    case 'video': return 'videocam';
    case 'link': return 'link';
    case 'presentation': return 'easel';
    case 'spreadsheet': return 'grid';
    case 'audio': return 'musical-notes';
    case 'image': return 'image';
    case 'pdf': return 'document-attach';
    case 'code': return 'code-slash';
    default: return 'folder';
  }
};

const getMaterialColor = (type: string) => {
  const lowerType = type.toLowerCase();
  switch (lowerType) {
    case 'document': return '#1967d2';
    case 'video': return '#ea4335';
    case 'link': return '#0d9488';
    case 'presentation': return '#f59e0b';
    case 'spreadsheet': return '#16a34a';
    case 'audio': return '#9333ea';
    case 'image': return '#06b6d4';
    case 'pdf': return '#dc2626';
    case 'code': return '#6366f1';
    default: return '#6c757d';
  }
};

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function MaterialDetailsScreen() {
  const { id: courseId, materialId } = useLocalSearchParams();
  const { isConnected, netInfo } = useNetworkStatus();
  
  const [materialDetail, setMaterialDetail] = useState<MaterialDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedFileUri, setDownloadedFileUri] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [isLoadingCode, setIsLoadingCode] = useState(false);

  const [videoStatus, setVideoStatus] = useState({});
  const [audioStatus, setAudioStatus] = useState({});
  const videoRef = useRef<Video>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloadDate, setDownloadDate] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    initializeAuth();
    if (materialId) {
      fetchMaterialDetails();
    }
    
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [materialId, netInfo?.isInternetReachable]);

  useEffect(() => {
    const submitOfflineAssessments = async () => {
      if (netInfo?.isInternetReachable) {
        try {
          const userData = await getUserData();
          if (userData?.email) {
            const unsyncedSubmissions = await getUnsyncedSubmissions(userData.email);
            const completedOfflineQuizzes = await getCompletedOfflineQuizzes(userData.email);
            
            if (unsyncedSubmissions.length > 0 || completedOfflineQuizzes.length > 0) {
              await syncAllOfflineData();
              setTimeout(() => {
                fetchMaterialDetails();
              }, 1000);
            }
          }
        } catch (error) {
          console.error('❌ Error submitting offline assessments:', error);
        }
      }
    };

    submitOfflineAssessments();
  }, [netInfo?.isInternetReachable]);

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
      if (netInfo?.isInternetReachable) {
        const response = await api.get(`/materials/${materialId}`);
        if (response.status === 200) {
          const material = response.data.material;
          setMaterialDetail(material);
          if (material.file_path) {
            await checkIfFileDownloaded(material);
          }
        } else {
          const errorMessage = response.data?.message || 'Failed to fetch material details.';
          setError(errorMessage);
        }
      } else {
        const offlineMaterial = await getMaterialDetailsFromDb(Number(materialId), userEmail);
        if (offlineMaterial) {
          setMaterialDetail(offlineMaterial as MaterialDetail);
          if (offlineMaterial.file_path) {
            await checkIfFileDownloaded(offlineMaterial);
          }
        } else {
          setError('Offline: Material details not available locally.');
        }
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Network error or unable to load material details.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const checkIfFileDownloaded = async (material: MaterialDetail) => {
    if (!material.file_path || !material.id) return;
    
    const fileExtension = material.file_path.split('.').pop();
    const sanitizedTitle = material.title.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${sanitizedTitle}_${material.id}${fileExtension ? `.${fileExtension}` : ''}`;
    const localUri = FileSystem.documentDirectory + fileName;
    
    try {
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists && fileInfo.size > 0) {
        setDownloadedFileUri(localUri);
        setFileSize(formatBytes(fileInfo.size));
        setDownloadDate(new Date(fileInfo.modificationTime * 1000).toLocaleDateString());
        return true;
      }
    } catch (error) {
      console.log('File not downloaded yet or error checking:', error);
    }
    return false;
  };

  const getFileType = (filePath: string): FileType => {
    if (!filePath) return 'other';
    const extension = filePath.split('.').pop()?.toLowerCase();
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension || '')) return 'image';
    if (['pdf'].includes(extension || '')) return 'pdf';
    if (['doc', 'docx', 'txt', 'rtf', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'].includes(extension || '')) return 'document';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v'].includes(extension || '')) return 'video';
    if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(extension || '')) return 'audio';
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'dart', 'html', 'css', 'scss', 'json', 'xml', 'sql', 'sh', 'md'].includes(extension || '')) return 'code';
    
    return 'other';
  };

  const getFileIcon = (fileType: FileType) => {
    switch (fileType) {
      case 'image': return 'image';
      case 'pdf': return 'document-text';
      case 'document': return 'document';
      case 'video': return 'videocam';
      case 'audio': return 'musical-notes';
      case 'code': return 'code-slash';
      default: return 'attach';
    }
  };

  const getAuthenticatedFileUrl = async () => {
    if (!materialDetail?.file_path || !materialDetail?.id) return '';
    try {
      const response = await api.get(`/materials/${materialDetail.id}/view-link`);
      return response.data?.url || `${api.defaults.baseURL}/materials/${materialDetail.id}/view`;
    } catch (error) {
      return `${api.defaults.baseURL}/materials/${materialDetail.id}/view`;
    }
  };

  const loadCodeContent = async (fileUri: string) => {
    if (!fileUri) return;
    setIsLoadingCode(true);
    try {
      const content = await FileSystem.readAsStringAsync(fileUri);
      setCodeContent(content);
    } catch (error) {
      Alert.alert('Error', 'Failed to load code content for viewing.');
    } finally {
      setIsLoadingCode(false);
    }
  };

  // *** MODIFIED *** - Added offline check
  const handleOpenLink = async (url: string) => {
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline Mode', 'An internet connection is required to open this link.');
      return;
    }
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Error', 'Cannot open this link.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to open the link.');
    }
  };

  const promptDownloadOptions = async () => {
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline Mode', 'File downloading requires an internet connection.');
      return;
    }

    Alert.alert(
      'Download File',
      'Choose where you want to save this file:',
      [
        {
          text: 'Download in the app',
          onPress: downloadToAppStorage // Calls the renamed function
        },
        {
          text: 'Download in device',
          onPress: downloadToDeviceExternal // Calls the new external function
        },
        {
          text: 'Cancel',
          style: 'cancel'
        }
      ],
      { cancelable: true }
    );
  };

  const downloadToAppStorage = async () => {
    if (!materialDetail?.file_path || !materialDetail?.id) return;
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline Mode', 'File downloading requires an internet connection.');
      return;
    }
    if (downloadedFileUri) return;

    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        setIsDownloading(false);
        return;
      }
      
      const downloadUrl = `${api.defaults.baseURL}/materials/${materialDetail.id}/view`;
      const fileExtension = materialDetail.file_path.split('.').pop();
      const sanitizedTitle = materialDetail.title.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${sanitizedTitle}_${materialDetail.id}${fileExtension ? `.${fileExtension}` : ''}`;
      const localUri = FileSystem.documentDirectory + fileName;

      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl, localUri,
        { headers: { 'Authorization': getAuthorizationHeader() } },
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite > 0) {
            const progress = totalBytesWritten / totalBytesExpectedToWrite;
            setDownloadProgress(Math.round(progress * 100));
          }
        }
      );

      const result = await downloadResumable.downloadAsync();
      
      if (result?.uri) {
        const fileInfo = await FileSystem.getInfoAsync(result.uri);
        if (fileInfo.exists && fileInfo.size > 0) {
          setDownloadedFileUri(result.uri);
          setFileSize(formatBytes(fileInfo.size));
          setDownloadDate(new Date(fileInfo.modificationTime * 1000).toLocaleDateString());
          Alert.alert('Download Complete!', 'File is now available for offline viewing.');
        } else {
          throw new Error('Downloaded file is corrupted or empty.');
        }
      } else {
        throw new Error('Download failed.');
      }
    } catch (err) {
      Alert.alert('Download Failed', 'Could not download the file. Please try again.');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  const downloadToDeviceExternal = async () => {
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline Mode', 'Downloading to your device requires an internet connection.');
      return;
    }
    if (!materialDetail?.id) {
      Alert.alert('Error', 'Cannot find material to download.');
      return;
    }

    try {
      // Get the same authenticated URL we use for viewing
      const fileUrl = await getAuthenticatedFileUrl();
      if (!fileUrl) {
        Alert.alert('Error', 'Could not get a valid download link.');
        return;
      }

      // Open this URL in the device's browser (e.g., Chrome)
      // The browser will handle the file download process.
      const supported = await Linking.canOpenURL(fileUrl);
      if (supported) {
        await Linking.openURL(fileUrl);
      } else {
        Alert.alert("Cannot Open Link", "No application (like a browser) is available to handle this download.");
      }
    } catch (error) {
      console.error("Failed to open URL with Linking:", error);
      Alert.alert('Error', 'Could not open the download link. Please try again.');
    }
  };

  useEffect(() => {
    if (downloadedFileUri && materialDetail) {
      const fileType = getFileType(materialDetail.file_path || '');
      if (fileType === 'code') {
        loadCodeContent(downloadedFileUri);
      }
    }
  }, [downloadedFileUri, materialDetail]);
  
  const handleViewOnline = async () => {
    if (!netInfo?.isInternetReachable) {
      Alert.alert('Offline Mode', 'Online viewing requires an internet connection.');
      return;
    }
    
    const fileUrl = await getAuthenticatedFileUrl();
    if (!fileUrl) return;

    const fileType = getFileType(materialDetail?.file_path || '');
    
    // For documents and PDFs, offer viewing in Google Docs
    if (['pdf', 'document'].includes(fileType)) {
      Alert.alert(
        'Choose Viewer',
        'We recommend using Google Docs Viewer to open this file.',
        [
          {
            text: 'Google Docs',
            onPress: async () => {
              try {
                const googleDocsUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`;
                const supported = await Linking.canOpenURL(googleDocsUrl);
                if (supported) {
                  await Linking.openURL(googleDocsUrl);
                } else {
                  Alert.alert('Error', 'Cannot open Google Docs Viewer.');
                }
              } catch (error) {
                Alert.alert('Error', 'Could not open with Google Docs Viewer.');
                console.error('Google Docs Viewer error:', error);
              }
            }
          },
          {
            text: 'Cancel',
            style: 'cancel'
          }
        ]
      );
    } else {
      // For other file types (images, videos, etc.), open directly
      try {
        const supported = await Linking.canOpenURL(fileUrl);
        if (supported) {
          await Linking.openURL(fileUrl);
        } else {
          Alert.alert("Cannot Open Link", "No application available to open this file.");
        }
      } catch (error) {
        Alert.alert('Error', 'Could not open the link. Please try again.');
        console.error("Failed to open URL with Linking:", error);
      }
    }
  };

  const handleOpenFile = async () => {
    if (!downloadedFileUri) return;

    // This is an Android-only approach
    if (Platform.OS === 'android') {
      try {
        // 1. Get the shareable content:// URI
        // This is why we removed /legacy from the FileSystem import
        const contentUri = await FileSystem.getContentUriAsync(downloadedFileUri);

        // 2. Get the file's MIME type
        const mimeType = getMimeType(downloadedFileUri);
        
        // 3. Launch the "Open with" (ACTION_VIEW) dialog
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // This is FLAG_GRANT_READ_URI_PERMISSION
          type: mimeType,
        });

      } catch (error) {
        console.error('Error opening file with IntentLauncher', error);
        Alert.alert('Error', 'Could not find an app to open this file.');
      }
    } else {
      // Fallback for other platforms (though you said Android-only)
      // We can just use the original sharing method here if needed
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloadedFileUri, {
            dialogTitle: `Open ${materialDetail?.title}`,
          });
        } else {
          Alert.alert('Not available', 'File opening is not available on this device.');
        }
      } catch (error) {
        Alert.alert('Error', 'Could not open the file.');
      }
    }
  };

  const handleDeleteDownload = async () => {
    if (!downloadedFileUri) return;
    
    Alert.alert(
      "Remove Download",
      "Are you sure you want to delete this file from your device? You will need an internet connection to download it again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            try {
              await FileSystem.deleteAsync(downloadedFileUri);
              setDownloadedFileUri(null);
              setDownloadDate(null);
              setFileSize(null);
              Alert.alert("Deleted", "The file has been removed from your device.");
            } catch (error) {
              Alert.alert("Error", "Could not delete the file. Please try again.");
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleRefresh = useCallback(async () => {
    if (!netInfo?.isInternetReachable) {
      Alert.alert("Offline", "You are currently offline. Please connect to the internet to refresh.");
      return;
    }
    setIsRefreshing(true);
    try {
      await fetchMaterialDetails();
    } catch (error) {
      console.error("Refresh failed", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [netInfo?.isInternetReachable]);

  const renderInlineViewer = () => {
    if (!materialDetail?.file_path) return null;
    
    const fileType = getFileType(materialDetail.file_path);
    
    if (!downloadedFileUri) {
      return (
        <View style={styles.downloadPromptContainer}>
          <View style={styles.downloadPromptContent}>
            <Ionicons name={getFileIcon(fileType)} size={48} color="#1967d2" />
            <Text style={styles.downloadPromptTitle}>{isDownloading ? 'Downloading...' : 'Ready for Offline Access'}</Text>
            <Text style={styles.downloadPromptText}>Download this file to view it anytime, even without an internet connection.</Text>
            {isDownloading ? (
              <View style={styles.progressContainer}>
                <ActivityIndicator color="#1967d2" size="large" />
                <Text style={styles.progressText}>{downloadProgress}%</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.downloadPromptButton} onPress={promptDownloadOptions} disabled={isDownloading}>
                <Ionicons name="download" size={20} color="#fff" />
                <Text style={styles.downloadPromptButtonText}>Download for Offline Access</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    switch (fileType) {
      case 'image': return renderImageViewer();
      case 'video': return renderVideoViewer();
      case 'audio': return renderAudioViewer();
      case 'code': return renderCodeViewer();
      case 'pdf': 
      case 'document':
        return renderGenericDocumentViewer();
      default: return renderGenericFileViewer();
    }
  };

  const renderGenericDocumentViewer = () => {
    const fileExtension = materialDetail?.file_path?.split('.').pop()?.toLowerCase() || '';
    const docInfo = {
      'pdf': { name: 'PDF Document', icon: 'document-text', color: '#ea4335' },
      'ppt': { name: 'PowerPoint Presentation', icon: 'easel', color: '#d24726' },
      'pptx': { name: 'PowerPoint Presentation', icon: 'easel', color: '#d24726' },
      'doc': { name: 'Word Document', icon: 'document', color: '#2b579a' },
      'docx': { name: 'Word Document', icon: 'document', color: '#2b579a' },
      'xls': { name: 'Excel Spreadsheet', icon: 'grid', color: '#107c41' },
      'xlsx': { name: 'Excel Spreadsheet', icon: 'grid', color: '#107c41' },
    }[fileExtension] || { name: 'Document', icon: 'document', color: '#5f6368' };

    return (
      <View style={styles.inlineViewerContainer}>
        <View style={styles.viewerHeader}>
            <View style={styles.documentHeaderInfo}>
              <Ionicons name={docInfo.icon as any} size={20} color={docInfo.color} />
              <Text style={styles.viewerTitle}>{docInfo.name}</Text>
            </View>
            <TouchableOpacity style={styles.actionButton} onPress={handleDeleteDownload} disabled={isDeleting}>
              {isDeleting ? <ActivityIndicator size="small" color="#d93025" /> : <Ionicons name="trash-outline" size={20} color="#d93025" />}
            </TouchableOpacity>
        </View>
        <View style={styles.documentContainer}>
          <View style={[styles.documentIconContainer, { backgroundColor: `${docInfo.color}20` }]}>
            <Ionicons name={docInfo.icon as any} size={64} color={docInfo.color} />
          </View>
          <Text style={styles.documentTitle}>{materialDetail?.title}</Text>
          <Text style={styles.documentSubtext}>This file is downloaded and ready to be opened in a compatible app.</Text>
          <TouchableOpacity style={[styles.primaryDocumentButton, { backgroundColor: docInfo.color }]} onPress={handleOpenFile}>
            <Ionicons name="open-outline" size={20} color="#fff" />
            <Text style={styles.primaryDocumentButtonText}>Open in...</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.downloadedIndicator}>
            <Ionicons name="checkmark-circle" size={16} color="#137333" />
            <Text style={styles.downloadedText}>{`Downloaded on ${downloadDate} • ${fileSize}`}</Text>
        </View>
      </View>
    );
  }

  const renderImageViewer = () => (
    <View style={styles.inlineViewerContainer}>
      <View style={styles.viewerHeader}>
        <Text style={styles.viewerTitle}>Image Preview</Text>
        <View style={styles.viewerActions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => setIsFullScreen(true)}>
            <Ionicons name="expand" size={20} color="#4285f4" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleOpenFile}>
            <Ionicons name="open-outline" size={20} color="#4285f4" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleDeleteDownload} disabled={isDeleting}>
              {isDeleting ? <ActivityIndicator size="small" color="#d93025" /> : <Ionicons name="trash-outline" size={20} color="#d93025" />}
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity onPress={() => setIsFullScreen(true)}>
        <Image source={{ uri: downloadedFileUri! }} style={styles.imagePreview} resizeMode="contain" />
      </TouchableOpacity>
      <View style={styles.downloadedIndicator}>
        <Ionicons name="checkmark-circle" size={16} color="#137333" />
        <Text style={styles.downloadedText}>{`Downloaded on ${downloadDate} • ${fileSize}`}</Text>
      </View>
    </View>
  );

  const renderVideoViewer = () => (
    <View style={styles.inlineViewerContainer}>
      <View style={styles.viewerHeader}>
        <Text style={styles.viewerTitle}>Video Player</Text>
        <View style={styles.viewerActions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => setIsFullScreen(true)}>
            <Ionicons name="expand" size={20} color="#4285f4" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleOpenFile}>
            <Ionicons name="open-outline" size={20} color="#4285f4" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleDeleteDownload} disabled={isDeleting}>
            {isDeleting ? <ActivityIndicator size="small" color="#d93025" /> : <Ionicons name="trash-outline" size={20} color="#d93025" />}
          </TouchableOpacity>
        </View>
      </View>
      <Video
        ref={videoRef}
        style={styles.videoPlayer}
        source={{ uri: downloadedFileUri! }}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        onPlaybackStatusUpdate={setVideoStatus}
      />
      <View style={styles.downloadedIndicator}>
        <Ionicons name="checkmark-circle" size={16} color="#137333" />
        <Text style={styles.downloadedText}>{`Downloaded on ${downloadDate} • ${fileSize}`}</Text>
      </View>
    </View>
  );

  const renderAudioViewer = () => {
    const playAudio = async () => {
      try {
        if (sound) await sound.unloadAsync();
        const { sound: newSound } = await Audio.Sound.createAsync({ uri: downloadedFileUri! }, { shouldPlay: true });
        setSound(newSound);
        newSound.setOnPlaybackStatusUpdate(setAudioStatus);
      } catch (error) { Alert.alert('Error', 'Could not play audio file.'); }
    };

    return (
      <View style={styles.inlineViewerContainer}>
        <View style={styles.viewerHeader}>
          <Text style={styles.viewerTitle}>Audio Player</Text>
          <View style={styles.viewerActions}>
            <TouchableOpacity style={styles.actionButton} onPress={handleOpenFile}>
              <Ionicons name="open-outline" size={20} color="#4285f4" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleDeleteDownload} disabled={isDeleting}>
              {isDeleting ? <ActivityIndicator size="small" color="#d93025" /> : <Ionicons name="trash-outline" size={20} color="#d93025" />}
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.audioPlayerContainer}>
          <Ionicons name="musical-notes" size={64} color="#4285f4" />
          <Text style={styles.audioFileName}>{materialDetail?.title}</Text>
          <TouchableOpacity style={styles.playButton} onPress={playAudio}>
            <Ionicons name="play-circle" size={48} color="#4285f4" />
          </TouchableOpacity>
        </View>
        <View style={styles.downloadedIndicator}>
          <Ionicons name="checkmark-circle" size={16} color="#137333" />
          <Text style={styles.downloadedText}>{`Downloaded on ${downloadDate} • ${fileSize}`}</Text>
        </View>
      </View>
    );
  };

  const renderGenericFileViewer = () => (
    <View style={styles.inlineViewerContainer}>
      <View style={styles.viewerHeader}>
        <Text style={styles.viewerTitle}>File Downloaded</Text>
        <TouchableOpacity style={styles.actionButton} onPress={handleDeleteDownload} disabled={isDeleting}>
          {isDeleting ? <ActivityIndicator size="small" color="#d93025" /> : <Ionicons name="trash-outline" size={20} color="#d93025" />}
        </TouchableOpacity>
      </View>
      <View style={styles.genericFileContainer}>
        <Ionicons name={getFileIcon(getFileType(materialDetail?.file_path || ''))} size={64} color="#4285f4" />
        <Text style={styles.genericFileName}>{materialDetail?.title}</Text>
        <TouchableOpacity style={styles.openFileButton} onPress={handleOpenFile}>
          <Text style={styles.openFileButtonText}>Open in...</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.downloadedIndicator}>
        <Ionicons name="checkmark-circle" size={16} color="#137333" />
        <Text style={styles.downloadedText}>{`Downloaded on ${downloadDate} • ${fileSize}`}</Text>
      </View>
    </View>
  );

  const renderCodeViewer = () => {
    return (
      <View style={styles.inlineViewerContainer}>
        <View style={styles.viewerHeader}>
          <View style={styles.codeHeaderInfo}>
            <Ionicons name="code-slash" size={20} color="#4285f4" />
            <Text style={styles.viewerTitle}>Code Viewer</Text>
          </View>
          <View style={styles.viewerActions}>
            <TouchableOpacity style={styles.actionButton} onPress={() => setIsFullScreen(true)}>
              <Ionicons name="expand" size={20} color="#4285f4" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleOpenFile}>
              <Ionicons name="open-outline" size={20} color="#4285f4" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleDeleteDownload} disabled={isDeleting}>
              {isDeleting ? <ActivityIndicator size="small" color="#d93025" /> : <Ionicons name="trash-outline" size={20} color="#d93025" />}
            </TouchableOpacity>
          </View>
        </View>
        {isLoadingCode ? (
          <ActivityIndicator style={{ padding: 48 }} color="#4285f4" size="large" />
        ) : codeContent ? (
          <ScrollView style={styles.codeScrollContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.codeText} selectable={true}>{codeContent}</Text>
            </ScrollView>
          </ScrollView>
        ) : (
          <View style={styles.errorCodeContainer}><Text style={styles.errorCodeText}>Failed to load code.</Text></View>
        )}
        <View style={styles.downloadedIndicator}>
          <Ionicons name="checkmark-circle" size={16} color="#137333" />
          <Text style={styles.downloadedText}>{`Downloaded on ${downloadDate} • ${fileSize}`}</Text>
        </View>
      </View>
    );
  };

  const renderFullScreenModal = () => {
    if (!isFullScreen || !downloadedFileUri || !materialDetail) return null;
    const fileType = getFileType(materialDetail.file_path || '');
    
    return (
      <Modal visible={isFullScreen} animationType="slide">
        <SafeAreaView style={styles.fullScreenContainer}>
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity style={styles.fullScreenCloseButton} onPress={() => setIsFullScreen(false)}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.fullScreenTitle} numberOfLines={1}>{materialDetail.title}</Text>
            <TouchableOpacity style={styles.fullScreenShareButton} onPress={handleOpenFile}>
              <Ionicons name="open-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.fullScreenContent}>
            {fileType === 'image' && <Image source={{ uri: downloadedFileUri }} style={styles.fullScreenImage} resizeMode="contain" />}
            {fileType === 'video' && <Video style={styles.fullScreenVideo} source={{ uri: downloadedFileUri }} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay />}
            {fileType === 'code' && codeContent && (
              <ScrollView><ScrollView horizontal><Text style={styles.fullScreenCodeText} selectable={true}>{codeContent}</Text></ScrollView></ScrollView>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    );
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) { return ( <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#1967d2" /><Text style={styles.loadingText}>Loading material...</Text></View> ); }
  if (error) { return ( <View style={styles.centeredContainer}><Text style={styles.errorText}>{error}</Text><TouchableOpacity style={styles.retryButton} onPress={fetchMaterialDetails}><Text style={styles.retryButtonText}>Retry</Text></TouchableOpacity></View> ); }
  if (!materialDetail) { return ( <View style={styles.centeredContainer}><Text style={styles.errorText}>Material not found.</Text></View> ); }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: materialDetail.title || 'Material Details' }} />
      
      <ScrollView 
        contentContainerStyle={styles.scrollViewContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#1967d2"
          />
        }
      >
        <View style={styles.headerContainer}>
          <View style={styles.titleRow}>
            {/* Title comes first now */}
            <Text style={styles.materialTitle} numberOfLines={2}>{materialDetail.title}</Text>
            
            {/* Material type badge comes after */}
            {materialDetail.material_type && (
              <View style={[styles.materialTypeBadge, { backgroundColor: getMaterialColor(materialDetail.material_type) }]}>
                <Ionicons name={getMaterialIcon(materialDetail.material_type)} size={16} color="#fff" />
                <Text style={styles.materialTypeText}>
                  {materialDetail.material_type.toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          
          {materialDetail.description && (
            <Text style={styles.materialDescription}>{materialDetail.description}</Text>
          )}
          
          {!netInfo?.isInternetReachable && (
            <View style={styles.offlineNotice}>
              <Ionicons name="cloud-offline" size={14} color="#5f6368" />
              <Text style={styles.offlineText}>Offline Mode</Text>
            </View>
          )}
        </View>

        {/* Action Buttons Section */}
        {/* *** MODIFIED *** - Made material type check case-insensitive and null-safe */}
        {materialDetail.material_type?.toLowerCase() !== 'link' && materialDetail.file_path && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>File Actions</Text>
            
            <View style={styles.actionButtonsGrid}>
              {!downloadedFileUri && !isDownloading && (
                <TouchableOpacity 
                  style={[styles.actionCard, !netInfo?.isInternetReachable && styles.actionCardDisabled]} 
                  onPress={promptDownloadOptions} 
                  disabled={!netInfo?.isInternetReachable}
                >
                  <View style={styles.actionCardContent}>
                    <View style={styles.actionCardIcon}>
                      <Ionicons name="download" size={24} color={netInfo?.isInternetReachable ? "#fff" : "#9aa0a6"} />
                    </View>
                    <View style={styles.actionCardText}>
                      <Text style={[styles.actionCardTitle, !netInfo?.isInternetReachable && styles.disabledText]}>
                        Download for Offline
                      </Text>
                      <Text style={[styles.actionCardSubtitle, !netInfo?.isInternetReachable && styles.disabledText]}>
                        Access anytime without internet
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
              
              {netInfo?.isInternetReachable && (
                <TouchableOpacity style={styles.actionCard} onPress={handleViewOnline}>
                  <View style={styles.actionCardContent}>
                    <View style={styles.actionCardIcon}>
                      <Ionicons name="globe-outline" size={24} color="#fff" />
                    </View>
                    <View style={styles.actionCardText}>
                      <Text style={styles.actionCardTitle}>View Online</Text>
                      <Text style={styles.actionCardSubtitle}>Open in browser or app</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Content Section */}
        {materialDetail.content && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Content</Text>
            <Text style={styles.materialContent}>{materialDetail.content}</Text>
          </View>
        )}

        {/* *** MODIFIED *** - External Link Section now handles offline state gracefully */}
        {materialDetail.material_type?.toLowerCase() === 'link' && materialDetail.file_path && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>External Link</Text>
            <TouchableOpacity 
              style={styles.linkClickableContainer} 
              onPress={() => handleOpenLink(materialDetail.file_path!)}
            >
              <View style={styles.linkContentWrapper}>
                <Ionicons name="link" size={24} color={'#4285f4'} />
                <Text style={styles.linkUrlText} numberOfLines={1}>
                  {materialDetail.file_path}
                </Text>
                <Ionicons name="open-outline" size={20} color={'#4285f4'} />
              </View>
            </TouchableOpacity>
            {!netInfo?.isInternetReachable && (
              <View style={styles.offlineLinkNotice}>
                <Text style={styles.offlineLinkText}>An internet connection is required to open this link.</Text>
              </View>
            )}
          </View>
        )}
        
        {/* *** MODIFIED *** - File Viewer Section with case-insensitive check */}
        {materialDetail.file_path && materialDetail.material_type?.toLowerCase() !== 'link' && renderInlineViewer()}

        {/* Details Section */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeader}>Material Information</Text>
          
          <View style={styles.detailsGrid}>
            <View style={styles.detailCard}>
              <View style={styles.detailIconContainer}>
                <Ionicons name="calendar" size={20} color="#1967d2" />
              </View>
              <Text style={styles.detailLabel}>Created</Text>
              <Text style={styles.detailValue}>{formatDate(materialDetail.created_at)}</Text>
            </View>
            
            {materialDetail.available_at && (
              <View style={styles.detailCard}>
                <View style={styles.detailIconContainer}>
                  <Ionicons name="time" size={20} color="#137333" />
                </View>
                <Text style={styles.detailLabel}>Available From</Text>
                <Text style={styles.detailValue}>{formatDate(materialDetail.available_at)}</Text>
              </View>
            )}
            
            {materialDetail.unavailable_at && (
              <View style={styles.detailCard}>
                <View style={styles.detailIconContainer}>
                  <Ionicons name="close-circle" size={20} color="#d93025" />
                </View>
                <Text style={styles.detailLabel}>Available Until</Text>
                <Text style={styles.detailValue}>{formatDate(materialDetail.unavailable_at)}</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
      {renderFullScreenModal()}
    </View>
  );
}

// *** MODIFIED *** - Added new styles for the offline link notice
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f9fa' },
  loadingText: { marginTop: 16, fontSize: 16, color: '#5f6368' },
  centeredContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { fontSize: 16, color: '#d93025', textAlign: 'center', marginBottom: 20 },
  retryButton: { backgroundColor: '#1967d2', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  scrollViewContent: { paddingBottom: 24 },
  
  headerContainer: { 
    backgroundColor: '#fff', 
    padding: 20, 
    borderBottomWidth: 1, 
    borderBottomColor: '#e0e0e0' 
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  materialTypeBadge: { 
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: 8,
  },
  materialTypeText: { 
    color: '#fff',
    fontSize: 11, 
    fontWeight: '700', 
    letterSpacing: 0.5 
  },
  materialTitle: { 
    flex: 1,
    fontSize: 22, 
    fontWeight: '600', 
    color: '#202124', 
    textAlign: 'left',
  },
  materialDescription: { 
    fontSize: 15, 
    color: '#5f6368', 
    textAlign: 'left', 
    lineHeight: 22 
  },
  offlineNotice: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    alignSelf: 'flex-start', 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    backgroundColor: '#f1f3f4', 
    borderRadius: 16, 
    marginTop: 16, 
    gap: 6 
  },
  offlineText: { fontSize: 12, color: '#5f6368', fontWeight: '500' },
  
  sectionContainer: { 
    marginHorizontal: 16, 
    marginTop: 16, 
    backgroundColor: '#fff', 
    borderRadius: 8, 
    padding: 16, 
    borderWidth: 1, 
    borderColor: '#e0e0e0' 
  },
  sectionHeader: { 
    fontSize: 18, 
    fontWeight: '500', 
    color: '#202124', 
    marginBottom: 16 
  },
  
  actionButtonsGrid: { gap: 12 },
  actionCard: { 
    backgroundColor: '#1967d2', 
    borderRadius: 8, 
    padding: 16, 
    borderWidth: 1, 
    borderColor: '#1967d2' 
  },
  actionCardDisabled: { 
    backgroundColor: '#f1f3f4', 
    borderColor: '#e0e0e0' 
  },
  actionCardContent: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 12 
  },
  actionCardIcon: { 
    width: 48, 
    height: 48, 
    borderRadius: 24, 
    backgroundColor: 'rgba(255, 255, 255, 0.2)', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  actionCardText: { flex: 1 },
  actionCardTitle: { 
    fontSize: 16, 
    fontWeight: '500', 
    color: '#fff', 
    marginBottom: 4 
  },
  actionCardSubtitle: { 
    fontSize: 13, 
    color: 'rgba(255, 255, 255, 0.8)' 
  },
  disabledText: { color: '#9aa0a6' },
  
  detailsGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    gap: 12 
  },
  detailCard: { 
    flex: 1, 
    minWidth: '45%', 
    backgroundColor: '#f8f9fa', 
    padding: 12, 
    borderRadius: 8, 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#e0e0e0' 
  },
  detailIconContainer: { 
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    backgroundColor: '#fff', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 8 
  },
  detailLabel: { 
    fontSize: 12, 
    color: '#5f6368', 
    marginBottom: 4,
    textAlign: 'center'
  },
  detailValue: { 
    fontSize: 14, 
    fontWeight: '600', 
    color: '#202124',
    textAlign: 'center'
  },
  
  materialContent: { fontSize: 14, color: '#5f6368', lineHeight: 22 },
  linkClickableContainer: { 
    backgroundColor: '#f8f9fa', 
    borderRadius: 8, 
    padding: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0'
  },
  linkContentWrapper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkUrlText: { flex: 1, fontSize: 14, color: '#1967d2', fontWeight: '500' },
  offlineLinkNotice: {
    marginTop: 12,
    padding: 8,
    backgroundColor: '#f1f3f4',
    borderRadius: 6,
    alignItems: 'center'
  },
  offlineLinkText: {
    fontSize: 12,
    color: '#5f6368',
  },
  
  downloadPromptContainer: { 
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#fff', 
    borderRadius: 8, 
    borderWidth: 1, 
    borderColor: '#e0e0e0' 
  },
  downloadPromptContent: { padding: 32, alignItems: 'center' },
  downloadPromptTitle: { 
    fontSize: 20, 
    fontWeight: '500', 
    color: '#202124', 
    marginTop: 16, 
    marginBottom: 8 
  },
  downloadPromptText: { 
    fontSize: 14, 
    color: '#5f6368', 
    textAlign: 'center', 
    marginBottom: 24, 
    lineHeight: 20 
  },
  progressContainer: { alignItems: 'center', gap: 12 },
  progressText: { fontSize: 16, fontWeight: '500', color: '#1967d2' },
  downloadPromptButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#1967d2', 
    paddingVertical: 12, 
    paddingHorizontal: 24, 
    borderRadius: 8, 
    gap: 8 
  },
  downloadPromptButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  
  inlineViewerContainer: { 
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#fff', 
    borderRadius: 8, 
    borderWidth: 1, 
    borderColor: '#e0e0e0' 
  },
  viewerHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 12, 
    backgroundColor: '#f8f9fa', 
    borderBottomWidth: 1, 
    borderBottomColor: '#e0e0e0' 
  },
  viewerTitle: { fontSize: 16, fontWeight: '500', color: '#202124' },
  viewerActions: { flexDirection: 'row', gap: 8 },
  actionButton: { padding: 6 },
  documentHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  codeHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  
  imagePreview: { width: '100%', height: 300, backgroundColor: '#f8f9fa' },
  downloadedIndicator: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 12, 
    backgroundColor: '#e6f4ea', 
    gap: 8, 
    borderTopWidth: 1, 
    borderTopColor: '#d0e5d6' 
  },
  downloadedText: { fontSize: 12, color: '#137333', flex: 1 },
  videoPlayer: { width: '100%', height: 250, backgroundColor: '#000' },
  audioPlayerContainer: { padding: 48, alignItems: 'center', backgroundColor: '#f8f9fa' },
  audioFileName: { 
    fontSize: 16, 
    color: '#202124', 
    marginTop: 16, 
    marginBottom: 24, 
    textAlign: 'center' 
  },
  playButton: { padding: 10 },
  
  genericFileContainer: { padding: 48, alignItems: 'center' },
  genericFileName: { 
    fontSize: 16, 
    color: '#202124', 
    marginTop: 16, 
    marginBottom: 24, 
    textAlign: 'center' 
  },
  openFileButton: { 
    backgroundColor: '#1967d2', 
    paddingVertical: 12, 
    paddingHorizontal: 24, 
    borderRadius: 8 
  },
  openFileButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  
  documentContainer: { padding: 24, alignItems: 'center' },
  documentIconContainer: { 
    width: 96, 
    height: 96, 
    borderRadius: 48, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 20 
  },
  documentTitle: { 
    fontSize: 18, 
    fontWeight: '500', 
    color: '#202124', 
    textAlign: 'center', 
    marginBottom: 8 
  },
  documentSubtext: { 
    fontSize: 14, 
    color: '#5f6368', 
    textAlign: 'center', 
    marginBottom: 24, 
    lineHeight: 20 
  },
  primaryDocumentButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingVertical: 14, 
    paddingHorizontal: 24, 
    borderRadius: 8, 
    gap: 8 
  },
  primaryDocumentButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  
  codeScrollContainer: { maxHeight: 400, backgroundColor: '#f8f9fa' },
  codeText: { 
    fontFamily: 'monospace', 
    fontSize: 14, 
    color: '#202124', 
    padding: 16 
  },
  errorCodeContainer: { padding: 48, alignItems: 'center' },
  errorCodeText: { 
    marginTop: 16, 
    fontSize: 14, 
    color: '#d93025', 
    marginBottom: 24 
  },
  retryCodeButton: { 
    backgroundColor: '#1967d2', 
    paddingVertical: 10, 
    paddingHorizontal: 20, 
    borderRadius: 8 
  },
  retryCodeButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  
  fullScreenContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    backgroundColor: 'rgba(0, 0, 0, 0.8)' 
  },
  fullScreenCloseButton: { padding: 8 },
  fullScreenTitle: { 
    flex: 1, 
    fontSize: 16, 
    color: '#fff', 
    marginHorizontal: 12, 
    fontWeight: '500' 
  },
  fullScreenShareButton: { padding: 8 },
  fullScreenContent: { flex: 1, justifyContent: 'center' },
  fullScreenImage: { width: screenWidth, height: screenHeight - 100 },
  fullScreenVideo: { flex: 1 },
  fullScreenCodeText: { 
    fontFamily: 'monospace', 
    fontSize: 14, 
    color: '#d4d4d4', 
    padding: 16 
  },
});