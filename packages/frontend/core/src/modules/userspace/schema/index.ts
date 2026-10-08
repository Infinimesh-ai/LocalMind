import { type DBSchemaBuilder, f } from '@toeverything/infra';

export const USER_DB_SCHEMA = {
  folderSortPreference: {
    key: f.string().primaryKey(),
    mode: f.enum('name-asc', 'name-desc', 'manual'),
  },
  editorSetting: {
    key: f.string().primaryKey(),
    value: f.string(),
  },
} as const satisfies DBSchemaBuilder;
export type UserDbSchema = typeof USER_DB_SCHEMA;
