import type { CapacitorConfig } from '@capacitor/cli';
import { SystemBarsStyle } from '@capacitor/core';
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'dev.hvhbigname.occ',
  appName: 'OpenCode Pocket',
  webDir: 'dist',
  backgroundColor: '#0b0b14',
  android: { backgroundColor: '#0b0b14', allowMixedContent: true },
  ios: { backgroundColor: '#0b0b14', contentInset: 'never', preferredContentMode: 'mobile' },
  plugins: {
    CapacitorHttp: { enabled: false },
    SystemBars: { style: SystemBarsStyle.Dark, initialViewportFitValueHint: 'cover' },
    Keyboard: { resize: KeyboardResize.Native, style: KeyboardStyle.Dark },
  },
};

export default config;
