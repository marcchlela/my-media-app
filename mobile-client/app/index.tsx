import { Redirect } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { Loading, Screen } from '../src/components/ui';
import { useMyFlix } from '../src/context/MyFlixContext';

export default function EntryScreen() {
  const { ready, connected, isDemo } = useMyFlix();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return <Screen scroll={false}><Loading /></Screen>;
  return <Redirect href={connected || isDemo ? '/(tabs)' : '/connect'} />;
}
