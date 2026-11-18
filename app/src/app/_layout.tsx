import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors, useThemeScheme } from '@/theme';

export default function RootLayout() {
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
      <Slot />
    </ThemeProvider>
  );
}
