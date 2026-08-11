export function isDemoModeAvailable(
  development = __DEV__,
  requested = process.env.EXPO_PUBLIC_MYFLIX_DEMO,
) {
  return development && String(requested || '').trim().toLowerCase() === 'true';
}
