import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import React from 'react';
import { colors } from '../../src/theme';

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home-outline',
  search: 'search-outline',
  library: 'albums-outline',
  account: 'person-outline',
};

export default function TabLayout() {
  return (
    <Tabs screenOptions={({ route }) => ({
      headerShown: false,
      tabBarActiveTintColor: colors.gold,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: '#160e0f', borderTopColor: colors.line, height: 74, paddingTop: 7, paddingBottom: 9 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      tabBarIcon: ({ color, size, focused }) => {
        const icon = icons[route.name] || 'ellipse-outline';
        return <Ionicons name={focused ? icon.replace('-outline', '') as keyof typeof Ionicons.glyphMap : icon} color={color} size={size} />;
      },
    })}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
