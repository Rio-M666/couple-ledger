import type { TextStyle } from 'react-native';

import { useColorScheme } from './hooks/use-color-scheme';

export const colors = {
  light: {
    bg: '#FAF8F4',
    surface: '#FFFFFF',
    ink: '#1D1B16',
    inkMuted: '#6E675C',
    hairline: '#E5E0D5',
    accent: '#2F6B4F',
    accentInk: '#FFFFFF',
    warn: '#B3541E',
    danger: '#A62B1F',
  },
  dark: {
    bg: '#16140F',
    surface: '#211E17',
    ink: '#F2EFE7',
    inkMuted: '#A39A8B',
    hairline: '#37332A',
    accent: '#7FB894',
    accentInk: '#101408',
    warn: '#D98E4A',
    danger: '#D96A5E',
  },
} as const;

export type ColorTokens = (typeof colors)[keyof typeof colors];

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const layout = {
  screenGutter: 20,
  maxContentWidth: 600,
  rowMinHeight: 56,
  buttonRadius: 12,
  progressMinWidth: 96,
} as const;

const numbers: Pick<TextStyle, 'fontVariant'> = { fontVariant: ['tabular-nums'] };

export const typography = {
  body: { fontSize: 15, lineHeight: 15 * 1.6 },
  small: { fontSize: 13, lineHeight: 13 * 1.6 },
  heading: { fontSize: 20, lineHeight: 20 * 1.4, fontWeight: '600' },
  screenTitle: { fontSize: 17, lineHeight: 17 * 1.4, fontWeight: '600' },
  balance: { fontSize: 48, lineHeight: 60, fontWeight: '600' },
  amount: { fontSize: 18, lineHeight: 18 * 1.6 },
  numbers,
} as const;

export function useThemeScheme() {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}
