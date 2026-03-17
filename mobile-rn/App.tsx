import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppNavigator } from './src/navigation/AppNavigator';
import { SessionsProvider } from './src/state/SessionsContext';
import { appColors } from './src/theme/colors';

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: appColors.page,
    card: appColors.surface,
    text: appColors.ink,
    border: appColors.line,
    primary: appColors.accent,
    notification: appColors.accent,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionsProvider>
        <NavigationContainer theme={navigationTheme}>
          <StatusBar style="dark" />
          <AppNavigator />
        </NavigationContainer>
      </SessionsProvider>
    </SafeAreaProvider>
  );
}
