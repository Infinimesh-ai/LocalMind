import { z } from 'zod';

const id = z.string().min(1).max(256);
const number = z.number().finite();
const text = z.string().max(8192);
const color = z.union([
  text,
  z.object({ normal: text }).strict(),
  z.object({ light: text, dark: text }).strict(),
]);
const bounds = z
  .string()
  .max(256)
  .refine(value => {
    try {
      const parsed: unknown = JSON.parse(value);
      return (
        Array.isArray(parsed) &&
        parsed.length === 4 &&
        parsed.every(
          value => typeof value === 'number' && Number.isFinite(value)
        ) &&
        parsed[2] >= 0 &&
        parsed[3] >= 0
      );
    } catch {
      return false;
    }
  });
const common = { index: text, lockedBySelf: z.boolean() };
const geometry = { ...common, xywh: bounds, rotate: number };
const font = {
  color,
  fontFamily: text,
  fontSize: number.positive().max(2000),
  fontStyle: z.enum(['normal', 'italic']),
  fontWeight: z.enum(['300', '400', '500', '600', '700']),
  textAlign: z.enum(['left', 'center', 'right']),
};
const strokeStyle = z.enum(['solid', 'dash', 'none']);
const pointStyle = z.enum(['Arrow', 'Circle', 'Diamond', 'None', 'Triangle']);
const connection = z
  .object({ id: id.optional(), position: z.tuple([number, number]).optional() })
  .strict()
  .refine(value => value.id !== undefined || value.position !== undefined);
export const surfaceElementDefinition = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('shape'),
      properties: z
        .object({
          ...geometry,
          ...font,
          fillColor: color,
          filled: z.boolean(),
          maxWidth: z.union([z.literal(false), number.positive()]),
          padding: z.tuple([number.nonnegative(), number.nonnegative()]),
          radius: number.nonnegative(),
          roughness: number.nonnegative(),
          shadow: z
            .object({
              blur: number.nonnegative(),
              offsetX: number,
              offsetY: number,
              color,
            })
            .strict()
            .nullable(),
          shapeStyle: z.enum(['General', 'Scribbled']),
          shapeType: z.enum(['rect', 'ellipse', 'diamond', 'triangle']),
          strokeColor: color,
          strokeStyle,
          strokeWidth: number.nonnegative(),
          textHorizontalAlign: z.enum(['left', 'center', 'right']),
          textVerticalAlign: z.enum(['top', 'center', 'bottom']),
          textResizing: z.union([z.literal(0), z.literal(1)]),
        })
        .partial()
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('text'),
      properties: z
        .object({ ...geometry, ...font, hasMaxWidth: z.boolean() })
        .partial()
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('brush'),
      properties: z
        .object({ ...geometry, color, lineWidth: number.positive().max(2000) })
        .partial()
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('highlighter'),
      properties: z
        .object({ ...geometry, color, lineWidth: number.positive().max(2000) })
        .partial()
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('connector'),
      properties: z
        .object({
          ...common,
          mode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
          stroke: color,
          strokeStyle,
          strokeWidth: number.nonnegative(),
          rough: z.boolean(),
          roughness: number.nonnegative(),
          source: connection,
          target: connection,
          frontEndpointStyle: pointStyle,
          rearEndpointStyle: pointStyle,
          labelDisplay: z.boolean(),
          labelXYWH: z.tuple([
            number,
            number,
            number.nonnegative(),
            number.nonnegative(),
          ]),
          labelOffset: z
            .object({
              distance: number.min(0).max(1),
              anchor: z.enum(['top', 'center', 'bottom']).optional(),
            })
            .strict(),
          labelConstraints: z
            .object({ hasMaxWidth: z.boolean(), maxWidth: number.positive() })
            .strict(),
          labelStyle: z.object(font).partial().strict(),
        })
        .partial()
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('group'),
      properties: z.object(common).partial().strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('mindmap'),
      properties: z
        .object({
          ...common,
          layoutType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
          style: z.union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
          ]),
        })
        .partial()
        .strict(),
    })
    .strict(),
]);
const operation = { opId: id, surfaceId: id };
export const documentSurfaceCommand = z.discriminatedUnion('type', [
  z
    .object({ ...operation, type: z.literal('mindmap.layout'), elementId: id })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('frame.members.set'),
      frameId: id,
      members: z.array(id).max(10000),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('element.create'),
      clientRef: id,
      element: surfaceElementDefinition,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('element.update'),
      elementId: id,
      element: surfaceElementDefinition,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('element.delete'),
      elementId: id,
      includeChildren: z.boolean(),
      references: z.enum(['reject', 'detach']),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('element.members.set'),
      elementId: id,
      members: z
        .array(
          z
            .object({
              id,
              parent: id.optional(),
              index: text.optional(),
              collapsed: z.boolean().optional(),
            })
            .strict()
        )
        .max(10000),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('element.stroke.set_points'),
      elementId: id,
      points: z
        .array(
          z.union([
            z.tuple([number, number]),
            z.tuple([number, number, number.min(0).max(1)]),
          ])
        )
        .min(1)
        .max(100000),
    })
    .strict(),
]);
export type DocumentSurfaceCommand = z.infer<typeof documentSurfaceCommand>;
