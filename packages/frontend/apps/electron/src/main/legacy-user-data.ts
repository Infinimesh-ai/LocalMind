import path from 'node:path';

import { app } from 'electron';

import { buildType } from './config';

// Product naming changed without moving existing profiles, sessions, or BYOK data.
const legacyAppName = buildType === 'stable' ? 'AFFiNE' : `AFFiNE-${buildType}`;
const legacyUserDataPath = path.join(app.getPath('appData'), legacyAppName);

app.setPath('userData', legacyUserDataPath);
app.setPath('sessionData', legacyUserDataPath);
