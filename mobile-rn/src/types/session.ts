export type ConnectionStatus = 'connected' | 'waiting' | 'offline';

export type ChatMessage = {
  id: string;
  from: 'self' | 'host';
  text: string;
  createdAt: string;
};

export type SessionItem = {
  id: string;
  name: string;
  status: ConnectionStatus;
  isReplying: boolean;
  createdAt: string;
  peerLabel: string;
  preview: string;
  messages: ChatMessage[];
  serverBaseUrl: string;
  serverToken: string;
  deviceId: string;
  pairSessionId: string;
  bindingId: string;
};
