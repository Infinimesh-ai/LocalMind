import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, './package.json'), 'utf-8')
);

interface AppConfig {
  affineVersion: string;
}

const config: CapacitorConfig & AppConfig = {
  appId: 'ai.infinimesh.localmind',
  appName: 'LocalMind',
  webDir: 'dist',
  affineVersion: packageJson.version,
  ios: {
    scheme: 'App',
    path: '.',
    webContentsDebuggingEnabled: true,
    // Silence Capacitor's bridge logging (⚡️ TO JS / ⚡️ To Native -> / ⚡️ [log]).
    loggingBehavior: 'none',
  },
  server: {
    // url: 'http://localhost:8080',
  },
  plugins: {
    CapacitorCookies: {
      enabled: false,
    },
    CapacitorHttp: {
      enabled: false,
    },
    Keyboard: {
      resize: KeyboardResize.None,
    },
  },
};

if (process.env.CAP_SERVER_URL) {
  Object.assign(config, {
    server: {
      url: process.env.CAP_SERVER_URL,
    },
  });
}

export default config;
