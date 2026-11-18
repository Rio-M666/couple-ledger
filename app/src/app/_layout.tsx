import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useLedger } from '@/hooks/use-ledger';
import { colors, useThemeScheme } from '@/theme';

export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const paired = useLedger().appState.status === 'paired';
  const scheme = useThemeScheme();
  const palette = colors[scheme];
  const baseTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <ThemeProvider
      value={{
        ...baseTheme,
        colors: {
          primary: palette.accent,
          background: palette.bg,
          card: palette.surface,
          text: palette.ink,
          border: palette.hairline,
          notification: palette.accent,
        },
      }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Protected guard={paired} redirectTo="/onboarding">
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="expense/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settlement/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="record/[id]" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={!paired} redirectTo="/">
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
