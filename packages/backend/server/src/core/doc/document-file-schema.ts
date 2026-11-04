import { z } from 'zod';

const opId = z.string().min(1).max(256);
const index = z.number().int().nonnegative();
const text = z.string().max(1024 * 1024);
const path = z.array(z.union([z.string().max(8192), index])).max(64);
const csv = { opId, delimiter: z.enum([',', ';', '\t']).default(',') };

export const documentFileCommand = z.discriminatedUnion('type', [
  z
    .object({
      opId,
      type: z.literal('file.text.splice'),
      offset: index,
      deleteCount: index,
      insert: text,
    })
    .strict(),
  z.object({ opId, type: z.literal('file.replace'), blobId: opId }).strict(),
  z
    .object({ opId, type: z.literal('file.json.set'), path, valueJson: text })
    .strict(),
  z
    .object({ opId, type: z.literal('file.json.delete'), path: path.min(1) })
    .strict(),
  z
    .object({
      opId,
      type: z.literal('file.json.array.insert'),
      path,
      index,
      valuesJson: z.array(text).min(1).max(1000),
    })
    .strict(),
  z
    .object({
      ...csv,
      type: z.literal('file.csv.cell.set'),
      row: index,
      column: index,
      value: text,
    })
    .strict(),
  z
    .object({
      ...csv,
      type: z.literal('file.csv.row.insert'),
      index,
      values: z.array(text).min(1).max(10000),
    })
    .strict(),
  z.object({ ...csv, type: z.literal('file.csv.row.delete'), index }).strict(),
  z
    .object({
      ...csv,
      type: z.literal('file.csv.column.insert'),
      index,
      values: z.array(text).max(10000),
    })
    .strict(),
  z
    .object({ ...csv, type: z.literal('file.csv.column.delete'), index })
    .strict(),
]);
export type DocumentFileCommand = z.infer<typeof documentFileCommand>;
