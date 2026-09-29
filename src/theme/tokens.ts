export const colors = {
  canvas: '#F6F3EA',
  surface: '#FFFEFA',
  surfaceSoft: '#EEF0E6',
  ink: '#203B30',
  muted: '#5D6C61',
  quiet: '#718075',
  line: '#E2E3D7',
  lineStrong: '#CDD4C7',
  green: '#245D43',
  greenSoft: '#DDEBDD',
  sage: '#8FAE8E',
  sand: '#F0E4C8',
  amber: '#8A5B16',
  amberSoft: '#F7EACB',
  red: '#A85240',
  redSoft: '#F5E2DB',
  blue: '#477889',
  blueSoft: '#E2EDF0',
  white: '#FFFFFF',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { control: 12, card: 18, feature: 24, pill: 999 } as const;

export const typeScale = { caption: 12, body: 15, bodyLarge: 17, title: 22, display: 30 } as const;

export const fontFamilies = {
  body: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  display: 'Manrope_700Bold',
} as const;
