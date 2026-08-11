import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, shadows } from '../theme';

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const content = scroll
    ? <ScrollView contentContainerStyle={[styles.screenContent, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[styles.screenContent, styles.fill, style]}>{children}</View>;
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>{content}</SafeAreaView>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.brandRow}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>M</Text></View>
      {!compact && <View><Text style={styles.brand}>MYFLIX</Text><Text style={styles.brandSub}>PRIVATE CINEMA</Text></View>}
    </View>
  );
}

export function Title({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return <View style={styles.titleRow}><Text style={styles.title}>{children}</Text>{action}</View>;
}

export function Button({ label, icon, onPress, disabled, variant = 'primary' }: {
  label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, styles[`button_${variant}`], pressed && styles.pressed, disabled && styles.disabled]}>
      {icon && <Ionicons name={icon} size={18} color={variant === 'secondary' ? colors.gold : colors.text} />}
      <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{props.label}</Text><TextInput placeholderTextColor={colors.muted} {...props} style={[styles.field, props.style]} /></View>;
}

export function Loading({ label = 'Opening the lounge...' }: { label?: string }) {
  return <View style={styles.loading}><ActivityIndicator color={colors.gold} size="large" /><Text style={styles.muted}>{label}</Text></View>;
}

export function Poster({ source, title, headers, width = 132 }: { source?: string | null; title: string; headers?: Record<string, string>; width?: number }) {
  const imageSource: ImageSourcePropType | undefined = source ? { uri: source, headers } : undefined;
  return (
    <View style={[styles.posterFrame, { width, height: width * 1.5 }]}>
      {imageSource ? <Image source={imageSource} style={styles.poster} resizeMode="cover" /> : <View style={styles.posterFallback}><Ionicons name="film-outline" size={28} color={colors.goldDim} /><Text numberOfLines={3} style={styles.posterFallbackText}>{title}</Text></View>}
    </View>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, percent))}%` }]} /></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: 18, paddingBottom: 112, gap: 18 },
  fill: { flex: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 38, height: 38, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.burgundy, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] },
  brandMarkText: { color: colors.text, fontWeight: '900', fontSize: 20, transform: [{ rotate: '-45deg' }] },
  brand: { color: colors.text, fontWeight: '900', letterSpacing: 4, fontSize: 20 },
  brandSub: { color: colors.gold, letterSpacing: 2, fontSize: 8, marginTop: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: 0.3 },
  muted: { color: colors.muted, lineHeight: 20 },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderWidth: 1 },
  button_primary: { backgroundColor: colors.burgundy, borderColor: colors.goldDim },
  button_secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.line },
  button_danger: { backgroundColor: '#5b1820', borderColor: colors.danger },
  buttonText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  buttonSecondaryText: { color: colors.gold },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
  fieldWrap: { gap: 7 },
  fieldLabel: { color: colors.gold, fontSize: 12, letterSpacing: 0.7, textTransform: 'uppercase', fontWeight: '700' },
  field: { color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, minHeight: 50, borderRadius: 13, paddingHorizontal: 15, fontSize: 16 },
  loading: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 16 },
  posterFrame: { borderWidth: 2, borderColor: colors.goldDim, padding: 3, backgroundColor: '#090707', borderRadius: 5, ...shadows },
  poster: { width: '100%', height: '100%', borderRadius: 2 },
  posterFallback: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 10 },
  posterFallbackText: { color: colors.muted, textAlign: 'center', fontSize: 12 },
  progress: { height: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.goldDim, backgroundColor: '#3b3430', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.burgundyBright },
});

export const uiStyles = styles;
