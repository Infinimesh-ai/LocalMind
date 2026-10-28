export const folderSortModes = ['name-asc', 'name-desc', 'manual'] as const;
export type FolderSortMode = (typeof folderSortModes)[number];

const names = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});

const ordinalNumber = '[0-9零〇一二两三四五六七八九十百千]+';
const ordinalWithUnit = new RegExp(
  `第\\s*(${ordinalNumber})\\s*(周|天|日|月|年|章|节|篇|部分|项|条|次|期|版|集|轮)`,
  'g'
);
const leadingParenthesizedOrdinal = new RegExp(
  `^(\\s*)(?:\\(\\s*(${ordinalNumber})\\s*\\)|（\\s*(${ordinalNumber})\\s*）)`
);
const leadingDelimitedOrdinal = new RegExp(
  `^(\\s*)(${ordinalNumber})\\s*([、.])`
);

// Accept explicit place values up to thousands, not digit strings (二〇二六)
// or ambiguous shorthand (一百二). Both stay in the ordinary pinyin order.
const chineseDigit = '[一二三四五六七八九]';
const chineseTens = `${chineseDigit}十${chineseDigit}?`;
const chineseHundreds = `${chineseDigit}百(?:${chineseTens}|零${chineseDigit})?`;
const chineseThousands = `${chineseDigit}千(?:${chineseHundreds}|零(?:${chineseTens}|${chineseDigit}))?`;
const chineseNumber = new RegExp(
  `^(?:零|${chineseDigit}|十${chineseDigit}?|${chineseTens}|${chineseHundreds}|${chineseThousands})$`
);

function ordinalValue(value: string): string | undefined {
  if (/^[0-9]+$/.test(value)) return value;
  const normalized = value.replaceAll('两', '二').replaceAll('〇', '零');
  if (!chineseNumber.test(normalized)) return;
  let total = 0;
  let digit = 0;
  for (const character of normalized) {
    const unit =
      character === '十'
        ? 10
        : character === '百'
          ? 100
          : character === '千'
            ? 1000
            : 0;
    if (unit) {
      total += (digit || 1) * unit;
      digit = 0;
    } else {
      digit = '零一二三四五六七八九'.indexOf(character);
    }
  }
  return String(total + digit);
}

function folderNameSortKey(title: string): string {
  return title
    .replace(ordinalWithUnit, (match, number: string, unit: string) => {
      const value = ordinalValue(number);
      return value === undefined ? match : `第${value}${unit}`;
    })
    .replace(
      leadingParenthesizedOrdinal,
      (
        match,
        space: string,
        ascii: string | undefined,
        fullWidth: string | undefined
      ) => {
        const value = ordinalValue(ascii ?? fullWidth ?? '');
        return value === undefined ? match : `${space}(${value})`;
      }
    )
    .replace(
      leadingDelimitedOrdinal,
      (match, space: string, number: string, delimiter: string) => {
        const value = ordinalValue(number);
        return value === undefined ? match : `${space}${value}${delimiter}`;
      }
    );
}

export function sortFolderChildren<T extends { id: string | null }>(
  children: readonly T[],
  mode: FolderSortMode,
  title: (child: T) => string
): T[] {
  if (mode === 'manual') return [...children];
  const direction = mode === 'name-desc' ? -1 : 1;
  return children
    .map(child => {
      const name = title(child).normalize('NFC');
      return { child, name, key: folderNameSortKey(name) };
    })
    .sort((a, b) => {
      const compared =
        names.compare(a.key, b.key) || names.compare(a.name, b.name);
      return (
        compared * direction ||
        compareNodeIds(a.child.id ?? '', b.child.id ?? '')
      );
    })
    .map(({ child }) => child);
}

export function compareNodeIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function moveFolderChild(
  ids: readonly string[],
  source: string,
  target: string,
  at: 'before' | 'after'
) {
  if (!ids.includes(source) || !ids.includes(target))
    throw new Error('Folder changed; refresh before reordering');
  if (source === target) return [...ids];
  const result = ids.filter(id => id !== source);
  result.splice(result.indexOf(target) + (at === 'after' ? 1 : 0), 0, source);
  return result;
}
