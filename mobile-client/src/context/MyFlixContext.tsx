import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MyFlixApi, checkConnection } from '../api/client';
import type { Capabilities, MediaItem, MyFlixUser } from '../api/types';
import { createDemoLibrary, DEMO_CAPABILITIES, DEMO_USER } from '../demo/demo-data';
import { isDemoModeAvailable } from '../demo/demo-mode';
import { progressPayload } from '../lib/library';
import { normalizeServerUrl } from '../lib/server-url';

const SERVER_KEY = 'myflix.server-url';
const TOKEN_KEY = 'myflix.session-token';

type SignupInput = { firstName: string; lastName: string; email: string; password: string; confirmPassword: string };

type MyFlixContextValue = {
  ready: boolean;
  busy: boolean;
  connected: boolean;
  demoAvailable: boolean;
  isDemo: boolean;
  serverUrl: string;
  token: string | null;
  user: MyFlixUser | null;
  capabilities: Capabilities | null;
  library: MediaItem[];
  api: MyFlixApi;
  connect: (url: string) => Promise<void>;
  enterDemo: () => void;
  disconnectServer: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  updateProfile: (firstName: string, lastName: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) => Promise<void>;
  toggleFavorite: (target: MediaItem | { id: string; isShow: true; isFavorite: boolean }) => Promise<void>;
  saveProgress: (item: MediaItem, position: number, duration: number, complete?: boolean) => Promise<void>;
};

const MyFlixContext = createContext<MyFlixContextValue | null>(null);

