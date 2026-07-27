import { Platform, TextStyle } from 'react-native';
const fontFamily = Platform.select({ android: { heading: 'Syne', mono: 'DM Mono', body: undefined }, default: { heading: undefined, mono: undefined, body: undefined } })!;
export const typography = {
  h1: { fontFamily: fontFamily.heading, fontWeight: '800' as const, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 } as TextStyle,
  h2: { fontFamily: fontFamily.heading, fontWeight: '700' as const, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 } as TextStyle,
  h3: { fontFamily: fontFamily.heading, fontWeight: '700' as const, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 } as TextStyle,
  body: { fontFamily: fontFamily.body, fontWeight: '400' as const, fontSize: 14, lineHeight: 20 } as TextStyle,
  bodySmall: { fontFamily: fontFamily.body, fontWeight: '400' as const, fontSize: 12, lineHeight: 16 } as TextStyle,
  mono: { fontFamily: fontFamily.mono, fontWeight: '400' as const, fontSize: 12, lineHeight: 16 } as TextStyle,
  monoSmall: { fontFamily: fontFamily.mono, fontWeight: '400' as const, fontSize: 11, lineHeight: 14 } as TextStyle,
  label: { fontFamily: fontFamily.heading, fontWeight: '700' as const, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: 'uppercase' as const } as TextStyle,
} as const;
