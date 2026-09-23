import { NATIVE_FILE_MAX_INPUT_BYTES } from '@localmind/office';
import { z } from 'zod';

import { NativeFileCreateSchema } from '../../../core/office/create-service';

// Some compatible providers return nested objects as JSON strings. Decode only
// this bounded field once, then apply the exact same strict storage contract.
export const NativeFileCreateToolSchema = NativeFileCreateSchema.extend({
  content: z
    .preprocess(value => {
      if (typeof value !== 'string') return value;
      if (Buffer.byteLength(value, 'utf8') > NATIVE_FILE_MAX_INPUT_BYTES)
        return value;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    }, NativeFileCreateSchema.shape.content)
    .describe(
      'A structured object, not a JSON string. Example: {"format":"docx","paragraphs":[{"text":"Title","heading":1},{"text":"Body"}]}. TXT example: {"format":"txt","text":"Body"}.'
    ),
});
