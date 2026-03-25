import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useSessions } from '../state/SessionsContext';
import { appColors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Conversation'>;

export function ConversationScreen({ route, navigation }: Props) {
  const { getSessionById, refreshSessions, sendMessage } = useSessions();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const session = getSessionById(route.params.sessionId);

  function scrollToBottom(animated = true) {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    });
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: session?.name || '会话',
    });
  }, [navigation, session?.name]);

  useEffect(() => {
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(eventName, () => {
      scrollToBottom(true);
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [route.params.sessionId]);

  if (!session) {
    return (
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <View style={styles.emptyShell}>
          <Text style={styles.emptyTitle}>会话不存在</Text>
          <Text style={styles.emptyBody}>这个会话可能已经被删除，请返回列表重新选择。</Text>
        </View>
      </SafeAreaView>
    );
  }

  const activeSession = session;
  const composerEnabled = Boolean(activeSession.transportReady) || activeSession.peerState === 'connected';
  const helperText =
    activeSession.trustState === 'pending'
      ? `等待桌面端确认安全码${activeSession.safetyCode ? ` ${activeSession.safetyCode}` : ''}`
      : activeSession.transportReady
        ? '通道已就绪，可以开始发送业务消息。'
        : activeSession.peerState === 'failed'
          ? activeSession.peerDetail
            ? `P2P 通道建立失败：${activeSession.peerDetail}`
            : 'P2P 通道建立失败，请稍后重试。'
          : activeSession.status === 'offline'
            ? '桌面端当前离线，正在等待重新联通。'
        : activeSession.peerState === 'connecting' || activeSession.peerState === 'channel-open' || activeSession.peerState === 'verifying'
          ? '正在建立 P2P 通道...'
          : activeSession.peerState === 'connected'
            ? '通道已就绪，可以开始发送业务消息。'
            : activeSession.peerDetail
              ? `P2P 通道未就绪：${activeSession.peerDetail}`
              : '已完成配对发现，正在准备安全通道。';

  async function handleSend() {
    const text = draft.trim();
    if (!text) {
      Alert.alert('无法发送', '请输入消息内容。');
      return;
    }

    try {
      setSending(true);
      setDraft('');
      await sendMessage(activeSession.id, text);
      setDraft('');
    } catch (error) {
      setDraft((current) => (current.trim() ? current : text));
      Alert.alert('发送失败', error instanceof Error ? error.message : '消息发送失败。');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
      >
        <View style={styles.headerStrip}>
          <Text style={styles.headerLabel}>{activeSession.peerLabel}</Text>
          <Text style={styles.headerMeta}>创建于 {activeSession.createdAt}</Text>
          <Text style={styles.headerHint}>{helperText}</Text>
          {activeSession.isReplying ? (
            <View style={styles.replyingBanner}>
              <Text style={styles.replyingBannerText}>Agent 正在回复...</Text>
            </View>
          ) : null}
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.flex}
          contentContainerStyle={[styles.messageList, { paddingBottom: Math.max(insets.bottom, 20) }]}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            scrollToBottom(true);
          }}
        >
          {activeSession.messages.map((message) => {
            const isSelf = message.from === 'self';
            return (
              <View key={message.id} style={[styles.messageRow, isSelf ? styles.messageRowSelf : null]}>
                <View style={[styles.bubble, isSelf ? styles.bubbleSelf : styles.bubblePeer]}>
                  <Text style={styles.messageText}>{message.text}</Text>
                </View>
                <Text style={styles.messageTs}>{message.createdAt}</Text>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.composerShell, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            placeholder="输入消息"
            placeholderTextColor={appColors.inkMuted}
            style={styles.input}
            multiline
            value={draft}
            onChangeText={setDraft}
            editable={!sending && composerEnabled}
          />
          <Pressable
            style={[styles.sendButton, !draft.trim() || sending || !composerEnabled ? styles.sendButtonDisabled : null]}
            onPress={() => {
              void handleSend();
            }}
            disabled={sending || !composerEnabled}
          >
            <Text style={styles.sendButtonText}>
              {!composerEnabled ? '通道未就绪' : sending ? '发送中...' : '发送'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: appColors.page,
  },
  emptyShell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: appColors.ink,
  },
  emptyBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    color: appColors.inkMuted,
  },
  headerStrip: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: appColors.surfaceMuted,
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: appColors.ink,
  },
  headerMeta: {
    marginTop: 4,
    fontSize: 12,
    color: appColors.inkMuted,
  },
  headerHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: appColors.accent,
  },
  replyingBanner: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: appColors.accentSoft,
  },
  replyingBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: appColors.accent,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 14,
  },
  messageRow: {
    alignItems: 'flex-start',
  },
  messageRowSelf: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: appColors.line,
  },
  bubblePeer: {
    backgroundColor: appColors.bubblePeer,
    borderTopLeftRadius: 8,
  },
  bubbleSelf: {
    backgroundColor: appColors.bubbleSelf,
    borderTopRightRadius: 8,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    color: appColors.ink,
  },
  messageTs: {
    marginTop: 6,
    fontSize: 11,
    color: appColors.inkMuted,
  },
  composerShell: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: appColors.line,
    backgroundColor: appColors.surface,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: appColors.page,
    color: appColors.ink,
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: appColors.accent,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
