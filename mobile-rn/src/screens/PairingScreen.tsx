import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useSessions } from '../state/SessionsContext';
import { appColors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Pairing'>;

export function PairingScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastScan, setLastScan] = useState('');
  const [busy, setBusy] = useState(false);
  const scanLockedRef = useRef(false);
  const { pairByScan } = useSessions();

  const permissionReady = permission?.granted === true;
  const permissionDenied = permission?.canAskAgain === false && permission?.granted === false;

  const helperText = useMemo(() => {
    if (scannerOpen && permissionReady) {
      return '把宿主机展示的二维码放进取景框里，扫到后会直接创建会话并进入聊天页。';
    }
    if (permissionDenied) {
      return '相机权限被拒绝了，需要到系统设置里重新允许相机访问。';
    }
    return '点击打开扫码，扫描宿主机二维码后会直接生成对应会话。';
  }, [permissionDenied, permissionReady, scannerOpen]);

  async function handleOpenScanner() {
    scanLockedRef.current = false;

    if (!permissionReady) {
      const next = await requestPermission();
      if (!next.granted) {
        Alert.alert('无法打开扫码', '当前没有相机权限，请允许访问摄像头后重试。');
        return;
      }
    }

    setScannerOpen(true);
  }

  async function handleScan(rawValue: string) {
    if (scanLockedRef.current || busy) {
      return;
    }

    const nextValue = String(rawValue || '').trim();
    if (!nextValue) {
      return;
    }

    scanLockedRef.current = true;
    setBusy(true);
    setLastScan(nextValue);
    setScannerOpen(false);

    try {
      const result = await pairByScan(nextValue);
      const title = result.created ? '配对成功' : '已存在会话';
      const body = result.created
        ? `已创建会话“${result.session.name}”，马上进入会话页。`
        : `已找到现有会话“${result.session.name}”，马上为你打开。`;

      Alert.alert(title, body);
      navigation.replace('Conversation', {
        sessionId: result.session.id,
      });
    } catch (error) {
      scanLockedRef.current = false;
      Alert.alert('无法创建会话', error instanceof Error ? error.message : '二维码内容无法识别。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View style={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Pairing</Text>
          <Text style={styles.title}>扫码配对</Text>
          <Text style={styles.body}>{helperText}</Text>
        </View>

        {scannerOpen && permissionReady ? (
          <View style={styles.scannerCard}>
            <CameraView
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={({ data }) => {
                void handleScan(String(data || ''));
              }}
              style={styles.camera}
            />
            <View style={styles.scanOverlay}>
              <View style={styles.scanFrame} />
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>扫码说明</Text>
            <Text style={styles.item}>1. 点“打开扫码”请求摄像头权限</Text>
            <Text style={styles.item}>2. 扫描 PC 宿主机生成的二维码</Text>
            <Text style={styles.item}>3. 扫码成功后会自动创建对应会话</Text>
          </View>
        )}

        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>扫码结果 / 配对码</Text>
          <TextInput
            editable={false}
            placeholder="扫到二维码后，这里会显示原始内容"
            placeholderTextColor={appColors.inkMuted}
            style={styles.input}
            value={lastScan}
          />

          {scannerOpen ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                scanLockedRef.current = false;
                setScannerOpen(false);
              }}
            >
              <Text style={styles.secondaryButtonText}>关闭扫码</Text>
            </Pressable>
          ) : (
            <Pressable style={[styles.primaryButton, busy ? styles.buttonDisabled : null]} disabled={busy} onPress={handleOpenScanner}>
              <Text style={styles.primaryButtonText}>{busy ? '处理中...' : '打开扫码'}</Text>
            </Pressable>
          )}

          <Text style={styles.note}>扫到二维码后会立即创建会话；如果该二维码对应的会话已存在，会直接打开现有会话。</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: appColors.page,
  },
  page: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 16,
  },
  hero: {
    borderRadius: 26,
    padding: 22,
    backgroundColor: appColors.heroB,
  },
  eyebrow: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.7)',
    color: appColors.ink,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 14,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: appColors.ink,
  },
  body: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 23,
    color: appColors.inkMuted,
  },
  card: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.line,
    gap: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: appColors.ink,
  },
  item: {
    fontSize: 14,
    lineHeight: 22,
    color: appColors.inkMuted,
  },
  scannerCard: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000000',
    position: 'relative',
    minHeight: 360,
  },
  camera: {
    height: 360,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  scanFrame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: 24,
    backgroundColor: 'transparent',
  },
  previewCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.line,
    gap: 12,
  },
  previewLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: appColors.inkMuted,
  },
  input: {
    minHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: appColors.line,
    backgroundColor: appColors.page,
    color: appColors.ink,
    paddingHorizontal: 14,
    paddingVertical: 14,
    textAlignVertical: 'top',
    fontSize: 14,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: appColors.accent,
    paddingVertical: 15,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: appColors.line,
    backgroundColor: appColors.surfaceMuted,
    paddingVertical: 15,
  },
  secondaryButtonText: {
    color: appColors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  note: {
    fontSize: 13,
    lineHeight: 20,
    color: appColors.inkMuted,
  },
});
