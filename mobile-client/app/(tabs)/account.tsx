import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Brand, Button, Field, Screen, Title, uiStyles } from '../../src/components/ui';
import { useMyFlix } from '../../src/context/MyFlixContext';
import { colors } from '../../src/theme';

export default function AccountScreen() {
  const app = useMyFlix();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [firstName, setFirstName] = useState(app.user?.firstName || '');
  const [lastName, setLastName] = useState(app.user?.lastName || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [editing, setEditing] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function authenticate() {
    setError(''); setMessage('');
    try {
      if (mode === 'login') await app.login(email, password);
      else await app.signup({ firstName, lastName, email, password, confirmPassword });
      setPassword(''); setConfirmPassword('');
    } catch (reason) { setError((reason as Error).message); }
  }

  async function saveProfile() {
    setError('');
    try { await app.updateProfile(firstName, lastName); setEditing(false); setMessage('Profile updated.'); }
    catch (reason) { setError((reason as Error).message); }
  }

  async function savePassword() {
    setError(''); setMessage('');
    try {
      await app.changePassword(currentPassword, newPassword, newPasswordConfirm);
      setCurrentPassword(''); setNewPassword(''); setNewPasswordConfirm(''); setPasswordOpen(false); setMessage('Password changed.');
    } catch (reason) { setError((reason as Error).message); }
  }

  async function changeServer() {
    await app.disconnectServer();
    router.replace('/connect');
  }

  if (!app.user) {
    return (
      <Screen demo={app.isDemo}>
        <Brand />
        <View style={styles.memberCard}>
          <Text style={styles.eyebrow}>MYFLIX MEMBERSHIP</Text>
          <Title>{mode === 'login' ? 'Welcome back' : 'Join the lounge'}</Title>
          <Text style={uiStyles.muted}>{app.isDemo ? 'Use any non-empty demo credentials. Nothing is sent or saved.' : mode === 'login' ? 'Sign in to sync progress and favorites.' : 'Create an account on your existing MyFlix server.'}</Text>
          {mode === 'signup' && <View style={styles.row}><View style={styles.half}><Field label="First name" value={firstName} onChangeText={setFirstName} /></View><View style={styles.half}><Field label="Last name" value={lastName} onChangeText={setLastName} /></View></View>}
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {mode === 'signup' && <Field label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button label={app.busy ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Create Account'} icon={mode === 'login' ? 'log-in-outline' : 'ticket-outline'} onPress={authenticate} disabled={app.busy} />
          {app.capabilities?.signupAllowed && <Button label={mode === 'login' ? 'Create an account' : 'I already have an account'} onPress={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }} variant="secondary" />}
        </View>
        <Button label="Change MyFlix Server" icon="server-outline" onPress={changeServer} variant="secondary" />
      </Screen>
    );
  }

  return (
    <Screen demo={app.isDemo}>
      <Brand />
      <View style={styles.memberCard}>
        <Text style={styles.eyebrow}>ELECTRIC LOUNGE MEMBER</Text>
        <Text style={styles.memberName}>{app.user.fullName}</Text>
        <Text style={styles.memberEmail}>{app.user.email}</Text>
        {app.user.isAdmin && <Text style={styles.adminBadge}>HOUSE MANAGER</Text>}
      </View>
      <View style={styles.panel}>
        <Title>Profile</Title>
        {editing ? <><Field label="First name" value={firstName} onChangeText={setFirstName} /><Field label="Last name" value={lastName} onChangeText={setLastName} /><View style={styles.row}><View style={styles.half}><Button label="Save" icon="checkmark" onPress={saveProfile} /></View><View style={styles.half}><Button label="Cancel" onPress={() => setEditing(false)} variant="secondary" /></View></View></> : <Button label="Edit profile" icon="create-outline" onPress={() => { setFirstName(app.user?.firstName || ''); setLastName(app.user?.lastName || ''); setEditing(true); }} variant="secondary" />}
      </View>
      <View style={styles.panel}>
        <Title>Security</Title>
        {app.isDemo && <Text style={uiStyles.muted}>Password changes are simulated in this temporary demo session.</Text>}
        {passwordOpen ? <><Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry /><Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry /><Field label="Confirm new password" value={newPasswordConfirm} onChangeText={setNewPasswordConfirm} secureTextEntry /><Button label="Change password" icon="lock-closed-outline" onPress={savePassword} /></> : <Button label="Change password" icon="lock-closed-outline" onPress={() => setPasswordOpen(true)} variant="secondary" />}
      </View>
      {!!message && <Text style={styles.success}>{message}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button label="Change MyFlix Server" icon="server-outline" onPress={changeServer} variant="secondary" />
      <Button label="Log Out" icon="log-out-outline" onPress={app.logout} variant="danger" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  memberCard: { gap: 14, padding: 22, borderRadius: 20, backgroundColor: colors.burgundy, borderWidth: 1, borderColor: colors.gold, overflow: 'hidden' },
  eyebrow: { color: colors.gold, fontWeight: '900', letterSpacing: 2, fontSize: 10 },
  memberName: { color: colors.text, fontSize: 29, fontWeight: '900' },
  memberEmail: { color: '#e8d8bc' },
  adminBadge: { alignSelf: 'flex-start', color: colors.background, backgroundColor: colors.gold, fontWeight: '900', fontSize: 10, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 4 },
  panel: { gap: 15, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  error: { color: colors.danger, lineHeight: 20 },
  success: { color: colors.success, lineHeight: 20 },
});