export function MyFlixProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MyFlixUser | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const serverRef = useRef('');
  const tokenRef = useRef<string | null>(null);
  const demoRef = useRef(false);
  const demoAvailable = isDemoModeAvailable();

  async function clearSession() {
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setLibrary((items) => items.map((item) => ({ ...item, isFavorite: false, watchProgress: null })));
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }

  async function handleUnauthorized() {
    if (demoRef.current || !tokenRef.current) return;
    await clearSession();
    router.replace('/(tabs)/account');
  }

  const apiRef = useRef<MyFlixApi | null>(null);
  if (!apiRef.current) {
    apiRef.current = new MyFlixApi({
      getServerUrl: () => serverRef.current,
      getToken: () => tokenRef.current,
      onUnauthorized: handleUnauthorized,
    });
  }
  const api = apiRef.current;

  async function refreshLibrary() {
    if (demoRef.current) return;
    if (!serverRef.current) return;
    try {
      setLibrary(await api.library());
    } catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
      setLibrary([]);
    }
  }

  async function restore() {
    try {
      const [storedServer, storedToken] = await Promise.all([
        SecureStore.getItemAsync(SERVER_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
      ]);
      if (!storedServer) return;
      const normalized = normalizeServerUrl(storedServer);
      serverRef.current = normalized;
      tokenRef.current = storedToken;
      setServerUrl(normalized);
      setToken(storedToken);
      const [health, nextCapabilities, me] = await Promise.all([api.health(), api.capabilities(), api.me()]);
      if (!health.ok) throw new Error('MyFlix is not ready.');
      setCapabilities(nextCapabilities);
      setUser(me.authenticated ? me.user : null);
      if (!me.authenticated && storedToken) await clearSession();
      await refreshLibrary();
      setConnected(true);
    } catch {
      setConnected(false);
      setCapabilities(null);
      setUser(null);
      setLibrary([]);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => { restore(); }, []);

  async function connect(url: string) {
    setBusy(true);
    try {
      const result = await checkConnection(url);
      const changedServer = !!serverRef.current && serverRef.current !== result.serverUrl;
      if (changedServer) await clearSession();
      demoRef.current = false;
      setIsDemo(false);
      serverRef.current = result.serverUrl;
      setServerUrl(result.serverUrl);
      setCapabilities(result.capabilities);
      await SecureStore.setItemAsync(SERVER_KEY, result.serverUrl);
      if (tokenRef.current) {
        const me = await api.me();
        setUser(me.authenticated ? me.user : null);
        if (!me.authenticated) await clearSession();
      } else {
        setUser(null);
      }
      await refreshLibrary();
      setConnected(true);
    } finally {
      setBusy(false);
    }
  }

  function enterDemo() {
    if (!demoAvailable) throw new Error('Development demo mode is not enabled.');
    demoRef.current = true;
    setIsDemo(true);
    setConnected(false);
    setCapabilities(DEMO_CAPABILITIES);
    setUser(DEMO_USER);
    setLibrary(createDemoLibrary());
  }

  async function disconnectServer() {
    if (demoRef.current) {
      demoRef.current = false;
      setIsDemo(false);
      setCapabilities(null);
      setUser(null);
      setLibrary([]);
      return;
    }
    await clearSession();
    serverRef.current = '';
    setServerUrl('');
    setConnected(false);
    setCapabilities(null);
    setLibrary([]);
    await SecureStore.deleteItemAsync(SERVER_KEY);
  }

  async function storeSession(sessionToken: string, nextUser: MyFlixUser) {
    tokenRef.current = sessionToken;
    setToken(sessionToken);
    setUser(nextUser);
    await SecureStore.setItemAsync(TOKEN_KEY, sessionToken);
    await refreshLibrary();
  }

  async function login(email: string, password: string) {
    setBusy(true);
    try {
      if (demoRef.current) {
        if (!email.trim() || !password) throw new Error('Email and password are required.');
        setUser(DEMO_USER);
        return;
      }
      const result = await api.login(email.trim(), password);
      await storeSession(result.sessionToken, result.user);
    } finally { setBusy(false); }
  }

  async function signup(input: SignupInput) {
    setBusy(true);
    try {
      if (demoRef.current) {
        if (!input.firstName.trim() || !input.lastName.trim() || !input.email.trim() || !input.password) throw new Error('Complete every field to create the demo account.');
        if (input.password !== input.confirmPassword) throw new Error('Passwords do not match.');
        const nextUser = { ...DEMO_USER, firstName: input.firstName.trim(), lastName: input.lastName.trim(), fullName: `${input.firstName.trim()} ${input.lastName.trim()}`, email: input.email.trim() };
        setUser(nextUser);
        return;
      }
      const result = await api.signup({ ...input, email: input.email.trim() });
      await storeSession(result.sessionToken, result.user);
    } finally { setBusy(false); }
  }

  async function logout() {
    if (demoRef.current) {
      setUser(null);
      setLibrary((items) => items.map((item) => ({ ...item, isFavorite: false, watchProgress: null })));
      return;
    }
    try { await api.logout(); } catch { /* Clearing local auth is still safe if the server is offline. */ }
    await clearSession();
    await refreshLibrary().catch(() => {});
  }

  async function updateProfile(firstName: string, lastName: string) {
    if (demoRef.current) {
      if (!firstName.trim() || !lastName.trim()) throw new Error('First and last name are required.');
      setUser((current) => current ? { ...current, firstName: firstName.trim(), lastName: lastName.trim(), fullName: `${firstName.trim()} ${lastName.trim()}` } : current);
      return;
    }
    const result = await api.updateProfile(firstName, lastName);
    setUser(result.user);
  }

  async function changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
    if (demoRef.current) {
      if (!currentPassword || !newPassword || !confirmPassword) throw new Error('Complete every password field.');
      if (newPassword !== confirmPassword) throw new Error('New passwords do not match.');
      return;
    }
    await api.changePassword(currentPassword, newPassword, confirmPassword);
  }

  async function toggleFavorite(target: MediaItem | { id: string; isShow: true; isFavorite: boolean }) {
    if (!user) throw new Error('Sign in to add favorites.');
    const favorite = !target.isFavorite;
    const payload = target.isShow
      ? { isShow: true, showId: target.id }
      : { isShow: false, mediaId: target.id };
    if (!demoRef.current) await api.setFavorite(payload, favorite);
    setLibrary((items) => items.map((item) => (
      target.isShow ? item.showId === target.id : item.id === target.id
    ) ? { ...item, isFavorite: favorite } : item));
  }

  async function saveProgress(item: MediaItem, position: number, duration: number, complete = false) {
    if (!user || !duration) return;
    const payload = progressPayload(item.id, position, duration, complete);
    setLibrary((items) => items.map((entry) => entry.id === item.id
      ? { ...entry, watchProgress: { ...payload, updatedAt: payload.updatedAt } }
      : entry));
    if (!demoRef.current) await api.saveProgress(payload);
  }

  return (
    <MyFlixContext.Provider value={{
      ready, busy, connected, demoAvailable, isDemo, serverUrl, token, user, capabilities, library, api,
      connect, enterDemo, disconnectServer, login, signup, logout, refreshLibrary,
      updateProfile, changePassword, toggleFavorite, saveProgress,
    }}>
      {children}
    </MyFlixContext.Provider>
  );
}

export function useMyFlix() {
  const value = useContext(MyFlixContext);
  if (!value) throw new Error('useMyFlix must be used inside MyFlixProvider.');
  return value;
}
