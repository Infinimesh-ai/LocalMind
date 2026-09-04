import { parseOfficeCommand } from '@localmind/office';
import test from 'ava';

test('parses a stable AI document text-format command', t => {
  const command = parseOfficeCommand({
    version: 'localmind-office-command/v1',
    commandId: 'command-1',
    idempotencyKey: 'artifact-1:revision-1:command-1',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'ai',
    operation: 'office.document.text.format',
    target: {
      type: 'text_range',
      start: { blockId: 'paragraph-1', offset: 0 },
      end: { blockId: 'paragraph-1', offset: 8 },
    },
    format: {
      fontSizePt: 14,
      textColor: '#0000FF',
      italic: true,
      underline: { style: 'single', color: '#FF0000' },
      paragraphStyleId: 'heading-2',
    },
  });

  t.is(command.operation, 'office.document.text.format');
  if (command.operation !== 'office.document.text.format') {
    t.fail('expected a document text-format command');
    return;
  }
  t.is(command.format.fontSizePt, 14);
  t.is(
    command.format.underline === false
      ? undefined
      : command.format.underline?.color,
    '#FF0000'
  );
});

test('rejects ephemeral, empty, or reversed text-format commands', t => {
  const base = {
    version: 'localmind-office-command/v1',
    commandId: 'command-1',
    idempotencyKey: 'idempotency-1',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'ai',
    operation: 'office.document.text.format',
  };

  t.throws(() =>
    parseOfficeCommand({
      ...base,
      target: { type: 'current_selection' },
      format: { italic: true },
    })
  );
  t.throws(() =>
    parseOfficeCommand({
      ...base,
      target: {
        type: 'text_range',
        start: { blockId: 'paragraph-1', offset: 9 },
        end: { blockId: 'paragraph-1', offset: 2 },
      },
      format: {},
    })
  );
  t.throws(() =>
    parseOfficeCommand({
      ...base,
      unexpected: 'must-not-be-silently-dropped',
      target: {
        type: 'text_range',
        start: { blockId: 'paragraph-1', offset: 0 },
        end: { blockId: 'paragraph-1', offset: 2 },
      },
      format: { italic: true },
    })
  );
  t.throws(() =>
    parseOfficeCommand({
      ...base,
      target: {
        type: 'text_range',
        start: { blockId: 'paragraph-1', offset: 2 },
        end: { blockId: 'paragraph-1', offset: 2 },
      },
      format: { italic: true },
    })
  );
  t.throws(() =>
    parseOfficeCommand({
      ...base,
      target: {
        type: 'text_range',
        start: { blockId: 'paragraph-1', offset: 0 },
        end: { blockId: 'paragraph-1', offset: 2 },
      },
      format: { fontSizePt: 14.1 },
    })
  );
});

test('parses bounded text replacement commands including insertion', t => {
  const command = parseOfficeCommand({
    version: 'localmind-office-command/v1',
    commandId: 'replace-command-1',
    idempotencyKey: 'replace-command-1',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'user',
    operation: 'office.document.text.replace',
    target: {
      type: 'text_range',
      start: { blockId: 'paragraph-1', offset: 4 },
      end: { blockId: 'paragraph-1', offset: 4 },
    },
    text: ' native',
  });

  t.is(command.operation, 'office.document.text.replace');
  if (command.operation === 'office.document.text.replace') {
    t.is(command.text, ' native');
  }
  t.throws(() =>
    parseOfficeCommand({
      ...command,
      target: {
        type: 'text_range',
        start: { blockId: 'paragraph-1', offset: 5 },
        end: { blockId: 'paragraph-1', offset: 2 },
      },
    })
  );
});
