import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.rizzmaster.voice', appName: 'Rizzmaster Voice', webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#050505', allowMixedContent: false },
};
export default config;
