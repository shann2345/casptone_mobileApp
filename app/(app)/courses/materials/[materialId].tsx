import { Ionicons } from '@expo/vector-icons';
import { Audio, ResizeMode, Video } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
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

type FileType = 'image' | 'pdf' | 'document' | 'video' | 'audio' | 'code' | 'other';


const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function MaterialDetailsScreen() {
  const { id: courseId, materialId } = useLocalSearchParams();
  const { isConnected } = useNetworkStatus();
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

  // FIXED: Enhanced file checking with better caching logic
  const checkIfFileDownloaded = async (material: MaterialDetail) => {
    if (!material.file_path || !material.id) return;
    
    const fileExtension = material.file_path.split('.').pop();
    const sanitizedTitle = material.title.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${sanitizedTitle}_${material.id}${fileExtension ? `.${fileExtension}` : ''}`;
    const localUri = FileSystem.documentDirectory + fileName;
    
    try {
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      console.log('🔍 Checking file:', {
        fileName,
        localUri,
        exists: fileInfo.exists,
        size: fileInfo.exists ? fileInfo.size : 'N/A'
      });
      
      if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
        setDownloadedFileUri(localUri);
        console.log('✅ File already downloaded and cached:', localUri);
        return true;
      } else if (fileInfo.exists && (!fileInfo.size || fileInfo.size === 0)) {
        // File exists but is empty (corrupted), delete it
        console.log('🗑️ Removing corrupted file:', localUri);
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
    
    // Image files
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension || '')) {
      return 'image';
    }
    // PDF files
    if (['pdf'].includes(extension || '')) {
      return 'pdf';
    }
    // Document files
    if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(extension || '')) {
      return 'document';
    }
    // Video files
    if (['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v'].includes(extension || '')) {
      return 'video';
    }
    // Audio files
    if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(extension || '')) {
      return 'audio';
    }
    // NEW: Programming and code files
    if ([
      'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'php', 
      'rb', 'go', 'rs', 'swift', 'kt', 'dart', 'scala', 'r', 'matlab', 'm',
      'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'json', 'yaml', 'yml',
      'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'dockerfile', 'makefile',
      'gradle', 'cmake', 'config', 'conf', 'ini', 'env', 'gitignore', 'md',
      'vue', 'svelte', 'elm', 'clj', 'hs', 'ml', 'fs', 'vb', 'pl', 'lua'
    ].includes(extension || '')) {
      return 'code';
    }
    
    return 'other';
  };

  const getFileIcon = (fileType: FileType) => {
    switch (fileType) {
      case 'image': return 'image';
      case 'pdf': return 'document-text';
      case 'document': return 'document';
      case 'video': return 'videocam';
      case 'audio': return 'musical-notes';
      case 'code': return 'code-slash'; // NEW: Code icon
      default: return 'attach';
    }
  };

  const getAuthenticatedFileUrl = async () => {
    if (!materialDetail?.file_path || !materialDetail?.id) {
      return '';
    }
    
    try {
      const response = await api.get(`/materials/${materialDetail.id}/view-link`);
      if (response.data && response.data.url) {
        return response.data.url;
      } else {
        throw new Error('No signed URL received');
      }
    } catch (error) {
      console.error('❌ Error getting signed URL:', error);
      return `${api.defaults.baseURL}/materials/${materialDetail.id}/view`;
    }
  };

  const loadCodeContent = async (fileUri: string) => {
    if (!fileUri) return;
    
    setIsLoadingCode(true);
    try {
      // Read the file content as text
      const content = await FileSystem.readAsStringAsync(fileUri);
      setCodeContent(content);
      console.log('✅ Code content loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load code content:', error);
      Alert.alert('Error', 'Failed to load code content for viewing.');
    } finally {
      setIsLoadingCode(false);
    }
  };


  // FIXED: Enhanced download function with proper progress tracking
const handleDownload = async () => {
  if (!materialDetail?.file_path || !materialDetail?.id) {
    Alert.alert('No File', 'This material does not have an attached file.');
    return;
  }

  if (!isConnected) {
    Alert.alert('Offline Mode', 'File downloading requires an internet connection.');
    return;
  }

  // Check if already downloaded
  if (downloadedFileUri) {
    console.log('📁 File already downloaded, skipping download');
    return;
  }

  setIsDownloading(true);
  setDownloadProgress(0);

  try {
    // Request permissions for file system access
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

    console.log('📥 Starting download:', {
      downloadUrl,
      fileName,
      localUri
    });

    // Download with enhanced progress tracking
    const downloadResumable = FileSystem.createDownloadResumable(
      downloadUrl,
      localUri,
      {
        headers: {
          'Authorization': getAuthorizationHeader(),
        }
      },
      (downloadProgress) => {
        // FIXED: Proper progress calculation with validation
        const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
        
        console.log('📊 Raw download data:', {
          totalBytesWritten,
          totalBytesExpectedToWrite,
          type: typeof totalBytesExpectedToWrite
        });

        // Validate the progress data
        if (totalBytesExpectedToWrite && totalBytesExpectedToWrite > 0 && 
            totalBytesWritten >= 0 && totalBytesWritten <= totalBytesExpectedToWrite) {
          
          const progress = totalBytesWritten / totalBytesExpectedToWrite;
          const progressPercentage = Math.round(progress * 100);
          
          // Ensure progress is within valid range
          const validProgress = Math.max(0, Math.min(100, progressPercentage));
          
          setDownloadProgress(validProgress);
          console.log(`📊 Download progress: ${validProgress}% (${totalBytesWritten}/${totalBytesExpectedToWrite} bytes)`);
          
        } else {
          // Fallback for invalid progress data
          console.log('⚠️ Invalid progress data, using fallback');
          if (totalBytesWritten > 0) {
            // Show indeterminate progress if we're downloading but don't know total size
            setDownloadProgress(50); // Show halfway progress as fallback
          }
        }
      }
    );

    const result = await downloadResumable.downloadAsync();
    
    if (result && result.uri) {
      // Verify the downloaded file
      const fileInfo = await FileSystem.getInfoAsync(result.uri);
      if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
        setDownloadedFileUri(result.uri);
        console.log('✅ Download completed successfully:', {
          uri: result.uri,
          size: fileInfo.size
        });
        
        Alert.alert(
          'Download Complete!', 
          'File downloaded successfully and is now available for offline viewing.',
          [{ text: 'OK' }]
        );
      } else {
        throw new Error('Downloaded file is corrupted or empty');
      }
    } else {
      throw new Error('Download failed - no result returned');
    }

  } catch (err: any) {
    console.error("Download failed:", err);
    
    // Clean up any partial download
    const fileExtension = materialDetail.file_path.split('.').pop();
    const sanitizedTitle = materialDetail.title.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${sanitizedTitle}_${materialDetail.id}${fileExtension ? `.${fileExtension}` : ''}`;
    const localUri = FileSystem.documentDirectory + fileName;
    
    try {
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(localUri);
        console.log('🗑️ Cleaned up partial download');
      }
    } catch (cleanupError) {
      console.error('Error cleaning up partial download:', cleanupError);
    }
    
    Alert.alert('Download Failed', 'Could not download the file. Please try again.');
  } finally {
    setIsDownloading(false);
    setDownloadProgress(0);
  }
};

  // FIXED: Auto-download for certain file types
  const handleAutoDownload = async () => {
    if (!materialDetail?.file_path || downloadedFileUri || isDownloading) {
      return;
    }

    const fileType = getFileType(materialDetail.file_path);
    
    // Auto-download for viewable types including code files
    if (['image', 'video', 'audio', 'code'].includes(fileType) && isConnected) {
      console.log(`🔄 Auto-downloading ${fileType} for inline viewing...`);
      await handleDownload();
    }
  };


  // Update your useEffect to load code content when file is downloaded
  useEffect(() => {
    if (downloadedFileUri && materialDetail) {
      const fileType = getFileType(materialDetail.file_path || '');
      if (fileType === 'code') {
        loadCodeContent(downloadedFileUri);
      }
    }
  }, [downloadedFileUri, materialDetail]);

  const handleViewOnline = async () => {
    if (!isConnected) {
      Alert.alert('Offline Mode', 'Online viewing requires an internet connection.');
      return;
    }

    const fileUrl = await getAuthenticatedFileUrl();
    if (fileUrl) {
      WebBrowser.openBrowserAsync(fileUrl);
    } else {
      Alert.alert('Error', 'Unable to open file. Please try again.');
    }
  };

  const handleShare = async () => {
    if (!downloadedFileUri) {
      Alert.alert('No File', 'Please download the file first to open it.');
      return;
    }

    try {
      if (await Sharing.isAvailableAsync()) {
        const fileType = getFileType(materialDetail?.file_path || '');
        
        // Show a helpful message before sharing
        if (fileType === 'pdf' || fileType === 'document') {
          Alert.alert(
            'Opening File',
            `This will open your ${fileType} with available apps on your device. Choose your preferred app from the list.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { 
                text: 'Open', 
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
          await Sharing.shareAsync(downloadedFileUri);
        }
      } else {
        Alert.alert('Sharing not available', 'File sharing is not available on this device.');
      }
    } catch (error) {
      console.error('Share failed:', error);
      Alert.alert('Error', 'Could not open the file. Please try again.');
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
  
  // Show download prompt if file not downloaded yet
  if (!downloadedFileUri) {
    return (
      <View style={styles.downloadPromptContainer}>
        <LinearGradient
          colors={['#4285f4', '#34a853']}
          style={styles.downloadPromptGradient}
        >
          <Ionicons name={getFileIcon(fileType)} size={48} color="#fff" />
          <Text style={styles.downloadPromptTitle}>
            {isDownloading ? 'Downloading...' : 'Ready to View'}
          </Text>
          <Text style={styles.downloadPromptText}>
            {isDownloading 
              ? `Downloading ${fileType} file for offline viewing...`
              : fileType === 'code'
                ? `Download this code file to view it with syntax highlighting`
                : fileType === 'pdf' || fileType === 'document' 
                  ? `Download this ${fileType} file and open with your preferred app`
                  : `Download this ${fileType} file to view it in the app`
            }
          </Text>
          
          {isDownloading ? (
            <View style={styles.progressContainer}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={styles.progressText}>{downloadProgress}%</Text>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.downloadPromptButton}
              onPress={handleDownload}
              disabled={isDownloading}
            >
              <Ionicons name="download" size={20} color="#4285f4" />
              <Text style={styles.downloadPromptButtonText}>
                {fileType === 'code' 
                  ? 'Download & View Code'
                  : fileType === 'pdf' || fileType === 'document' 
                    ? 'Download & Open'
                    : 'Download & View'
                }
              </Text>
            </TouchableOpacity>
          )}
        </LinearGradient>
      </View>
    );
  }

  // Render appropriate viewer based on file type
  switch (fileType) {
    case 'image':
      return renderImageViewer();
    case 'video':
      return renderVideoViewer();
    case 'audio':
      return renderAudioViewer();
    case 'code':
      return renderCodeViewer(); // NEW: Code viewer
    case 'pdf':
    case 'document':
      return renderDocumentViewer();
    default:
      return renderGenericFileViewer();
  }
};

  const renderDocumentViewer = () => {
    const fileType = getFileType(materialDetail?.file_path || '');
    
    return (
      <View style={styles.inlineViewerContainer}>
        <View style={styles.viewerHeader}>
          <Text style={styles.viewerTitle}>
            {fileType === 'pdf' ? 'PDF Document' : 'Document'}
          </Text>
          <View style={styles.viewerActions}>
            <TouchableOpacity style={styles.actionButton} onPress={handleViewOnline}>
              <Ionicons name="open" size={20} color="#4285f4" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
              <Ionicons name="share" size={20} color="#4285f4" />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.documentContainer}>
          <Ionicons name="document-text" size={64} color="#4285f4" />
          <Text style={styles.documentTitle}>{materialDetail?.title}</Text>
          <Text style={styles.documentSubtext}>
            {fileType === 'pdf' 
              ? 'File downloaded and ready to view with PDF apps'
              : 'File downloaded and ready to view with document apps'
            }
          </Text>
          
          {/* Action buttons */}
          <View style={styles.documentActions}>
            <TouchableOpacity style={styles.primaryDocumentButton} onPress={handleShare}>
              <Ionicons name="open-outline" size={20} color="#fff" />
              <Text style={styles.primaryDocumentButtonText}>Open with App</Text>
            </TouchableOpacity>
            
            {isConnected && (
              <TouchableOpacity style={styles.secondaryDocumentButton} onPress={handleViewOnline}>
                <Ionicons name="globe-outline" size={20} color="#4285f4" />
                <Text style={styles.secondaryDocumentButtonText}>View in Browser</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {/* Helpful tips */}
          <View style={styles.tipContainer}>
            <Ionicons name="information-circle-outline" size={16} color="#5f6368" />
            <Text style={styles.tipText}>
              ✅ Downloaded • Recommended apps: {fileType === 'pdf' 
                ? 'Adobe Reader, Google Drive, Microsoft Edge'
                : 'Google Docs, Microsoft Word, WPS Office'
              }
            </Text>
          </View>
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
          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Ionicons name="share" size={20} color="#4285f4" />
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity onPress={() => setIsFullScreen(true)}>
        <Image 
          source={{ uri: downloadedFileUri! }}
          style={styles.imagePreview}
          resizeMode="contain"
        />
      </TouchableOpacity>
      <View style={styles.downloadedIndicator}>
        <Ionicons name="checkmark-circle" size={16} color="#34a853" />
        <Text style={styles.downloadedText}>Downloaded and cached for offline viewing</Text>
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
          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Ionicons name="share" size={20} color="#4285f4" />
          </TouchableOpacity>
        </View>
      </View>
      <Video
        ref={videoRef}
        style={styles.videoPlayer}
        source={{ uri: downloadedFileUri! }}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        isLooping={false}
        onPlaybackStatusUpdate={setVideoStatus}
      />
      <View style={styles.downloadedIndicator}>
        <Ionicons name="checkmark-circle" size={16} color="#34a853" />
        <Text style={styles.downloadedText}>Downloaded and cached for offline playback</Text>
      </View>
    </View>
  );

  const renderAudioViewer = () => {
    const playAudio = async () => {
      try {
        if (sound) {
          await sound.unloadAsync();
        }
        
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: downloadedFileUri! },
          { shouldPlay: true }
        );
        
        setSound(newSound);
        newSound.setOnPlaybackStatusUpdate(setAudioStatus);
      } catch (error) {
        console.error('Error playing audio:', error);
        Alert.alert('Error', 'Could not play audio file.');
      }
    };

    return (
      <View style={styles.inlineViewerContainer}>
        <View style={styles.viewerHeader}>
          <Text style={styles.viewerTitle}>Audio Player</Text>
          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Ionicons name="share" size={20} color="#4285f4" />
          </TouchableOpacity>
        </View>
        <View style={styles.audioPlayerContainer}>
          <Ionicons name="musical-notes" size={64} color="#4285f4" />
          <Text style={styles.audioFileName}>
            {materialDetail?.title}
          </Text>
          <TouchableOpacity style={styles.playButton} onPress={playAudio}>
            <Ionicons name="play-circle" size={48} color="#4285f4" />
          </TouchableOpacity>
        </View>
        <View style={styles.downloadedIndicator}>
          <Ionicons name="checkmark-circle" size={16} color="#34a853" />
          <Text style={styles.downloadedText}>Downloaded and cached for offline playback</Text>
        </View>
      </View>
    );
  };

  const renderGenericFileViewer = () => (
    <View style={styles.inlineViewerContainer}>
      <View style={styles.viewerHeader}>
        <Text style={styles.viewerTitle}>File Downloaded</Text>
        <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
          <Ionicons name="share" size={20} color="#4285f4" />
        </TouchableOpacity>
      </View>
      <View style={styles.genericFileContainer}>
        <Ionicons name={getFileIcon(getFileType(materialDetail?.file_path || ''))} size={64} color="#4285f4" />
        <Text style={styles.genericFileName}>{materialDetail?.title}</Text>
        <TouchableOpacity style={styles.openFileButton} onPress={handleShare}>
          <Text style={styles.openFileButtonText}>Open with App</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.downloadedIndicator}>
        <Ionicons name="checkmark-circle" size={16} color="#34a853" />
        <Text style={styles.downloadedText}>Downloaded and ready to open</Text>
      </View>
    </View>
  );

  const renderCodeViewer = () => {
    const fileExtension = materialDetail?.file_path?.split('.').pop()?.toLowerCase() || '';
    
    // Get language name for display
    const getLanguageName = (ext: string) => {
      const languageMap: { [key: string]: string } = {
        'js': 'JavaScript', 'jsx': 'React JSX', 'ts': 'TypeScript', 'tsx': 'React TSX',
        'py': 'Python', 'java': 'Java', 'cpp': 'C++', 'c': 'C', 'h': 'C Header',
        'cs': 'C#', 'php': 'PHP', 'rb': 'Ruby', 'go': 'Go', 'rs': 'Rust',
        'swift': 'Swift', 'kt': 'Kotlin', 'dart': 'Dart', 'scala': 'Scala',
        'html': 'HTML', 'css': 'CSS', 'scss': 'SCSS', 'json': 'JSON',
        'xml': 'XML', 'yaml': 'YAML', 'yml': 'YAML', 'sql': 'SQL',
        'sh': 'Shell Script', 'bash': 'Bash', 'md': 'Markdown',
        'dockerfile': 'Docker', 'makefile': 'Makefile', 'gradle': 'Gradle'
      };
      return languageMap[ext] || ext.toUpperCase();
    };

    return (
      <View style={styles.inlineViewerContainer}>
        <View style={styles.viewerHeader}>
          <View style={styles.codeHeaderInfo}>
            <Ionicons name="code-slash" size={20} color="#4285f4" />
            <Text style={styles.viewerTitle}>
              {getLanguageName(fileExtension)} Code
            </Text>
          </View>
          <View style={styles.viewerActions}>
            <TouchableOpacity style={styles.actionButton} onPress={() => setIsFullScreen(true)}>
              <Ionicons name="expand" size={20} color="#4285f4" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
              <Ionicons name="share" size={20} color="#4285f4" />
            </TouchableOpacity>
          </View>
        </View>
        
        {isLoadingCode ? (
          <View style={styles.loadingCodeContainer}>
            <ActivityIndicator color="#4285f4" size="large" />
            <Text style={styles.loadingCodeText}>Loading code...</Text>
          </View>
        ) : codeContent ? (
          <ScrollView 
            style={styles.codeScrollContainer}
            horizontal={true}
            showsHorizontalScrollIndicator={true}
          >
            <ScrollView showsVerticalScrollIndicator={true}>
              <View style={styles.codeContainer}>
                <Text style={styles.codeText} selectable={true}>
                  {codeContent}
                </Text>
              </View>
            </ScrollView>
          </ScrollView>
        ) : (
          <View style={styles.errorCodeContainer}>
            <Ionicons name="warning" size={48} color="#ea4335" />
            <Text style={styles.errorCodeText}>Failed to load code content</Text>
            <TouchableOpacity 
              style={styles.retryCodeButton}
              onPress={() => downloadedFileUri && loadCodeContent(downloadedFileUri)}
            >
              <Text style={styles.retryCodeButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        
        <View style={styles.downloadedIndicator}>
          <Ionicons name="checkmark-circle" size={16} color="#34a853" />
          <Text style={styles.downloadedText}>
            Downloaded and cached for offline viewing • {getLanguageName(fileExtension)}
          </Text>
        </View>
      </View>
    );
  };

  const renderFullScreenModal = () => {
    if (!isFullScreen || !downloadedFileUri || !materialDetail) return null;
    
    const fileType = getFileType(materialDetail.file_path || '');
    
    return (
      <Modal visible={isFullScreen} animationType="slide" presentationStyle="fullScreen">
        <SafeAreaView style={styles.fullScreenContainer}>
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity 
              style={styles.fullScreenCloseButton}
              onPress={() => setIsFullScreen(false)}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.fullScreenTitle} numberOfLines={1}>
              {materialDetail.title}
            </Text>
            <TouchableOpacity style={styles.fullScreenShareButton} onPress={handleShare}>
              <Ionicons name="share" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.fullScreenContent}>
            {fileType === 'image' && (
              <ScrollView 
                maximumZoomScale={3}
                minimumZoomScale={1}
                contentContainerStyle={styles.fullScreenImageContainer}
              >
                <Image 
                  source={{ uri: downloadedFileUri }}
                  style={styles.fullScreenImage}
                  resizeMode="contain"
                />
              </ScrollView>
            )}
            
            {fileType === 'video' && (
              <Video
                style={styles.fullScreenVideo}
                source={{ uri: downloadedFileUri }}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
              />
            )}
          </View>
        </SafeAreaView>
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
        <ActivityIndicator size="large" color="#4285f4" />
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

        {/* Header Section */}
        <LinearGradient
          colors={['#4285f4', '#34a853']}
          style={styles.headerSection}
        >
          <Text style={styles.materialTitle}>{materialDetail.title}</Text>
          {materialDetail.description && (
            <Text style={styles.materialDescription}>{materialDetail.description}</Text>
          )}
          
          {/* Action Buttons */}
          <View style={styles.actionButtonsContainer}>
            {!downloadedFileUri && !isDownloading && (
              <TouchableOpacity 
                style={styles.headerActionButton}
                onPress={handleDownload}
                disabled={!isConnected}
              >
                <Ionicons name="download" size={20} color="#fff" />
                <Text style={styles.headerActionButtonText}>Download</Text>
              </TouchableOpacity>
            )}
            
            {downloadedFileUri && (
              <TouchableOpacity 
                style={[styles.headerActionButton, styles.downloadedButton]}
                onPress={handleShare}
              >
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.headerActionButtonText}>Downloaded</Text>
              </TouchableOpacity>
            )}
            
            {isConnected && (
              <TouchableOpacity 
                style={styles.headerActionButton}
                onPress={handleViewOnline}
              >
                <Ionicons name="open" size={20} color="#fff" />
                <Text style={styles.headerActionButtonText}>View Online</Text>
              </TouchableOpacity>
            )}
          </View>
        </LinearGradient>

        {/* Content Section */}
        {materialDetail.content && (
          <View style={styles.contentSection}>
            <Text style={styles.sectionHeader}>Content</Text>
            <Text style={styles.materialContent}>{materialDetail.content}</Text>
          </View>
        )}

        {/* File Viewer */}
        {materialDetail.file_path && renderInlineViewer()}

        {/* Details Section */}
        <View style={styles.detailsSection}>
          <Text style={styles.sectionHeader}>Details</Text>
          <View style={styles.detailRow}>
            <Ionicons name="calendar" size={18} color="#666" />
            <Text style={styles.detailText}>
              <Text style={styles.detailLabel}>Created: </Text>
              {formatDate(materialDetail.created_at)}
            </Text>
          </View>
          {materialDetail.available_at && (
            <View style={styles.detailRow}>
              <Ionicons name="time" size={18} color="#666" />
              <Text style={styles.detailText}>
                <Text style={styles.detailLabel}>Available: </Text>
                {formatDate(materialDetail.available_at)}
              </Text>
            </View>
          )}
          {materialDetail.unavailable_at && (
            <View style={styles.detailRow}>
              <Ionicons name="close-circle" size={18} color="#666" />
              <Text style={styles.detailText}>
                <Text style={styles.detailLabel}>Unavailable: </Text>
                {formatDate(materialDetail.unavailable_at)}
              </Text>
            </View>
          )}
        </View>

      </ScrollView>

      {renderFullScreenModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
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
    color: '#5f6368',
  },
  errorText: {
    fontSize: 16,
    color: '#d93025',
    textAlign: 'center',
    marginBottom: 15,
  },
  retryButton: {
    backgroundColor: '#4285f4',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollViewContent: {
    paddingBottom: 30,
  },
  
  // Header Section
  headerSection: {
    padding: 24,
    paddingTop: 40,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  materialTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  materialDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  headerActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 6,
  },
  downloadedButton: {
    backgroundColor: 'rgba(52, 168, 83, 0.3)', // Green tint for downloaded
  },
  headerActionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Content Sections
  contentSection: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  detailsSection: {
    backgroundColor: '#fff',
    margin: 16,
    marginTop: 0,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#202124',
    marginBottom: 12,
  },
  materialContent: {
    fontSize: 15,
    color: '#5f6368',
    lineHeight: 22,
  },

  // Download Prompt
  downloadPromptContainer: {
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  downloadPromptGradient: {
    padding: 32,
    alignItems: 'center',
  },
  downloadPromptTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
    marginBottom: 8,
  },
  downloadPromptText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  downloadPromptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    gap: 8,
  },
  downloadPromptButtonText: {
    color: '#4285f4',
    fontSize: 16,
    fontWeight: '600',
  },
  
  // Progress indicators
  progressContainer: {
    alignItems: 'center',
    gap: 12,
  },
  progressText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },

  // Downloaded indicator
  downloadedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#e8f5e8',
    gap: 6,
  },
  downloadedText: {
    fontSize: 12,
    color: '#34a853',
    fontWeight: '500',
  },

  // Inline Viewers
  inlineViewerContainer: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  documentContainer: {
    padding: 32,
    alignItems: 'center',
  },
  documentTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#202124',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  documentSubtext: {
    fontSize: 14,
    color: '#5f6368',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  documentActions: {
    gap: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  codeHeaderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingCodeContainer: {
    padding: 32,
    alignItems: 'center',
    gap: 12,
  },
  loadingCodeText: {
    fontSize: 14,
    color: '#5f6368',
  },
  codeScrollContainer: {
    maxHeight: 400,
    backgroundColor: '#1e1e1e', // Dark background like VS Code
  },
  codeContainer: {
    padding: 16,
    backgroundColor: '#1e1e1e',
    minWidth: '100%',
  },
  codeText: {
    fontFamily: 'Courier New', // Monospace font
    fontSize: 12,
    lineHeight: 18,
    color: '#d4d4d4', // Light text color
    backgroundColor: 'transparent',
  },
  errorCodeContainer: {
    padding: 32,
    alignItems: 'center',
    gap: 12,
  },
  errorCodeText: {
    fontSize: 14,
    color: '#ea4335',
    textAlign: 'center',
  },
  retryCodeButton: {
    backgroundColor: '#4285f4',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
  },
  retryCodeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  primaryDocumentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4285f4',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    gap: 8,
  },
  primaryDocumentButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryDocumentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#4285f4',
    gap: 6,
  },
  secondaryDocumentButtonText: {
    color: '#4285f4',
    fontSize: 14,
    fontWeight: '500',
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    gap: 8,
    maxWidth: '100%',
  },
  tipText: {
    fontSize: 12,
    color: '#5f6368',
    flex: 1,
    lineHeight: 16,
  },
  viewerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e8eaed',
  },
  viewerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
  },
  viewerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f1f3f4',
  },

  // Image Viewer
  imagePreview: {
    width: '100%',
    height: 250,
    backgroundColor: '#f8f9fa',
  },

  // Video Viewer
  videoPlayer: {
    width: '100%',
    height: 250,
  },

  // Audio Viewer
  audioPlayerContainer: {
    padding: 32,
    alignItems: 'center',
  },
  audioFileName: {
    fontSize: 16,
    color: '#202124',
    marginVertical: 16,
    textAlign: 'center',
  },
  playButton: {
    marginTop: 8,
  },

  // Generic File Viewer
  genericFileContainer: {
    padding: 32,
    alignItems: 'center',
  },
  genericFileName: {
    fontSize: 16,
    color: '#202124',
    marginVertical: 16,
    textAlign: 'center',
  },
  openFileButton: {
    backgroundColor: '#4285f4',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  openFileButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Full Screen Modal
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fullScreenCloseButton: {
    padding: 8,
  },
  fullScreenTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 12,
  },
  fullScreenShareButton: {
    padding: 8,
  },
  fullScreenContent: {
    flex: 1,
  },
  fullScreenImageContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: screenWidth,
    height: screenHeight - 100,
  },
  fullScreenVideo: {
    width: '100%',
    height: '100%',
  },

  // Details
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#5f6368',
    flex: 1,
  },
  detailLabel: {
    fontWeight: '600',
    color: '#202124',
  },
});