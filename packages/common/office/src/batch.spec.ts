import { describe, expect, test } from 'vitest';

import { parseOfficeCommandBatch } from './batch';

const command = {
  version: 'localmind-office-command/v1',
  commandId: 'command-1',
  idempotencyKey: 'command-key-1',
  artifactId: 'artifact-1',
  expectedRevisionId: 'revision-1',
  source: 'ai',
  operation: 'office.workbook.cell.set',
  target: { type: 'cell', sheetId: 'sheet-1', address: 'B2' },
  input: { type: 'formula', formula: 'SUM(A1:A2)' },
} as const;

const batch = {
  version: 'localmind-office-command-batch/v1',
  batchId: 'batch-1',
  idempotencyKey: 'batch-key-1',
  artifactId: command.artifactId,
  expectedRevisionId: command.expectedRevisionId,
  source: command.source,
  commands: [
    command,
    {
      ...command,
      commandId: 'command-2',
      idempotencyKey: 'command-key-2',
      target: { ...command.target, address: 'B3' },
    },
  ],
} as const;

describe('Office command batch', () => {
  test('parses a bounded, single-artifact atomic command list', () => {
    expect(parseOfficeCommandBatch(batch)).toEqual(batch);
  });

  test('rejects unknown fields and cross-artifact, revision, or source commands', () => {
    expect(() =>
      parseOfficeCommandBatch({ ...batch, unknown: true })
    ).toThrow();

    for (const changed of [
      { artifactId: 'artifact-2' },
      { expectedRevisionId: 'revision-2' },
      { source: 'user' },
    ]) {
      expect(() =>
        parseOfficeCommandBatch({
          ...batch,
          commands: [command, { ...batch.commands[1], ...changed }],
        })
      ).toThrow();
    }
  });

  test('rejects duplicate command identity and nested unknown fields', () => {
    expect(() =>
      parseOfficeCommandBatch({ ...batch, commands: [command, command] })
    ).toThrow(/must be unique/i);
    expect(() =>
      parseOfficeCommandBatch({
        ...batch,
        commands: [command, { ...batch.commands[1], unknown: true }],
      })
    ).toThrow();
  });
});
