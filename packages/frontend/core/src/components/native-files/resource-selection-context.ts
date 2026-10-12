import { createContext } from 'react';

/** The main resource explorer owns explicit selection mode; other indexes retain their behavior. */
export const ResourceSelectionModeContext = createContext(false);
