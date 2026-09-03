import { app } from 'electron';

import { buildType } from './config';
import { prepareUserDataPath } from './user-data-path';

const userDataPath = prepareUserDataPath(app.getPath('appData'), buildType);

app.setPath('userData', userDataPath);
app.setPath('sessionData', userDataPath);
