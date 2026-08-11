import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const iconVariant = process.env.MYFLIX_ICON_VARIANT === 'electric' ? 'electric-lounge' : 'general';
  const icon = `./assets/icon-${iconVariant}-1024.png`;

  return {
    ...config,
    name: 'MyFlix',
    slug: 'myflix-mobile',
    version: '0.1.0',
    orientation: 'default',
    scheme: 'myflix',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    icon,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#100b0b',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.marcchlela.myflix',
      infoPlist: {
        NSLocalNetworkUsageDescription: 'MyFlix connects to your private home media server.',
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      },
    },
    android: {
      package: 'com.marcchlela.myflix',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon-foreground.png',
        monochromeImage: './assets/adaptive-icon-monochrome.png',
        backgroundColor: '#5d101b',
      },
    },
    plugins: ['expo-router', 'expo-secure-store'],
    experiments: { typedRoutes: true },
    extra: { iconVariant },
  };
};
