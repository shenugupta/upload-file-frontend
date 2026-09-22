import { Image } from 'expo-image';
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
  TextInput,
  View,
} from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

type IdType = 'PAN' | 'AADHAR';

type SelectedImage = {
  uri: string;
  fileName: string;
  contentType: string;
  fileSize?: number;
};

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

type StatusMessage = {
  type: 'success' | 'error';
  text: string;
};

type UserAccount = {
  id: number;
  name: string;
  email: string;
};

function getImageFileName(asset: ImagePicker.ImagePickerAsset, prefix: string) {
  if (asset.fileName) {
    return asset.fileName;
  }

  const pathName = asset.uri.split('?')[0]?.split('/').pop();
  if (pathName?.includes('.')) {
    return decodeURIComponent(pathName);
  }

  const extension = asset.mimeType === 'image/png' ? 'png' : 'jpg';
  return `${prefix}-${Date.now()}.${extension}`;
}

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

function imageFromAsset(asset: ImagePicker.ImagePickerAsset, prefix: string): SelectedImage {
  return {
    uri: asset.uri,
    fileName: getImageFileName(asset, prefix),
    contentType: asset.mimeType ?? 'image/jpeg',
    fileSize: asset.fileSize,
  };
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

async function ensureUser(email: string): Promise<UserAccount> {
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedEmail) {
    throw new Error('Email is required');
  }

  const signInResponse = await fetch(`${API_URL}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: trimmedEmail }),
  });
  const signInResult = await signInResponse.json();

  if (signInResponse.ok && signInResult.success) {
    return signInResult.data as UserAccount;
  }

  const signUpResponse = await fetch(`${API_URL}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: trimmedEmail.split('@')[0] || 'App User',
      email: trimmedEmail,
    }),
  });
  const signUpResult = await signUpResponse.json();

  if (!signUpResponse.ok || !signUpResult.success) {
    throw new Error(signUpResult.message || 'Could not sign in or sign up');
  }

  return signUpResult.data as UserAccount;
}

async function requestCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Permission needed', 'Allow camera access to take a photo.');
    return false;
  }
  return true;
}

async function requestLibrary() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Permission needed', 'Allow photo library access to pick a file.');
    return false;
  }
  return true;
}

const libraryImageOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 1,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  shouldDownloadFromNetwork: true,
};

const fallbackLibraryImageOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  quality: 1,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  shouldDownloadFromNetwork: true,
};

async function pickImageFromLibrary() {
  if (!(await requestLibrary())) {
    return null;
  }

  try {
    const result = await ImagePicker.launchImageLibraryAsync(libraryImageOptions);
    if (result.canceled) {
      return null;
    }
    return result.assets[0] ?? null;
  } catch (error) {
    console.warn('Image picker failed, retrying with compatible JPEG export', error);
    try {
      const result = await ImagePicker.launchImageLibraryAsync(fallbackLibraryImageOptions);
      if (result.canceled) {
        return null;
      }
      return result.assets[0] ?? null;
    } catch (retryError) {
      console.error(retryError);
      Alert.alert(
        'Could not open that photo',
        'iOS could not read this file. Take a new photo of the ID, or pick a JPEG/PNG image.'
      );
      return null;
    }
  }
}

async function takePhoto(cameraType: ImagePicker.CameraType) {
  if (!(await requestCamera())) {
    return null;
  }

  try {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      cameraType,
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled) {
      return null;
    }

    return result.assets[0] ?? null;
  } catch (error) {
    console.error(error);
    Alert.alert('Camera error', 'Could not take the photo. Please try again.');
    return null;
  }
}

async function uploadFile({
  media,
  user,
  doctype,
  onProgress,
}: {
  media: SelectedImage | SelectedVideo;
  user: UserAccount;
  doctype: string;
  onProgress?: (percent: number) => void;
}) {
  const response = await fetch(`${API_URL}/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: media.fileName,
      contentType: media.contentType,
      userId: user.id,
      email: user.email,
      doctype,
    }),
  });
  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.message || `Failed to get upload URL for ${doctype}`);
  }

  const file = new File(media.uri);
  const uploadResult = await file.upload(result.data.url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: media.contentType,
    headers: { 'Content-Type': media.contentType },
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) {
        onProgress?.(Math.round((bytesSent / totalBytes) * 100));
      }
    },
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Upload failed for ${doctype} (${uploadResult.status})`);
  }
}

