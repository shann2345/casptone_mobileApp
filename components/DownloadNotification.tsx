import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppContext } from '../context/AppContextNew';
import { downloadManager } from '../lib/downloadManager';

export const DownloadNotification: React.FC = () => {
  const { downloadProgress, cancelDownload } = useAppContext();
  const [slideAnim] = React.useState(new Animated.Value(-100));

  React.useEffect(() => {
    if (downloadProgress?.isDownloading) {
      // Slide down
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 8,
      }).start();
    } else if (downloadProgress && !downloadProgress.isDownloading && downloadProgress.percentage === 100) {
      // Show completion message for 3 seconds then slide up
      setTimeout(() => {
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }, 3000);
    }
  }, [downloadProgress?.isDownloading, downloadProgress?.percentage]);

  if (!downloadProgress) {
    return null;
  }

  const { isDownloading, currentFile, totalFiles, currentFileName, percentage, downloadedSize, totalSize, failedFiles } = downloadProgress;

  // Don't show if nothing to display
  if (!isDownloading && percentage === 0) {
    return null;
  }

  return (
    <Animated.View 
      style={[
        styles.container, 
        { transform: [{ translateY: slideAnim }] }
      ]}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {isDownloading ? (
              <Ionicons name="cloud-download" size={20} color="#1967d2" />
            ) : (
              <Ionicons 
                name={failedFiles.length > 0 ? "warning" : "checkmark-circle"} 
                size={20} 
                color={failedFiles.length > 0 ? "#f9ab00" : "#137333"} 
              />
            )}
            <Text style={styles.title}>
              {isDownloading 
                ? 'Downloading Materials...' 
                : failedFiles.length > 0 
                  ? 'Download Completed with Errors' 
                  : 'Download Complete!'}
            </Text>
          </View>
          
          {isDownloading && (
            <TouchableOpacity onPress={cancelDownload} style={styles.cancelButton}>
              <Ionicons name="close-circle" size={20} color="#5f6368" />
            </TouchableOpacity>
          )}
        </View>

        {isDownloading && (
          <>
            <Text style={styles.fileInfo} numberOfLines={1}>
              {currentFileName}
            </Text>
            <Text style={styles.progressText}>
              File {currentFile} of {totalFiles} • {downloadManager.formatFileSize(downloadedSize)} / {downloadManager.formatFileSize(totalSize)}
            </Text>
          </>
        )}

        {!isDownloading && failedFiles.length > 0 && (
          <Text style={styles.errorText}>
            {failedFiles.length} file(s) failed to download
          </Text>
        )}

        {!isDownloading && failedFiles.length === 0 && percentage === 100 && (
          <Text style={styles.successText}>
            All {totalFiles} files downloaded successfully!
          </Text>
        )}

        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBar, { width: `${percentage}%` }]} />
        </View>
        
        <Text style={styles.percentageText}>{percentage}%</Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 10,
  },
  content: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#202124',
    marginLeft: 8,
  },
  cancelButton: {
    padding: 4,
  },
  fileInfo: {
    fontSize: 13,
    color: '#5f6368',
    marginBottom: 4,
    fontWeight: '500',
  },
  progressText: {
    fontSize: 12,
    color: '#80868b',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#d93025',
    marginBottom: 8,
  },
  successText: {
    fontSize: 13,
    color: '#137333',
    marginBottom: 8,
  },
  progressBarContainer: {
    height: 6,
    backgroundColor: '#e8eaed',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#1967d2',
    borderRadius: 3,
  },
  percentageText: {
    fontSize: 12,
    color: '#5f6368',
    textAlign: 'right',
    fontWeight: '600',
  },
});
