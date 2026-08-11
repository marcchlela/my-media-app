import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Brand, Button, Field, Screen, uiStyles } from '../src/components/ui';
import { useMyFlix } from '../src/context/MyFlixContext';
import { colors } from '../src/theme';

export default function ConnectScreen() {
  const { connect, enterDemo, demoAvailable, busy, serverUrl } = useMyFlix();
  const [url, setUrl] = useState(serverUrl);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      await connect(url);
      router.replace('/(tabs)');
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  function openDemo() {
    setError('');
    try {
      enterDemo();
      router.replace('/(tabs)');
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  return (
    <Screen scroll={false} style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
        <Brand />
        <View style={styles.ticket}>
          <Text style={styles.eyebrow}>PRIVATE SERVER ADMISSION</Text>
          <Text style={styles.heading}>Connect to MyFlix</Text>
          <Text style={uiStyles.muted}>Enter the address of your MyFlix server. You can use a LAN URL now and a private Tailscale HTTPS URL later.</Text>
          <Field
            label="Server URL"
            value={url}
            onChangeText={setUrl}
            placeholder="http://your-server:3000"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button label={busy ? 'Testing connection...' : 'Test & Connect'} icon="radio-outline" onPress={submit} disabled={busy} />
          {demoAvailable && <View style={styles.demoPanel}><Text style={styles.demoLabel}>DEVELOPMENT ONLY</Text><Text style={uiStyles.muted}>Away from the server? Explore a temporary fictional library without connecting or saving account data.</Text><Button label="Explore Demo Library" icon="sparkles-outline" onPress={openDemo} variant="secondary" /></View>}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', gap: 30 },
  ticket: { padding: 22, borderWidth: 1, borderColor: colors.goldDim, borderRadius: 20, backgroundColor: colors.surface, gap: 18 },
  eyebrow: { color: colors.gold, letterSpacing: 2, fontSize: 11, fontWeight: '800' },
  heading: { color: colors.text, fontSize: 28, fontWeight: '900' },
  error: { color: colors.danger, lineHeight: 20 },
  demoPanel: { gap: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  demoLabel: { alignSelf: 'flex-start', color: colors.gold, backgroundColor: '#2c1d14', borderWidth: 1, borderColor: colors.goldDim, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
});
