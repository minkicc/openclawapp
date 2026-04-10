import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { createOpenClawPairChatMessageId } from '@openclaw/message-sdk';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { MarkdownText } from '../components/MarkdownText';
import { useSessions } from '../state/SessionsContext';
import { appColors } from '../theme/colors';
import type { ChatMessage, SessionItem } from '../types/session';
import { reconcileSessionMessages } from '../utils/chatGraph';

type Props = NativeStackScreenProps<RootStackParamList, 'Conversation'>;

function describeLinkTransport(session: SessionItem, relayReady: boolean) {
  if (session.status === 'offline') {
    return '链路：离线';
  }
  if (session.linkTransport === 'p2p') {
    return '链路：P2P';
  }
  if (session.linkTransport === 'relay') {
    return '链路：服务端转发';
  }
  if (session.peerState === 'connected') {
    return '链路：P2P（待探测）';
  }
  if (relayReady) {
    return '链路：服务端转发（待探测）';
  }
  if (
    session.peerState === 'connecting' ||
    session.peerState === 'channel-open' ||
    session.peerState === 'verifying'
  ) {
    return '链路：探测中';
  }
  return '链路：待建立';
}

function describeLinkQuality(session: SessionItem) {
  if (session.status === 'offline') {
    return '质量：不可用';
  }
  if (session.linkProbePending && !session.linkRttMs) {
    return '质量：探测中';
  }
  const rttAt = Math.max(0, Math.trunc(Number(session.linkRttAt || 0)));
  if (rttAt > 0 && Date.now() - rttAt > 20_000) {
    return session.linkProbePending ? '质量：探测中' : '质量：待探测';
  }
  const rttMs = Math.max(0, Math.trunc(Number(session.linkRttMs || 0)));
  if (rttMs <= 0) {
    return session.linkProbePending ? '质量：探测中' : '质量：待探测';
  }
  const quality =
    rttMs <= 120 ? '优秀' : rttMs <= 260 ? '良好' : rttMs <= 600 ? '一般' : '较慢';
  return `质量：${quality} · ${rttMs}ms`;
}

