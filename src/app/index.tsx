import { File, UploadType } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

type SelectedVideo = {
  uri: string;
  fileName: string;
  contentType: string;
  fileSize?: number;
  duration?: number;
};

type VideoListItem = {
  key: string;
  size?: number;
  lastModified?: string;
  openUrl: string;
  getVideoUrl?: string;
};

type VideoDetails = {
  url: string;
  openUrl: string;
  key: string;
  bucket: string;
  contentType?: string;
  contentLength?: number;
  expires?: number;
};

function getVideoFileName(asset: ImagePicker.ImagePickerAsset) {
  if (asset.fileName) {
    return asset.fileName;
  }

  const pathName = asset.uri.split('?')[0]?.split('/').pop();
  if (pathName?.includes('.')) {
    return decodeURIComponent(pathName);
  }

  const extension = asset.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  return `video-${Date.now()}.${extension}`;
}

function fileNameFromKey(key: string) {
  return decodeURIComponent(key.split('/').pop() ?? key);
}

function formatBytes(bytes?: number) {
  if (!bytes) {
    return 'Unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export default function HomeScreen() {
  const [loading, setLoading] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [videos, setVideos] = useState<VideoListItem[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);

  const loadVideos = useCallback(async () => {
    try {
      setVideosLoading(true);
      const response = await fetch(`${API_URL}/videos`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load videos');
      }

      setVideos(Array.isArray(result.data) ? result.data : []);
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessage(`Failed to load videos: ${errorMessage}`);
    } finally {
      setVideosLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  const pickVideo = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to pick a video.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
      shouldDownloadFromNetwork: true,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    setSelectedVideo({
      uri: asset.uri,
      fileName: getVideoFileName(asset),
      contentType: asset.mimeType ?? 'video/mp4',
      fileSize: asset.fileSize,
      duration: asset.duration ?? undefined,
    });
    setMessage('');
    setProgress(null);
  };

  const uploadVideo = async () => {
    if (!selectedVideo) {
      Alert.alert('No video selected', 'Pick a video first.');
      return;
    }

    try {
      setLoading(true);
      setMessage('');
      setProgress(0);

      const response = await fetch(`${API_URL}/upload-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: selectedVideo.fileName,
          contentType: selectedVideo.contentType,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to generate upload URL');
      }

      const { url } = result.data;
      const file = new File(selectedVideo.uri);
      const uploadResult = await file.upload(url, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: selectedVideo.contentType,
        headers: {
          'Content-Type': selectedVideo.contentType,
        },
        onProgress: ({ bytesSent, totalBytes }) => {
          if (totalBytes > 0) {
            setProgress(Math.round((bytesSent / totalBytes) * 100));
          }
        },
      });

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`File upload failed (${uploadResult.status})`);
      }

      setProgress(100);
      setMessage('Upload Successful!');
      await loadVideos();
      Alert.alert('Success', `${selectedVideo.fileName} uploaded successfully`);
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessage(`Upload failed: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const openVideo = async (item: VideoListItem) => {
    try {
      setOpeningKey(item.key);
      setMessage('');

      const response = await fetch(`${API_URL}/get-video?key=${encodeURIComponent(item.key)}`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || `Request failed (${response.status})`);
      }

      const details = result.data as VideoDetails;
      const urlToOpen = details.openUrl || details.url;

      if (!urlToOpen) {
        throw new Error('No open URL returned for this video');
      }

      await openBrowserAsync(urlToOpen, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessage(`Failed to open video: ${errorMessage}`);
    } finally {
      setOpeningKey(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>S3 Video Upload</Text>

      <Button title="Pick Video" onPress={pickVideo} disabled={loading} />

      {selectedVideo && (
        <View style={styles.videoInfo}>
          <Text style={styles.fileName}>{selectedVideo.fileName}</Text>
          <Text style={styles.meta}>
            {formatBytes(selectedVideo.fileSize)}
            {selectedVideo.duration ? ` · ${Math.round(selectedVideo.duration / 1000)}s` : ''}
          </Text>
        </View>
      )}

      <View style={styles.uploadButton}>
        <Button
          title={loading ? 'Uploading...' : 'Upload Video'}
          onPress={uploadVideo}
          disabled={loading || !selectedVideo}
        />
      </View>

      {loading && <ActivityIndicator style={styles.loader} size="large" />}

      {progress !== null && <Text style={styles.progress}>{progress}%</Text>}

      {message !== '' && <Text style={styles.message}>{message}</Text>}

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Uploaded videos</Text>
        <Button title={videosLoading ? 'Loading...' : 'Refresh'} onPress={loadVideos} disabled={videosLoading} />
      </View>

      {videosLoading && videos.length === 0 && <ActivityIndicator style={styles.loader} />}

      {videos.length === 0 && !videosLoading && (
        <Text style={styles.meta}>No videos yet. Upload one to see it here.</Text>
      )}

      {videos.map((item) => (
        <View key={item.key} style={styles.videoCard}>
          <Text style={styles.fileName}>{fileNameFromKey(item.key)}</Text>
          <Text style={styles.meta}>{formatBytes(item.size)}</Text>
          <View style={styles.openButton}>
            <Button
              title={openingKey === item.key ? 'Opening...' : 'Open URL'}
              onPress={() => void openVideo(item)}
              disabled={openingKey !== null}
            />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
  },
  videoInfo: {
    marginTop: 20,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  meta: {
    marginTop: 6,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  uploadButton: {
    marginTop: 20,
  },
  loader: {
    marginTop: 20,
  },
  progress: {
    marginTop: 12,
    fontSize: 16,
  },
  message: {
    marginTop: 20,
    fontSize: 18,
    textAlign: 'center',
  },
  listHeader: {
    width: '100%',
    marginTop: 36,
    marginBottom: 12,
    alignItems: 'center',
    gap: 8,
  },
  listTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  videoCard: {
    width: '100%',
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f4f4f5',
    alignItems: 'center',
  },
  openButton: {
    marginTop: 12,
  },
});
