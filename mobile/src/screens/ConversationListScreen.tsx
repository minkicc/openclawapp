import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useSessions } from '../state/SessionsContext';
import { appColors } from '../theme/colors';
import type { ConnectionStatus } from '../types/session';

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

function statusMeta(status: ConnectionStatus) {
  if (status === 'connected') {
    return { label: '已连接', tone: styles.statusConnected };
  }
  if (status === 'waiting') {
    return { label: '等待中', tone: styles.statusWaiting };
  }
  return { label: '离线', tone: styles.statusOffline };
}

export function ConversationListScreen({ navigation }: Props) {
  const { sessions, removeSession, refreshSessions } = useSessions();

  function handleDelete(sessionId: string, sessionName: string) {
    Alert.alert('删除会话', `确定要删除“${sessionName}”吗？`, [
      {
        text: '取消',
        style: 'cancel',
      },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removeSession(sessionId);
        },
      },
    ]);
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={[appColors.heroA, appColors.heroB]} style={styles.hero}>
          <Text style={styles.eyebrow}>OpenClaw Mobile RN</Text>
          <Text style={styles.heroTitle}>移动通信终端</Text>
          <Text style={styles.heroBody}>扫码配对成功后，会自动在这里生成会话。点击右侧“配对”即可开始扫描宿主机二维码。</Text>
          <Pressable style={styles.heroAction} onPress={() => navigation.navigate('Pairing')}>
            <Text style={styles.heroActionText}>配对</Text>
          </Pressable>
        </LinearGradient>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>会话列表</Text>
          <View style={styles.sectionActions}>
            <Text style={styles.sectionMeta}>{sessions.length} 个连接</Text>
            <Pressable
              style={styles.refreshButton}
              onPress={() => {
                void refreshSessions();
              }}
            >
              <Text style={styles.refreshButtonText}>刷新</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.cardStack}>
          {sessions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>暂无会话</Text>
              <Text style={styles.emptyBody}>扫码成功后，会自动创建一个新的会话并显示在这里。</Text>
            </View>
          ) : null}

          {sessions.map((session) => {
            const meta = statusMeta(session.status);
            return (
              <View key={session.id} style={styles.sessionCard}>
                <View style={styles.cardTopRow}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle}>{session.name}</Text>
                    <Text style={styles.cardSubtitle}>{session.peerLabel}</Text>
                  </View>
                  <View style={[styles.statusPill, meta.tone]}>
                    <Text style={styles.statusText}>{meta.label}</Text>
                  </View>
                </View>

                <Text style={styles.preview}>{session.preview}</Text>
                {session.isReplying ? (
                  <View style={styles.replyingPill}>
                    <Text style={styles.replyingPillText}>Agent 正在回复...</Text>
                  </View>
                ) : null}

                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>创建时间 {session.createdAt}</Text>
                  <Text style={styles.metaText}>ID {session.id}</Text>
                </View>

                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.inlineButton, styles.inlineGhost]}
                    onPress={() => handleDelete(session.id, session.name)}
                  >
                    <Text style={[styles.inlineButtonText, styles.inlineGhostText]}>删除</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.inlineButton, styles.inlinePrimary]}
                    onPress={() => navigation.navigate('Conversation', { sessionId: session.id })}
                  >
                    <Text style={styles.inlineButtonText}>进入</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: appColors.page,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 18,
  },
  hero: {
    borderRadius: 28,
    padding: 22,
    gap: 12,
  },
  eyebrow: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.72)',
    color: appColors.ink,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: appColors.ink,
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 23,
    color: appColors.inkMuted,
  },
  heroAction: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: appColors.accent,
  },
  heroActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: appColors.ink,
  },
  sectionMeta: {
    fontSize: 13,
    color: appColors.inkMuted,
  },
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: appColors.surfaceMuted,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: appColors.accent,
  },
  cardStack: {
    gap: 14,
  },
  emptyCard: {
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: appColors.line,
    borderStyle: 'dashed',
    backgroundColor: appColors.surface,
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
    color: appColors.inkMuted,
  },
  sessionCard: {
    backgroundColor: appColors.surface,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: appColors.line,
    shadowColor: appColors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 3,
    gap: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitleWrap: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: appColors.ink,
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: appColors.inkMuted,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusConnected: {
    backgroundColor: appColors.accentSoft,
  },
  statusWaiting: {
    backgroundColor: '#efe2b8',
  },
  statusOffline: {
    backgroundColor: '#f0d7d2',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: appColors.ink,
  },
  preview: {
    fontSize: 15,
    lineHeight: 22,
    color: appColors.ink,
  },
  replyingPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: appColors.accentSoft,
  },
  replyingPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: appColors.accent,
  },
  metaRow: {
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 18,
    color: appColors.inkMuted,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  inlineButton: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inlinePrimary: {
    backgroundColor: appColors.accent,
  },
  inlineGhost: {
    borderWidth: 1,
    borderColor: appColors.line,
    backgroundColor: appColors.surfaceMuted,
  },
  inlineButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  inlineGhostText: {
    color: appColors.ink,
  },
});
