import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConversationListScreen } from '../screens/ConversationListScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { PairingScreen } from '../screens/PairingScreen';

export type RootStackParamList = {
  Sessions: undefined;
  Pairing: undefined;
  Conversation: { sessionId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerTitleStyle: {
          fontSize: 18,
          fontWeight: '700',
        },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="Sessions"
        component={ConversationListScreen}
        options={{
          title: '会话',
        }}
      />
      <Stack.Screen
        name="Pairing"
        component={PairingScreen}
        options={{
          title: '配对',
          presentation: 'modal',
        }}
      />
      <Stack.Screen
        name="Conversation"
        component={ConversationScreen}
        options={{
          title: '会话',
        }}
      />
    </Stack.Navigator>
  );
}
