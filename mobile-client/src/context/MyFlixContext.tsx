import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MyFlixApi, checkConnection } from '../api/client';
import type { Capabilities, MediaItem, MyFlixUser } from '../api/types';
import { progressPayload } from '../lib/library';
import { normalizeServerUrl } from '../lib/server-url';

const SERVER_KEY = 'myflix.server-url';
const TOKEN_KEY = 'myflix.session-token';

type SignupInput = { firstName: string; lastName: string; email: string; password: string; confirmPassword: string };

type MyFlixContextValue = {
  ready: boolean;
  busy: boolean;
  serverUrl: string;
  token: string | null;
  user: MyFlixUser | null;
  capabilities: Capabilities | null;
  library: MediaItem[];
  api: MyFlixApi;
  connect: (url: string) => Promise<void>;
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
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MyFlixUser | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const serverRef = useRef('');
  const tokenRef = useRef<string | null>(null);

  async function clearSession() {
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setLibrary((items) => items.map((item) => ({ ...item, isFavorite: false, watchProgress: null })));
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }

  const apiRef = useRef<MyFlixApi | null>(null);
  if (!apiRef.current) {
    apiRef.current = new MyFlixApi({
      getServerUrl: () => serverRef.current,
      getToken: () => tokenRef.current,
      onUnauthorized: clearSession,
    });
  }
  const api = apiRef.current;

  async function refreshLibrary() {
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
      const [nextCapabilities, me] = await Promise.all([api.capabilities(), api.me()]);
      setCapabilities(nextCapabilities);
      setUser(me.authenticated ? me.user : null);
      if (!me.authenticated && storedToken) await clearSession();
      await refreshLibrary();
    } catch {
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
      const changedServer = serverRef.current && serverRef.current !== result.serverUrl;
      if (changedServer || tokenRef.current) await clearSession();
      serverRef.current = result.serverUrl;
      setServerUrl(result.serverUrl);
      setCapabilities(result.capabilities);
      setUser(null);
      await SecureStore.setItemAsync(SERVER_KEY, result.serverUrl);
      await refreshLibrary();
    } finally {
      setBusy(false);
    }
  }

  async function disconnectServer() {
    await clearSession();
    serverRef.current = '';
    setServerUrl('');
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
      const result = await api.login(email.trim(), password);
      await storeSession(result.sessionToken, result.user);
    } finally { setBusy(false); }
  }

  async function signup(input: SignupInput) {
    setBusy(true);
    try {
      const result = await api.signup({ ...input, email: input.email.trim() });
      await storeSession(result.sessionToken, result.user);
    } finally { setBusy(false); }
  }

  async function logout() {
    try { await api.logout(); } catch { /* Clearing local auth is still safe if the server is offline. */ }
    await clearSession();
    await refreshLibrary().catch(() => {});
  }

  async function updateProfile(firstName: string, lastName: string) {
    const result = await api.updateProfile(firstName, lastName);
    setUser(result.user);
  }

  async function changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
    await api.changePassword(currentPassword, newPassword, confirmPassword);
  }

  async function toggleFavorite(target: MediaItem | { id: string; isShow: true; isFavorite: boolean }) {
    if (!user) throw new Error('Sign in to add favorites.');
    const favorite = !target.isFavorite;
    const payload = target.isShow
      ? { isShow: true, showId: target.id }
      : { isShow: false, mediaId: target.id };
    await api.setFavorite(payload, favorite);
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
    await api.saveProgress(payload);
  }

  return (
    <MyFlixContext.Provider value={{
      ready, busy, serverUrl, token, user, capabilities, library, api,
      connect, disconnectServer, login, signup, logout, refreshLibrary,
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
