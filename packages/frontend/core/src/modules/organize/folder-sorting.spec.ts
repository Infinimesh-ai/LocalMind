import { describe, expect, test } from 'vitest';

import { moveFolderChild, sortFolderChildren } from './folder-sorting';

describe('folder name order', () => {
  const children = ['9-23', '9-9', '10-2', '9-24'].map(name => ({
    id: name,
    name,
  }));
  test('compares date-like numeric names naturally in both directions', () => {
    expect(
      sortFolderChildren(children, 'name-desc', child => child.name).map(
        child => child.name
      )
    ).toEqual(['10-2', '9-24', '9-23', '9-9']);
    expect(
      sortFolderChildren(children, 'name-asc', child => child.name).map(
        child => child.name
      )
    ).toEqual(['9-9', '9-23', '9-24', '10-2']);
    expect(sortFolderChildren(children, 'manual', child => child.name)).toEqual(
      children
    );
    expect(children.map(child => child.name)).toEqual([
      '9-23',
      '9-9',
      '10-2',
      '9-24',
    ]);
  });
  test('handles complete years and uses stable IDs for equal numeric names', () => {
    const dates = ['2025-12-31', '2026-9-24', '2026-10-2'].map(id => ({ id }));
    expect(
      sortFolderChildren(dates, 'name-desc', child => child.id).map(
        child => child.id
      )
    ).toEqual(['2026-10-2', '2026-9-24', '2025-12-31']);
    const same = [
      { id: 'b', name: '09-24' },
      { id: 'a', name: '9-24' },
    ];
    for (const mode of ['name-asc', 'name-desc'] as const)
      expect(
        sortFolderChildren(same, mode, child => child.name).map(
          child => child.id
        )
      ).toEqual(['a', 'b']);
  });

  test.each([
    ['weeks', ['第一周', '第二周', '第三周', '第九周', '第十周', '第十一周']],
    ['chapter prefixes', ['一、准备', '二、执行', '十、总结', '十一、附录']],
    ['period prefixes', ['一. 准备', '二. 执行', '十. 总结']],
    ['Chinese parentheses', ['（一）概述', '（二）进展', '（十）计划']],
    ['ASCII parentheses', ['(一) 概述', '(二) 进展', '(十) 计划']],
    [
      'mixed week numbers',
      ['第一周', '第 2 周', '第三周', '第10周', '第十一周'],
    ],
    [
      'mixed parentheses',
      ['（一）概述', '(2) 进展', '（三）记录', '(十) 计划'],
    ],
    ['mixed prefixes', ['一、准备', '2、执行', '三、记录', '10、总结']],
    ['suffixes', ['第一周会议记录', '第二周会议记录', '第十周会议记录']],
    [
      'embedded ordinals',
      ['项目第一期汇报', '项目第二期汇报', '项目第十期汇报'],
    ],
    ['multiple ordinals', ['第一章第二节', '第一章第十节', '第二章第一节']],
    ['spaces', ['  （ 一 ）概述', '  ( 二 )进展', '  （ 十 ）计划']],
  ])('sorts %s numerically in both directions', (_label, ordered) => {
    const input = [...ordered].reverse().map(name => ({ id: name, name }));
    expect(
      sortFolderChildren(input, 'name-asc', child => child.name).map(
        child => child.name
      )
    ).toEqual(ordered);
    expect(
      sortFolderChildren(input, 'name-desc', child => child.name).map(
        child => child.name
      )
    ).toEqual([...ordered].reverse());
    expect(input.map(child => child.name)).toEqual([...ordered].reverse());
  });

  test.each([
    '周',
    '天',
    '日',
    '月',
    '年',
    '章',
    '节',
    '篇',
    '部分',
    '项',
    '条',
    '次',
    '期',
    '版',
    '集',
    '轮',
  ])('recognizes the ordinal unit %s', unit => {
    const input = ['十', '二', '一'].map(number => ({
      id: `第${number}${unit}`,
    }));
    expect(
      sortFolderChildren(input, 'name-asc', child => child.id).map(
        child => child.id
      )
    ).toEqual([`第一${unit}`, `第二${unit}`, `第十${unit}`]);
  });

  test('handles zero, tens, hundreds, thousands and numeral variants', () => {
    const ordinals = [
      '零',
      '两',
      '十',
      '十一',
      '二十',
      '九十九',
      '一百',
      '一百〇二',
      '一百一十',
      '两百',
      '一千',
      '一千零二',
      '一千零一十',
      '一千一百',
      '一千一百一十',
      '九千九百九十九',
    ];
    const input = [...ordinals]
      .reverse()
      .map(number => ({ id: `第${number}项` }));
    expect(
      sortFolderChildren(input, 'name-asc', child => child.id).map(
        child => child.id
      )
    ).toEqual(ordinals.map(number => `第${number}项`));
  });

  test('keeps ordinary Chinese names and unsupported notation in pinyin order', () => {
    const input = [
      '一心一意',
      '三人行',
      '北京',
      '广州',
      '上海',
      '一',
      '二',
      '三',
      '2',
      '第一性原理',
      '第二产业',
      '总结（一）',
      '总结（二）',
      '总结一、',
      '总结二、',
      '(一）',
      '（二)',
      '一-准备',
      '二-执行',
      '一 准备',
      '二 执行',
      '第百周',
      '第十百周',
      '第一百二周',
      '第〇一周',
      '第二〇二六年',
      '第1二周',
      '第一万周',
      '（一二）记录',
      '一二、记录',
    ].map(id => ({ id }));
    const pinyin = new Intl.Collator('zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base',
    });
    for (const mode of ['name-asc', 'name-desc'] as const) {
      const direction = mode === 'name-desc' ? -1 : 1;
      expect(sortFolderChildren(input, mode, child => child.id)).toEqual(
        [...input].sort((a, b) => pinyin.compare(a.id, b.id) * direction)
      );
    }
  });

  test('uses the original spelling then stable IDs for equal ordinal values', () => {
    const input = [
      { id: 'b', name: '第二周' },
      { id: 'c', name: '第2周' },
      { id: 'a', name: '第二周' },
      { id: 'd', name: '第两周' },
    ];
    const pinyin = new Intl.Collator('zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base',
    });
    for (const mode of ['name-asc', 'name-desc'] as const) {
      const direction = mode === 'name-desc' ? -1 : 1;
      expect(sortFolderChildren(input, mode, child => child.name)).toEqual(
        [...input].sort(
          (a, b) =>
            pinyin.compare(a.name, b.name) * direction || (a.id < b.id ? -1 : 1)
        )
      );
    }
  });

  test('preserves manual order without interpreting names', () => {
    const input = ['第十周', '第二周', '第一周'].map(id => ({ id }));
    expect(
      sortFolderChildren(input, 'manual', () => {
        throw new Error('Manual order must not resolve names');
      })
    ).toEqual(input);
  });

  test('a drag preserves the other items in the displayed order', () => {
    expect(
      moveFolderChild(['10-2', '9-24', '9-23', '9-9'], '9-9', '9-24', 'before')
    ).toEqual(['10-2', '9-9', '9-24', '9-23']);
    expect(moveFolderChild(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(() => moveFolderChild(['a', 'b'], 'missing', 'a', 'before')).toThrow(
      /Folder changed/
    );
  });
});
