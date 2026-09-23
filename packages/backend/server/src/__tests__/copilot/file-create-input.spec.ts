import {
  createNativeFile,
  NATIVE_FILE_MAX_INPUT_BYTES,
} from '@localmind/office';
import test from 'ava';
import { unzipSync } from 'fflate';

import { NativeFileCreateSchema } from '../../core/office/create-service';
import { NativeFileCreateToolSchema } from '../../plugins/copilot/tools/file-create-input';
import { toToolJsonSchema } from '../../plugins/copilot/tools/json-schema';

const content = {
  format: 'docx',
  paragraphs: [{ text: 'Regression document', heading: 1 }],
};

test('model stringified content creates the same real DOCX as structured content', t => {
  const object = NativeFileCreateToolSchema.parse({ title: 'Test', content });
  const encoded = NativeFileCreateToolSchema.parse({
    title: 'Test',
    content: JSON.stringify(content),
  });
  t.deepEqual(encoded, object);
  const file = createNativeFile(encoded.content);
  t.truthy(unzipSync(file.bytes)['word/document.xml']);
  t.true(NativeFileCreateSchema.safeParse(encoded).success);
  t.false(
    NativeFileCreateSchema.safeParse({
      title: 'Test',
      content: JSON.stringify(content),
    }).success
  );
});

test('model normalization rejects malformed, oversized, double encoded and invalid content', t => {
  for (const value of [
    '{',
    'x'.repeat(NATIVE_FILE_MAX_INPUT_BYTES + 1),
    JSON.stringify(JSON.stringify(content)),
    'null',
    '[]',
    JSON.stringify({ ...content, extra: true }),
    JSON.stringify({ format: 'docx', paragraphs: [] }),
  ]) {
    t.false(
      NativeFileCreateToolSchema.safeParse({ title: 'Test', content: value })
        .success
    );
  }
});

test('advertised schema still describes structured content with examples', t => {
  const schema = toToolJsonSchema(NativeFileCreateToolSchema);
  const properties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  t.true(Array.isArray(properties.content.anyOf));
  t.regex(String(properties.content.description), /not a JSON string/);
});
