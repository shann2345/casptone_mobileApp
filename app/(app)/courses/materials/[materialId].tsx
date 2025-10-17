import { Ionicons } from '@expo/vector-icons';
import { Audio, ResizeMode, Video } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { WebView } from 'react-native-webview';

import { getCompletedOfflineQuizzes, getMaterialDetailsFromDb, getUnsyncedSubmissions } from '@/lib/localDb';
import { syncAllOfflineData } from '@/lib/offlineSync';
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


const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function MaterialDetailsScreen() {
  const { id: courseId, materialId } = useLocalSearchParams();
  const { isConnected, netInfo } = useNetworkStatus();
  
  // Import Linking for opening URLs
  const { Linking } = require('react-native');
  const [materialDetail, setMaterialDetail] = useState<MaterialDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedFileUri, setDownloadedFileUri] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [fileViewerOpen, setFileViewerOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [isLoadingCode, setIsLoadingCode] = useState(false);

  // Media players
  const [videoStatus, setVideoStatus] = useState({});
  const [audioStatus, setAudioStatus] = useState({});
  const videoRef = useRef<Video>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  useEffect(() => {
    initializeAuth();
    if (materialId) {
      fetchMaterialDetails();
    }
    
    return () => {
      // Cleanup audio when component unmounts
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [materialId, netInfo?.isInternetReachable]);

  useEffect(() => {
    const submitOfflineAssessments = async () => {
      if (netInfo?.isInternetReachable) {
        console.log('🌐 Network detected, checking for offline assessments to submit...');
        try {
          const userData = await getUserData();
          if (userData?.email) {
            const unsyncedSubmissions = await getUnsyncedSubmissions(userData.email);
            const completedOfflineQuizzes = await getCompletedOfflineQuizzes(userData.email);
            
            if (unsyncedSubmissions.length > 0 || completedOfflineQuizzes.length > 0) {
              console.log(`📤 Found ${unsyncedSubmissions.length} file submissions and ${completedOfflineQuizzes.length} quizzes to sync`);
              await syncAllOfflineData();
              console.log('✅ Offline assessments synced successfully');
              // Refresh data after sync
              setTimeout(() => {
                // Call the appropriate refresh function for each file
                // For index.tsx: fetchCourses();
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
        console.log('✅ Online: Fetching material details from API.');
        const response = await api.get(`/materials/${materialId}`);
        if (response.status === 200) {
          const material = response.data.material;
          setMaterialDetail(material);
          
          // Check if file is already downloaded
          if (material.file_path) {
            await checkIfFileDownloaded(material);
          }
        } else {
          const errorMessage = response.data?.message || 'Failed to fetch material details.';
          setError(errorMessage);
          Alert.alert('Error', errorMessage);
        }
      } else {
        console.log('⚠️ Offline: Fetching material details from local DB.');
        const offlineMaterial = await getMaterialDetailsFromDb(materialId as string, userEmail);
        if (offlineMaterial) {
          setMaterialDetail(offlineMaterial as MaterialDetail);
          
          // Check if file is downloaded locally
          if (offlineMaterial.file_path) {
            await checkIfFileDownloaded(offlineMaterial);
          }
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

  const checkIfFileDownloaded = async (material: MaterialDetail) => {
    if (!material.file_path || !material.id) return;
    
    const fileExtension = material.file_path.split('.').pop();
    const sanitizedTitle = material.title.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${sanitizedTitle}_${material.id}${fileExtension ? `.${fileExtension}` : ''}`;
    const localUri = FileSystem.documentDirectory + fileName;
    
    try {
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      
      if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
        setDownloadedFileUri(localUri);
        return true;
      } else if (fileInfo.exists && (!fileInfo.size || fileInfo.size === 0)) {
        await FileSystem.deleteAsync(localUri);
      }
    } catch (error) {
      console.log('📁 File not downloaded yet or error checking:', error);
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
      console.error('❌ Error getting signed URL:', error);
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
      console.error('❌ Failed to load code content:', error);
      Alert.alert('Error', 'Failed to load code content for viewing.');
    } finally {
      setIsLoadingCode(false);
    }
  };

  const handleOpenLink = async (url: string) => {
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

  const handleDownload = async () => {
    if (!materialDetail?.file_path || !materialDetail?.id) {
      Alert.alert('No File', 'This material does not have an attached file.');
      return;
    }
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
        Alert.alert('Permission Required', 'Permission to access your media library is required to save files.');
        setIsDownloading(false);
        return;
      }

      const downloadUrl = `${api.defaults.baseURL}/materials/${materialDetail.id}/view`;
      const fileExtension = materialDetail.file_path.split('.').pop();
      const sanitizedTitle = materialDetail.title.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${sanitizedTitle}_${materialDetail.id}${fileExtension ? `.${fileExtension}` : ''}`;
      const localUri = FileSystem.documentDirectory + fileName;

      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        localUri,
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
          Alert.alert('Download Complete!', 'File is now available for offline viewing.');
        } else {
          throw new Error('Downloaded file is corrupted or empty.');
        }
      } else {
        throw new Error('Download failed.');
      }
    } catch (err) {
      console.error("Download failed:", err);
      Alert.alert('Download Failed', 'Could not download the file. Please try again.');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
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
    if (fileUrl) {
      WebBrowser.openBrowserAsync(fileUrl);
    } else {
      Alert.alert('Error', 'Unable to open file.');
    }
  };

  const handleOpenFile = async () => {
    if (!downloadedFileUri) {
      Alert.alert('No File', 'Please download the file first to open it.');
      return;
    }

    try {
      if (await Sharing.isAvailableAsync()) {
        const fileType = getFileType(materialDetail?.file_path || '');
        
        Alert.alert(
          'Open File',
          `This will open the file with an available app on your device.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Continue', 
              onPress: async () => {
                await Sharing.shareAsync(downloadedFileUri, {
                  mimeType: getMimeType(fileType),
                  dialogTitle: `Open ${materialDetail?.title}`,
                });
              }
            }
          ]
        );
      } else {
        Alert.alert('Not available', 'File opening is not available on this device.');
      }
    } catch (error) {
      console.error('Open file failed:', error);
      Alert.alert('Error', 'Could not open the file.');
    }
  };

  const getMimeType = (fileType: string) => {
    switch (fileType) {
      case 'pdf': return 'application/pdf';
      case 'document': return 'application/msword';
      case 'image': return 'image/*';
      case 'video': return 'video/*';
      case 'audio': return 'audio/*';
      default: return 'application/octet-stream';
    }
  };

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
              <TouchableOpacity style={styles.downloadPromptButton} onPress={handleDownload} disabled={isDownloading}>
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
      case 'document': return renderDocumentViewer();
      default: return renderGenericFileViewer();
    }
  };

  const renderDocumentViewer = () => {
    const fileExtension = materialDetail?.file_path?.split('.').pop()?.toLowerCase() || '';
    
    const docInfo = {
      'pdf': { name: 'PDF Document', icon: 'document-text', color: '#ea4335' },
      'ppt': { name: 'PowerPoint Presentation', icon: 'easel', color: '#d24726' },
      'pptx': { name: 'PowerPoint Presentation', icon: 'easel', color: '#d24726' },
      'doc': { name: 'Word Document', icon: 'document', color: '#2b579a' },
      'docx': { name: 'Word Document', icon: 'document', color: '#2b579a' },
      'xls': { name: 'Excel Spreadsheet', icon: 'grid', color: '#107c41' },
      'xlsx': { name: 'Excel Spreadsheet', icon: 'grid', color: '#107c41' },
      'txt': { name: 'Text Document', icon: 'document-text', color: '#5f6368' }
    }[fileExtension] || { name: 'Document', icon: 'document', color: '#4285f4' };
    
    if (fileExtension === 'pdf' && downloadedFileUri) {
      return (
        <View style={styles.inlineViewerContainer}>
          <View style={styles.viewerHeader}>
            <View style={styles.documentHeaderInfo}>
              <Ionicons name={docInfo.icon as any} size={20} color={docInfo.color} />
              <Text style={styles.viewerTitle}>{docInfo.name}</Text>
            </View>
            <View style={styles.viewerActions}>
              <TouchableOpacity style={styles.actionButton} onPress={() => setIsFullScreen(true)}>
                <Ionicons name="expand" size={20} color="#4285f4" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={handleOpenFile}>
                <Ionicons name="open-outline" size={20} color="#4285f4" />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.pdfViewerContainer}>
            <WebView
              source={{ uri: downloadedFileUri }}
              style={styles.pdfWebView}
              startInLoadingState={true}
              renderLoading={() => <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color="#4285f4" />}
            />
          </View>
          <View style={styles.downloadedIndicator}>
            <Ionicons name="checkmark-circle" size={16} color="#34a853" />
            <Text style={styles.downloadedText}>PDF downloaded for offline viewing.</Text>
          </View>
        </View>
      );
    }
    
    return (
      <View style={styles.inlineViewerContainer}>
        <View style={styles.viewerHeader}>
          <View style={styles.documentHeaderInfo}>
            <Ionicons name={docInfo.icon as any} size={20} color={docInfo.color} />
            <Text style={styles.viewerTitle}>{docInfo.name}</Text>
          </View>
        </View>
        <View style={styles.documentContainer}>
          <View style={[styles.documentIconContainer, { backgroundColor: `${docInfo.color}20` }]}>
            <Ionicons name={docInfo.icon as any} size={64} color={docInfo.color} />
          </View>
          <Text style={styles.documentTitle}>{materialDetail?.title}</Text>
          <Text style={styles.documentSubtext}>This file is downloaded and ready to be opened in a compatible app.</Text>
          <TouchableOpacity style={[styles.primaryDocumentButton, { backgroundColor: docInfo.color }]} onPress={handleOpenFile}>
            <Ionicons name="open-outline" size={20} color="#fff" />
            <Text style={styles.primaryDocumentButtonText}>Open with App</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

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
        </View>
      </View>
      <TouchableOpacity onPress={() => setIsFullScreen(true)}>
        <Image source={{ uri: downloadedFileUri! }} style={styles.imagePreview} resizeMode="contain" />
      </TouchableOpacity>
      <View style={styles.downloadedIndicator}>
        <Ionicons name="checkmark-circle" size={16} color="#34a853" />
        <Text style={styles.downloadedText}>Downloaded for offline viewing.</Text>
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
        <Ionicons name="checkmark-circle" size={16} color="#34a853" />
        <Text style={styles.downloadedText}>Downloaded for offline playback.</Text>
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
      } catch (error) {
        Alert.alert('Error', 'Could not play audio file.');
      }
    };

    return (
      <View style={styles.inlineViewerContainer}>
        <View style={styles.viewerHeader}>
          <Text style={styles.viewerTitle}>Audio Player</Text>
          <TouchableOpacity style={styles.actionButton} onPress={handleOpenFile}>
            <Ionicons name="open-outline" size={20} color="#4285f4" />
          </TouchableOpacity>
        </View>
        <View style={styles.audioPlayerContainer}>
          <Ionicons name="musical-notes" size={64} color="#4285f4" />
          <Text style={styles.audioFileName}>{materialDetail?.title}</Text>
          <TouchableOpacity style={styles.playButton} onPress={playAudio}>
            <Ionicons name="play-circle" size={48} color="#4285f4" />
          </TouchableOpacity>
        </View>
        <View style={styles.downloadedIndicator}>
          <Ionicons name="checkmark-circle" size={16} color="#34a853" />
          <Text style={styles.downloadedText}>Downloaded for offline playback.</Text>
        </View>
      </View>
    );
  };

  const renderGenericFileViewer = () => (
    <View style={styles.inlineViewerContainer}>
      <View style={styles.viewerHeader}>
        <Text style={styles.viewerTitle}>File Downloaded</Text>
        <TouchableOpacity style={styles.actionButton} onPress={handleOpenFile}>
          <Ionicons name="open-outline" size={20} color="#4285f4" />
        </TouchableOpacity>
      </View>
      <View style={styles.genericFileContainer}>
        <Ionicons name={getFileIcon(getFileType(materialDetail?.file_path || ''))} size={64} color="#4285f4" />
        <Text style={styles.genericFileName}>{materialDetail?.title}</Text>
        <TouchableOpacity style={styles.openFileButton} onPress={handleOpenFile}>
          <Text style={styles.openFileButtonText}>Open with App</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.downloadedIndicator}>
        <Ionicons name="checkmark-circle" size={16} color="#34a853" />
        <Text style={styles.downloadedText}>Downloaded and ready to open.</Text>
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
          <View style={styles.errorCodeContainer}>
            <Text style={styles.errorCodeText}>Failed to load code.</Text>
            <TouchableOpacity style={styles.retryCodeButton} onPress={() => downloadedFileUri && loadCodeContent(downloadedFileUri)}>
              <Text style={styles.retryCodeButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.downloadedIndicator}>
          <Ionicons name="checkmark-circle" size={16} color="#34a853" />
          <Text style={styles.downloadedText}>Downloaded for offline viewing.</Text>
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
            {fileType === 'pdf' && <WebView source={{ uri: downloadedFileUri }} style={{ flex: 1 }} />}
            {fileType === 'code' && codeContent && (
              <ScrollView>
                <ScrollView horizontal>
                  <Text style={styles.fullScreenCodeText} selectable={true}>{codeContent}</Text>
                </ScrollView>
              </ScrollView>
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4285f4" />
        <Text style={styles.loadingText}>Loading material...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchMaterialDetails}><Text style={styles.retryButtonText}>Retry</Text></TouchableOpacity>
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
        <View style={styles.headerSection}>
          <Text style={styles.materialTitle}>{materialDetail.title}</Text>
          {materialDetail.description && <Text style={styles.materialDescription}>{materialDetail.description}</Text>}
          {materialDetail.material_type !== 'link' && (
            <View style={styles.actionButtonsContainer}>
              {!downloadedFileUri && !isDownloading && (
                <TouchableOpacity style={styles.headerActionButton} onPress={handleDownload} disabled={!netInfo?.isInternetReachable}>
                  <Ionicons name="download" size={20} color="#fff" />
                  <Text style={styles.headerActionButtonText}>Download</Text>
                </TouchableOpacity>
              )}
              {downloadedFileUri && (
                <TouchableOpacity style={[styles.headerActionButton, styles.downloadedButton]} onPress={handleOpenFile}>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.headerActionButtonText}>Downloaded</Text>
                </TouchableOpacity>
              )}
              {netInfo?.isInternetReachable && (
                <TouchableOpacity style={styles.headerActionButton} onPress={handleViewOnline}>
                  <Ionicons name="globe-outline" size={20} color="#fff" />
                  <Text style={styles.headerActionButtonText}>View Online</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {materialDetail.content && (
          <View style={styles.contentSection}>
            <Text style={styles.sectionHeader}>Content</Text>
            <Text style={styles.materialContent}>{materialDetail.content}</Text>
          </View>
        )}

        {materialDetail.material_type === 'link' && materialDetail.file_path && (
          <View style={styles.contentSection}>
            <Text style={styles.sectionHeader}>External Link</Text>
            <TouchableOpacity style={styles.linkClickableContainer} onPress={() => handleOpenLink(materialDetail.file_path!)}>
              <View style={styles.linkContentWrapper}>
                <Ionicons name="link" size={24} color="#4285f4" />
                <Text style={styles.linkUrlText} numberOfLines={1}>{materialDetail.file_path}</Text>
                <Ionicons name="open-outline" size={20} color="#4285f4" />
              </View>
            </TouchableOpacity>
          </View>
        )}

        {materialDetail.file_path && materialDetail.material_type !== 'link' && renderInlineViewer()}

        <View style={styles.detailsSection}>
          <Text style={styles.sectionHeader}>Details</Text>
          <View style={styles.detailRow}><Ionicons name="calendar" size={18} color="#666" /><Text style={styles.detailText}><Text style={styles.detailLabel}>Created: </Text>{formatDate(materialDetail.created_at)}</Text></View>
          {materialDetail.available_at && <View style={styles.detailRow}><Ionicons name="time" size={18} color="#666" /><Text style={styles.detailText}><Text style={styles.detailLabel}>Available: </Text>{formatDate(materialDetail.available_at)}</Text></View>}
          {materialDetail.unavailable_at && <View style={styles.detailRow}><Ionicons name="close-circle" size={18} color="#666" /><Text style={styles.detailText}><Text style={styles.detailLabel}>Unavailable: </Text>{formatDate(materialDetail.unavailable_at)}</Text></View>}
        </View>
      </ScrollView>
      {renderFullScreenModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f9fa' },
  loadingText: { marginTop: 16, fontSize: 16, color: '#5f6368' },
  centeredContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { fontSize: 16, color: '#d93025', textAlign: 'center', marginBottom: 20 },
  retryButton: { backgroundColor: '#1967d2', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  scrollViewContent: { paddingBottom: 24 },
  headerSection: { backgroundColor: '#1967d2', padding: 20, paddingTop: 24, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  materialTitle: { fontSize: 24, fontWeight: '600', color: '#fff', marginBottom: 8 },
  materialDescription: { fontSize: 14, color: '#e8f0fe', lineHeight: 20, marginBottom: 16 },
  actionButtonsContainer: { flexDirection: 'row', gap: 8, marginTop: 8 },
  headerActionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingVertical: 10, borderRadius: 8, gap: 6, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' },
  headerActionButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  downloadedButton: { backgroundColor: '#137333', borderColor: '#137333' },
  contentSection: { backgroundColor: '#fff', margin: 16, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' },
  sectionHeader: { fontSize: 16, fontWeight: '500', color: '#202124', marginBottom: 12 },
  materialContent: { fontSize: 14, color: '#5f6368', lineHeight: 22 },
  linkClickableContainer: { backgroundColor: '#f8f9fa', borderRadius: 8, padding: 12 },
  linkContentWrapper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkUrlText: { flex: 1, fontSize: 14, color: '#1967d2', fontWeight: '500' },
  downloadPromptContainer: { margin: 16, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' },
  downloadPromptContent: { padding: 32, alignItems: 'center' },
  downloadPromptTitle: { fontSize: 20, fontWeight: '500', color: '#202124', marginTop: 16, marginBottom: 8 },
  downloadPromptText: { fontSize: 14, color: '#5f6368', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  progressContainer: { alignItems: 'center', gap: 12 },
  progressText: { fontSize: 16, fontWeight: '500', color: '#1967d2' },
  downloadPromptButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1967d2', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, gap: 8 },
  downloadPromptButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  inlineViewerContainer: { margin: 16, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' },
  viewerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: '#f8f9fa', borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  viewerTitle: { fontSize: 16, fontWeight: '500', color: '#202124' },
  viewerActions: { flexDirection: 'row', gap: 8 },
  actionButton: { padding: 6 },
  documentHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  imagePreview: { width: '100%', height: 300, backgroundColor: '#f8f9fa' },
  downloadedIndicator: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#e6f4ea', gap: 8 },
  downloadedText: { fontSize: 12, color: '#137333', flex: 1 },
  videoPlayer: { width: '100%', height: 250, backgroundColor: '#000' },
  audioPlayerContainer: { padding: 48, alignItems: 'center', backgroundColor: '#f8f9fa' },
  audioFileName: { fontSize: 16, color: '#202124', marginTop: 16, marginBottom: 24, textAlign: 'center' },
  playButton: { padding: 10 },
  genericFileContainer: { padding: 48, alignItems: 'center' },
  genericFileName: { fontSize: 16, color: '#202124', marginTop: 16, marginBottom: 24, textAlign: 'center' },
  openFileButton: { backgroundColor: '#1967d2', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  openFileButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  documentContainer: { padding: 24, alignItems: 'center' },
  documentIconContainer: { width: 96, height: 96, borderRadius: 48, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  documentTitle: { fontSize: 18, fontWeight: '500', color: '#202124', textAlign: 'center', marginBottom: 8 },
  documentSubtext: { fontSize: 14, color: '#5f6368', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  primaryDocumentButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 8, gap: 8 },
  primaryDocumentButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  codeScrollContainer: { maxHeight: 400, backgroundColor: '#f8f9fa' },
  codeText: { fontFamily: 'monospace', fontSize: 14, color: '#202124', padding: 16 },
  errorCodeContainer: { padding: 48, alignItems: 'center' },
  errorCodeText: { marginTop: 16, fontSize: 14, color: '#d93025', marginBottom: 24 },
  retryCodeButton: { backgroundColor: '#1967d2', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  retryCodeButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  detailsSection: { backgroundColor: '#fff', margin: 16, marginTop: 0, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' },
  detailRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
  detailText: { fontSize: 14, color: '#5f6368', flex: 1 },
  detailLabel: { fontWeight: '500', color: '#202124' },
  fullScreenContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'rgba(0, 0, 0, 0.8)' },
  fullScreenCloseButton: { padding: 8 },
  fullScreenTitle: { flex: 1, fontSize: 16, color: '#fff', marginHorizontal: 12, fontWeight: '500' },
  fullScreenShareButton: { padding: 8 },
  fullScreenContent: { flex: 1, justifyContent: 'center' },
  fullScreenImage: { width: screenWidth, height: screenHeight - 100 },
  fullScreenVideo: { flex: 1 },
  pdfViewerContainer: { height: 500, backgroundColor: '#f8f9fa' },
  pdfWebView: { flex: 1 },
  fullScreenCodeText: { fontFamily: 'monospace', fontSize: 14, color: '#d4d4d4', padding: 16 },
});