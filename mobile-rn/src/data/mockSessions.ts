import type { SessionItem } from '../types/session';

export const mockSessions: SessionItem[] = [
  {
    id: 'channel-001',
    name: '连接-001',
    status: 'connected',
    isReplying: false,
    createdAt: '今天 09:14',
    peerLabel: 'Agent Host / kc-mac-01',
    preview: '移动端已接入，等待下一条任务。',
    messages: [
      { id: 'm1', from: 'host', text: '通信渠道已建立。', createdAt: '09:14' },
      { id: 'm2', from: 'self', text: '收到，我先做链路验证。', createdAt: '09:15' },
      { id: 'm3', from: 'host', text: '验证通过后，后续会接入 Agent 对话。', createdAt: '09:17' },
    ],
    serverBaseUrl: 'http://127.0.0.1:8787',
    serverToken: '',
    deviceId: 'desktop-demo-001',
    pairSessionId: 'pair-demo-001',
    bindingId: 'binding-demo-001',
  },
  {
    id: 'channel-002',
    name: '连接-002',
    status: 'waiting',
    isReplying: false,
    createdAt: '昨天 21:40',
    peerLabel: 'Agent Host / office-mac',
    preview: '等待宿主机重新开放通道。',
    messages: [
      { id: 'm4', from: 'host', text: '宿主机将于稍后重启。', createdAt: '昨天 21:38' },
      { id: 'm5', from: 'self', text: '收到，恢复后我再继续。', createdAt: '昨天 21:40' },
    ],
    serverBaseUrl: 'http://127.0.0.1:8787',
    serverToken: '',
    deviceId: 'desktop-demo-002',
    pairSessionId: 'pair-demo-002',
    bindingId: 'binding-demo-002',
  },
];
