/// <reference types="vite/client" />

import { buildSchema, parse, validate } from 'graphql';
import { expect, test } from 'vitest';

import serverSchema from '../../../../backend/server/src/schema.gql?raw';
import {
  abandonCopilotBlockerMutation,
  confirmCopilotBlockerSuggestionMutation,
  copilotWorkbenchBlockersGetQuery,
  copilotWorkbenchTaskGetQuery,
  copilotWorkbenchTaskPanelGetQuery,
  copilotWorkbenchTasksGetQuery,
  createCopilotBlockerMutation,
  resolveCopilotBlockerMutation,
} from '../graphql';

const schema = buildSchema(serverSchema);

test.each([
  abandonCopilotBlockerMutation,
  confirmCopilotBlockerSuggestionMutation,
  copilotWorkbenchBlockersGetQuery,
  copilotWorkbenchTaskGetQuery,
  copilotWorkbenchTaskPanelGetQuery,
  copilotWorkbenchTasksGetQuery,
  createCopilotBlockerMutation,
  resolveCopilotBlockerMutation,
])(
  '$id sends a complete executable operation including its fragments',
  operation => {
    expect(
      validate(schema, parse(operation.query)).map(error => error.message)
    ).toEqual([]);
  }
);