export function ConversationScreen({ route, navigation }: Props) {
  const { getSessionById, refreshSessions, retryMessage, sendMessage } = useSessions();
  const [draft, setDraft] = useState('');
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const session = getSessionById(route.params.sessionId);

  function formatLocalMessageTime(date = new Date()) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function mergeDisplayedMessages(
    sessionMessages: ChatMessage[],
    localMessages: ChatMessage[]
  ) {
    const localIds = new Set(localMessages.map((message) => String(message.id || '').trim()).filter(Boolean));
    const baseMessages = sessionMessages.filter(
      (message) => !localIds.has(String(message.id || '').trim())
    );
    return reconcileSessionMessages([...baseMessages, ...localMessages]).messages;
  }

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

  useEffect(() => {
    setOptimisticMessages([]);
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
  const displayedMessages = mergeDisplayedMessages(
    activeSession.messages || [],
    optimisticMessages
  );
  const relayReady =
    String(activeSession.trustState || '').trim() === 'active' && activeSession.status !== 'offline';
  const composerEnabled =
    Boolean(activeSession.transportReady) || activeSession.peerState === 'connected' || relayReady;
  const linkTransportText = describeLinkTransport(activeSession, relayReady);
  const linkQualityText = describeLinkQuality(activeSession);

  function handleSend() {
    const text = draft.trim();
    if (!text) {
      Alert.alert('无法发送', '请输入消息内容。');
      return;
    }

    const ts = Date.now();
    const messageId = createOpenClawPairChatMessageId(ts);
    const localMessage: ChatMessage = {
      id: messageId,
      from: 'self',
      text,
      createdAt: formatLocalMessageTime(new Date(ts)),
      ts,
      kind: 'chat',
      origin: 'mobile',
      originSeq: 0,
      after: [],
      missingAfter: [],
      deliveryStatus: 'sending',
      deliveryError: '',
    };
    setOptimisticMessages((current) => {
      const next = current.filter((message) => message.id !== messageId);
      next.push(localMessage);
      return next;
    });
    setDraft('');
    void sendMessage(activeSession.id, text, {
      messageId,
      ts,
    })
      .then(() => {
        setOptimisticMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  deliveryStatus: 'sent',
                  deliveryError: '',
                }
              : message
          )
        );
      })
      .catch((error) => {
        setOptimisticMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  deliveryStatus: 'failed',
                  deliveryError:
                    error instanceof Error ? error.message : '消息发送失败',
                }
              : message
          )
        );
        Alert.alert('发送失败', error instanceof Error ? error.message : '消息发送失败。');
      });
  }

  function handleRetry(messageId: string) {
    const optimistic = optimisticMessages.find((message) => message.id === messageId);
    if (optimistic) {
      setOptimisticMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                deliveryStatus: 'sending',
                deliveryError: '',
              }
            : message
        )
      );
    }
    void retryMessage(activeSession.id, messageId).catch((error) => {
      if (optimistic) {
        setOptimisticMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  deliveryStatus: 'failed',
                  deliveryError:
                    error instanceof Error ? error.message : '消息重发失败',
                }
              : message
          )
        );
      }
      Alert.alert('重发失败', error instanceof Error ? error.message : '消息重发失败。');
    });
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
          <View style={styles.linkStatusRow}>
            <View style={styles.linkStatusChip}>
              <Text style={styles.linkStatusText}>{linkTransportText}</Text>
            </View>
            <View style={styles.linkStatusChip}>
              <Text style={styles.linkStatusText}>{linkQualityText}</Text>
            </View>
          </View>
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
          {displayedMessages.map((message) => {
            const isSelf = message.from === 'self';
            const showDeliveryState = isSelf && message.kind !== 'system';
            const retryable = showDeliveryState && message.deliveryStatus === 'failed';
            const bubble = (
              <View
                style={[
                  styles.bubble,
                  isSelf ? styles.bubbleSelf : styles.bubblePeer,
                  showDeliveryState ? styles.bubbleSelfWithStatus : null,
                ]}
              >
                {showDeliveryState ? (
                  <View
                    style={[
                      styles.deliveryBadge,
                      message.deliveryStatus === 'failed'
                        ? styles.deliveryBadgeFailed
                        : message.deliveryStatus === 'sending'
                          ? styles.deliveryBadgeSending
                          : styles.deliveryBadgeSent,
                    ]}
                  >
                    {message.deliveryStatus === 'sending' ? (
                      <ActivityIndicator size="small" color={appColors.accent} />
                    ) : (
                      <Text style={styles.deliveryBadgeText}>
                        {message.deliveryStatus === 'failed' ? '!' : '✓'}
                      </Text>
                    )}
                  </View>
                ) : null}
                <MarkdownText
                  text={message.text}
                  style={styles.messageText}
                  variant={isSelf ? 'self' : 'peer'}
                />
              </View>
            );
            return (
              <View key={message.id} style={[styles.messageRow, isSelf ? styles.messageRowSelf : null]}>
                {retryable ? (
                  <Pressable onPress={() => handleRetry(message.id)}>{bubble}</Pressable>
                ) : (
                  bubble
                )}
                <Text style={styles.messageTs}>{message.createdAt}</Text>
                {retryable ? (
                  <Text style={styles.retryHint}>发送失败，点击气泡重发</Text>
                ) : null}
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
            editable={composerEnabled}
          />
          <Pressable
            style={[styles.sendButton, !draft.trim() || !composerEnabled ? styles.sendButtonDisabled : null]}
            onPress={() => {
              handleSend();
            }}
            disabled={!draft.trim() || !composerEnabled}
          >
            <Text style={styles.sendButtonText}>
              {activeSession.trustState === 'pending'
                ? '等待确认'
                : !composerEnabled
                  ? '桌面离线'
                  : '发送'}
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
  linkStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  linkStatusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: appColors.line,
  },
  linkStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: appColors.ink,
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
    position: 'relative',
  },
  bubblePeer: {
    backgroundColor: appColors.bubblePeer,
    borderTopLeftRadius: 8,
  },
  bubbleSelf: {
    backgroundColor: appColors.bubbleSelf,
    borderTopRightRadius: 8,
  },
  bubbleSelfWithStatus: {
    paddingTop: 16,
    paddingRight: 40,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    color: appColors.ink,
  },
  deliveryBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    shadowColor: 'rgba(24, 32, 40, 0.18)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
  },
  deliveryBadgeSending: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  deliveryBadgeSent: {
    backgroundColor: '#23b26d',
  },
  deliveryBadgeFailed: {
    backgroundColor: '#d94d4d',
  },
  deliveryBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 12,
  },
  messageTs: {
    marginTop: 6,
    fontSize: 11,
    color: appColors.inkMuted,
  },
  retryHint: {
    marginTop: 4,
    fontSize: 11,
    color: '#d94d4d',
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
