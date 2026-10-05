import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.hvhbigname.occ',
  appName: 'OpenCode Pocket',
  webDir: 'dist',
  backgroundColor: '#101310',
  android: { backgroundColor: '#101310', allowMixedContent: true },
  ios: { backgroundColor: '#101310', contentInset: 'never', preferredContentMode: 'mobile' },
  plugins: { CapacitorHttp: { enabled: false } },
};

export default config;