export default function HomeScreen() {
  const [email, setEmail] = useState('mock.user@example.com');
  const [idType, setIdType] = useState<IdType>('PAN');
  const [selfie, setSelfie] = useState<SelectedImage | null>(null);
  const [idDocument, setIdDocument] = useState<SelectedImage | null>(null);
  const [video, setVideo] = useState<SelectedVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
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
      setStatus({ type: 'error', text: `Failed to load videos: ${errorMessage}` });
    } finally {
      setVideosLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  const takeSelfie = async () => {
    const asset = await takePhoto(ImagePicker.CameraType.front);
    if (asset) {
      setSelfie(imageFromAsset(asset, 'selfie'));
      setStatus(null);
    }
  };

  const pickSelfie = async () => {
    const asset = await pickImageFromLibrary();
    if (asset) {
      setSelfie(imageFromAsset(asset, 'selfie'));
      setStatus(null);
    }
  };

  const takeIdPhoto = async (nextType: IdType = idType) => {
    setIdType(nextType);
    const asset = await takePhoto(ImagePicker.CameraType.back);
    if (asset) {
      setIdDocument(imageFromAsset(asset, nextType.toLowerCase()));
      setStatus(null);
    }
  };

  const pickIdPhoto = async (nextType: IdType = idType) => {
    setIdType(nextType);
    const asset = await pickImageFromLibrary();
    if (asset) {
      setIdDocument(imageFromAsset(asset, nextType.toLowerCase()));
      setStatus(null);
    }
  };

  const recordVideo = async () => {
    if (!(await requestCamera())) {
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
        videoMaxDuration: 15,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      setVideo({
        uri: asset.uri,
        fileName: getVideoFileName(asset),
        contentType: asset.mimeType ?? 'video/mp4',
        fileSize: asset.fileSize,
        duration: asset.duration ?? undefined,
      });
      setStatus(null);
    } catch (error) {
      console.error(error);
      Alert.alert('Camera error', 'Could not record the video. Please try again.');
    }
  };

  const uploadAndVerify = async () => {
    if (!selfie || !idDocument) {
      Alert.alert('Two documents required', 'Upload a selfie and a PAN or Aadhaar photo before verifying.');
      return;
    }

    try {
      setLoading(true);
      setStatus(null);
      setProgress(0);

      const user = await ensureUser(email);

      await uploadFile({
        media: idDocument,
        user,
        doctype: idType,
        onProgress: (percent) => setProgress(Math.round(percent * 0.4)),
      });

      await uploadFile({
        media: selfie,
        user,
        doctype: 'SELFIE',
        onProgress: (percent) => setProgress(40 + Math.round(percent * 0.4)),
      });

      if (video) {
        await uploadFile({
          media: video,
          user,
          doctype: 'VIDEO',
          onProgress: (percent) => setProgress(80 + Math.round(percent * 0.15)),
        });
      }

      setProgress(95);

      const verifyResponse = await fetch(`${API_URL}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          doctype: idType,
        }),
      });
      const verifyResult = await verifyResponse.json();

      if (!verifyResponse.ok) {
        throw new Error(verifyResult.message || 'Verification request failed');
      }

      setProgress(100);

      const verified = Boolean(verifyResult.data?.verified);
      const reason =
        verifyResult.data?.reason ||
        (verified ? 'Selfie matched the uploaded ID document.' : 'Verification did not succeed.');

      if (verified) {
        setStatus({ type: 'success', text: `Verified successfully. ${reason}` });
        Alert.alert('Verified', reason);
      } else {
        setStatus({ type: 'error', text: `Verification failed. ${reason}` });
        Alert.alert('Verification failed', reason);
      }

      await loadVideos();
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setStatus({ type: 'error', text: errorMessage });
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const openVideo = async (item: VideoListItem) => {
    try {
      setOpeningKey(item.key);

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
      setStatus({ type: 'error', text: `Failed to open video: ${errorMessage}` });
    } finally {
      setOpeningKey(null);
    }
  };

  const canVerify = Boolean(selfie && idDocument) && !loading;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>S3 Upload & Verify</Text>

      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        editable={!loading}
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1. Selfie</Text>
        <View style={styles.actions}>
          <Button title="Take Selfie" onPress={takeSelfie} disabled={loading} />
          <Button title="Pick Selfie" onPress={pickSelfie} disabled={loading} />
        </View>
        {selfie ? (
          <View style={styles.preview}>
            <Image source={{ uri: selfie.uri }} style={styles.selfie} contentFit="cover" />
            <Text style={styles.fileName}>{selfie.fileName}</Text>
            <Text style={styles.meta}>SELFIE · {formatBytes(selfie.fileSize)}</Text>
          </View>
        ) : (
          <Text style={styles.meta}>No selfie selected yet.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. PAN or Aadhaar</Text>
        <View style={styles.idTypeRow}>
          <View style={styles.idTypeButton}>
            <Button title={idType === 'PAN' ? 'PAN ✓' : 'PAN'} onPress={() => void pickIdPhoto('PAN')} disabled={loading} />
          </View>
          <View style={styles.idTypeButton}>
            <Button
              title={idType === 'AADHAR' ? 'Aadhaar ✓' : 'Aadhaar'}
              onPress={() => void pickIdPhoto('AADHAR')}
              disabled={loading}
            />
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            title={`Photo of ${idType === 'PAN' ? 'PAN' : 'Aadhaar'}`}
            onPress={() => void takeIdPhoto()}
            disabled={loading}
          />
          <Button title="Pick ID from Library" onPress={() => void pickIdPhoto()} disabled={loading} />
        </View>
        {idDocument ? (
          <View style={styles.preview}>
            <Image source={{ uri: idDocument.uri }} style={styles.idPhoto} contentFit="cover" />
            <Text style={styles.fileName}>{idDocument.fileName}</Text>
            <Text style={styles.meta}>
              {idType} · {formatBytes(idDocument.fileSize)}
            </Text>
          </View>
        ) : (
          <Text style={styles.meta}>No ID document selected yet.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Optional video</Text>
        <Button title="Record Video" onPress={recordVideo} disabled={loading} />
        {video ? (
          <Text style={styles.meta}>
            {video.fileName} · {formatBytes(video.fileSize)}
            {video.duration ? ` · ${Math.round(video.duration / 1000)}s` : ''}
          </Text>
        ) : (
          <Text style={styles.meta}>No video selected.</Text>
        )}
      </View>

      <View style={styles.uploadButton}>
        <Button
          title={loading ? 'Uploading & verifying...' : 'Upload both & Verify'}
          onPress={uploadAndVerify}
          disabled={!canVerify}
        />
      </View>

      {loading && <ActivityIndicator style={styles.loader} size="large" />}

      {progress !== null && <Text style={styles.progress}>{progress}%</Text>}

      {status && (
        <Text style={[styles.message, status.type === 'success' ? styles.success : styles.error]}>
          {status.text}
        </Text>
      )}

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Uploaded videos</Text>
        <Button title={videosLoading ? 'Loading...' : 'Refresh'} onPress={loadVideos} disabled={videosLoading} />
      </View>

      {videosLoading && videos.length === 0 && <ActivityIndicator style={styles.loader} />}

      {videos.length === 0 && !videosLoading && <Text style={styles.meta}>No videos yet.</Text>}

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
    marginBottom: 20,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    fontSize: 16,
  },
  section: {
    width: '100%',
    marginBottom: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f4f4f5',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  actions: {
    gap: 8,
  },
  idTypeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  idTypeButton: {
    flex: 1,
  },
  preview: {
    marginTop: 16,
    alignItems: 'center',
  },
  selfie: {
    width: 140,
    height: 140,
    borderRadius: 70,
    marginBottom: 12,
    backgroundColor: '#e4e4e7',
  },
  idPhoto: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#e4e4e7',
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
    marginTop: 4,
    width: '100%',
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
    fontWeight: '600',
  },
  success: {
    color: '#15803d',
  },
  error: {
    color: '#b91c1c',
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
