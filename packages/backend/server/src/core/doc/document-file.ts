import {
  applyEdits,
  findNodeAtLocation,
  modify,
  type Node,
  type ParseError,
  parseTree,
} from 'jsonc-parser';

import { encodeNativeText, nativeTextIdentity } from '../office/file-content';
import { DocumentEditError } from './document-editor';
import type { DocumentFileCommand } from './document-file-schema';
import { isTextBoundary } from './native-text';

const invalid: (reason: string) => never = reason => {
  throw new DocumentEditError('invalid_input', { reason });
};
const splice = (text: string, offset: number, length: number, value: string) =>
  text.slice(0, offset) + value + text.slice(offset + length);

function jsonTree(text: string) {
  const errors: ParseError[] = [];
  const node = parseTree(text, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (!node || errors.length) return invalid('invalid_json');
  const visit = (node: Node, depth: number) => {
    if (depth > 64) invalid('json_depth_exceeded');
    if (node.type === 'object') {
      const names =
        node.children?.map(property => property.children?.[0].value) ?? [];
      if (new Set(names).size !== names.length)
        invalid('ambiguous_duplicate_json_property');
    }
    node.children?.forEach(child => visit(child, depth + 1));
  };
  visit(node, 0);
  return node;
}

type Cell = { start: number; end: number; value: string };
type Row = { start: number; end: number; next: number; cells: Cell[] };
function csvRows(text: string, delimiter: string): Row[] {
  const rows: Row[] = [];
  let offset = text.startsWith('\uFEFF') ? 1 : 0;
  while (offset < text.length) {
    const start = offset,
      cells: Cell[] = [];
    while (true) {
      const cellStart = offset;
      let value = '';
      if (text[offset] === '"') {
        offset++;
        let closed = false;
        while (offset < text.length) {
          if (text[offset] === '"') {
            if (text[offset + 1] === '"') {
              value += '"';
              offset += 2;
            } else {
              offset++;
              closed = true;
              break;
            }
          } else value += text[offset++];
        }
        if (
          !closed ||
          (offset < text.length &&
            ![delimiter, '\r', '\n'].includes(text[offset]))
        )
          invalid('invalid_csv_quote');
      } else {
        while (
          offset < text.length &&
          ![delimiter, '\r', '\n'].includes(text[offset])
        ) {
          if (text[offset] === '"') invalid('invalid_csv_quote');
          value += text[offset++];
        }
      }
      cells.push({ start: cellStart, end: offset, value });
      if (text[offset] === delimiter) {
        offset++;
        continue;
      }
      const end = offset;
      if (text[offset] === '\r') offset++;
      if (text[offset] === '\n') offset++;
      rows.push({ start, end, next: offset, cells });
      if (rows.length > 10000 || cells.length > 10000)
        invalid('csv_dimension_limit');
      break;
    }
  }
  return rows;
}
function csvValue(value: string, delimiter: string) {
  return [delimiter, '"', '\r', '\n'].some(character =>
    value.includes(character)
  )
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

/** Typed file edits preserve original bytes outside the explicitly edited tokens. */
export function editDocumentFile(
  original: string,
  mimeType: string,
  commands: DocumentFileCommand[]
) {
  let text = original;
  const identity = nativeTextIdentity(mimeType);
  if (new Set(commands.map(command => command.opId)).size !== commands.length)
    invalid('duplicate_operation_id');
  for (const command of commands) {
    try {
      if (command.type === 'file.replace')
        invalid('file_replace_must_be_single_operation');
      else if (command.type === 'file.text.splice') {
        if (
          !isTextBoundary(text, command.offset) ||
          !isTextBoundary(text, command.offset + command.deleteCount)
        )
          invalid('invalid_file_text_edit');
        text = splice(
          text,
          command.offset,
          command.deleteCount,
          command.insert
        );
      } else if ('path' in command) {
        if (identity !== 'resource.json') invalid('expected_json_file');
        const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
        let body = text.slice(bom.length);
        const tree = jsonTree(body),
          node = findNodeAtLocation(tree, command.path);
        if (command.type === 'file.json.set') {
          const value = jsonTree(command.valueJson);
          const raw = command.valueJson.slice(
            value.offset,
            value.offset + value.length
          );
          if (node) body = splice(body, node.offset, node.length, raw);
          else {
            const parent = findNodeAtLocation(tree, command.path.slice(0, -1));
            if (
              !parent ||
              parent.type !== 'object' ||
              typeof command.path.at(-1) !== 'string'
            )
              invalid('json_parent_not_found');
            // Add a placeholder using the parser's token edits, then substitute
            // the validated raw value so large numbers retain their precision.
            body = applyEdits(body, modify(body, command.path, null, {}));
            const inserted = findNodeAtLocation(jsonTree(body), command.path);
            if (!inserted) invalid('json_insert_failed');
            body = splice(body, inserted.offset, inserted.length, raw);
          }
        } else if (command.type === 'file.json.delete') {
          if (!node) invalid('json_path_not_found');
          body = applyEdits(body, modify(body, command.path, undefined, {}));
        } else {
          if (!node || node.type !== 'array') invalid('expected_json_array');
          const items = node.children ?? [];
          if (command.index > items.length) invalid('invalid_json_array_index');
          const values = command.valuesJson
            .map(raw => {
              const value = jsonTree(raw);
              return raw.slice(value.offset, value.offset + value.length);
            })
            .join(',');
          const at =
            items[command.index]?.offset ?? node.offset + node.length - 1;
          body = splice(
            body,
            at,
            0,
            command.index < items.length
              ? `${values},`
              : `${items.length ? ',' : ''}${values}`
          );
        }
        jsonTree(body);
        text = bom + body;
      } else {
        if (identity !== 'resource.csv') invalid('expected_csv_file');
        const rows = csvRows(text, command.delimiter),
          encode = (value: string) => csvValue(value, command.delimiter);
        if (command.type === 'file.csv.cell.set') {
          const cell = rows[command.row]?.cells[command.column];
          if (!cell) invalid('csv_cell_not_found');
          if (cell.value !== command.value)
            text = splice(
              text,
              cell.start,
              cell.end - cell.start,
              encode(command.value)
            );
        } else if (command.type === 'file.csv.row.insert') {
          if (command.index > rows.length) invalid('invalid_csv_row_index');
          const lineEnding = rows.find(row => row.next > row.end);
          const newline = lineEnding
            ? text.slice(lineEnding.end, lineEnding.next)
            : '\n';
          const value = command.values.map(encode).join(command.delimiter);
          if (command.index < rows.length)
            text = splice(text, rows[command.index].start, 0, value + newline);
          else {
            const last = rows.at(-1);
            text +=
              (last && last.next === last.end ? newline : '') +
              value +
              (lineEnding ? newline : '');
          }
        } else if (command.type === 'file.csv.row.delete') {
          const row = rows[command.index];
          if (!row) invalid('csv_row_not_found');
          text = splice(text, row.start, row.next - row.start, '');
        } else {
          if (
            command.type === 'file.csv.column.insert' &&
            command.values.length !== rows.length
          )
            invalid('csv_column_value_count');
          for (let index = rows.length - 1; index >= 0; index--) {
            const row = rows[index],
              cell = row.cells[command.index];
            if (command.type === 'file.csv.column.insert') {
              if (command.index > row.cells.length)
                invalid('invalid_csv_column_index');
              text = splice(
                text,
                cell?.start ?? row.end,
                0,
                cell
                  ? encode(command.values[index]) + command.delimiter
                  : command.delimiter + encode(command.values[index])
              );
            } else {
              if (!cell || row.cells.length === 1)
                invalid('csv_column_not_found_or_last');
              const start =
                command.index === row.cells.length - 1
                  ? row.cells[command.index - 1].end
                  : cell.start;
              const end =
                command.index === row.cells.length - 1
                  ? cell.end
                  : row.cells[command.index + 1].start;
              text = splice(text, start, end - start, '');
            }
          }
        }
        csvRows(text, command.delimiter);
      }
      encodeNativeText(text, identity);
    } catch (error) {
      if (error instanceof DocumentEditError)
        throw new DocumentEditError('invalid_input', {
          ...error.detail,
          opId: command.opId,
        });
      throw error;
    }
  }
  return text;
}
