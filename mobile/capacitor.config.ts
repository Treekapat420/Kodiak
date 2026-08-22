import type { CapacitorConfig } from '@capacitor/cli';

const KODIAK_URL = process.env.CAPACITOR_SERVER_URL || 'https://kodiak-tt65.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.kodiak.launchpad',
  appName: 'Kodiak',
  webDir: 'www',
  appendUserAgent: ' KodiakNative/1.0',
  server: {
    url: KODIAK_URL,
    cleartext: false,
    allowNavigation: ['kodiak-tt65.vercel.app']
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile'
  },
  android: {
    allowMixedContent: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#070707',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK'
    }
  }
};

export default config;
