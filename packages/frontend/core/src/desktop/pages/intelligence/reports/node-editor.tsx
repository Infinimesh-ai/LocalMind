import { Button } from '@affine/component';
import type {
  ReportDocument,
  ReportNode,
  ReportResponsibility,
} from '@localmind/office/report';

import { Field, SelectField, TextField, useReportText } from './fields';
import * as styles from './reports.css';

export function ResponsibilityEditor({
  value,
  creator,
  members,
  disabled,
  onChange,
}: {
  value: ReportResponsibility | undefined;
  creator: ReportDocument['creator'];
  members: { id: string; name: string }[];
  disabled?: boolean;
  onChange: (value: ReportResponsibility) => void;
}) {
  const t = useReportText();
  const identity = value?.identity;
  return (
    <div className={styles.row}>
      <SelectField
        label={t('responsible')}
        disabled={disabled}
        value={
          value?.origin === 'creator_fallback' || !value
            ? 'default'
            : identity?.kind === 'member'
              ? identity.actorId
              : 'external'
        }
        options={[
          {
            value: 'default',
            label: `${creator.label} · ${t('default')}${members.some(member => member.id === creator.actorId) ? '' : ` · ${t('formerMember')}`}`,
          },
          ...(identity?.kind === 'member' &&
          value?.origin !== 'creator_fallback' &&
          !members.some(member => member.id === identity.actorId)
            ? [
                {
                  value: identity.actorId,
                  label: `${identity.label} · ${t('formerMember')}`,
                  disabled: true,
                },
              ]
            : []),
          ...members.map(member => ({ value: member.id, label: member.name })),
          { value: 'external', label: t('externalPerson') },
        ]}
        onChange={id =>
          onChange(
            id === 'default'
              ? {
                  identity: { kind: 'member', ...creator },
                  origin: 'creator_fallback',
                  sourceIds: [],
                }
              : id === 'external'
                ? {
                    identity: {
                      kind: 'external',
                      label: identity?.label ?? '',
                    },
                    origin: 'manual',
                    sourceIds: [],
                  }
                : {
                    identity: {
                      kind: 'member',
                      actorId: id,
                      label:
                        members.find(member => member.id === id)?.name ?? id,
                    },
                    origin: 'manual',
                    sourceIds: [],
                  }
          )
        }
      />
      {identity?.kind === 'external' && (
        <TextField
          label={t('name')}
          disabled={disabled}
          value={identity.label}
          onChange={label =>
            onChange({
              identity: { kind: 'external', label },
              origin: 'manual',
              sourceIds: [],
            })
          }
        />
      )}
      {value?.origin === 'document' && (
        <span className={styles.muted}>{t('documentAssignment')}</span>
      )}
    </div>
  );
}

export function ReportNodeEditor({
  node,
  document,
  members,
  disabled,
  onChange,
}: {
  node: ReportNode;
  document: ReportDocument;
  members: { id: string; name: string }[];
  disabled: boolean;
  onChange: (node: ReportNode) => void;
}) {
  const t = useReportText();
  const content = (() => {
    switch (node.type) {
      case 'heading':
        return (
          <>
            <SelectField
              label={t('headingLevel')}
              value={node.level}
              disabled={disabled}
              options={['1', '2', '3'].map(value => ({
                value: value as '1' | '2' | '3',
                label: value,
              }))}
              onChange={level => onChange({ ...node, level })}
            />
            <TextField
              label={t('content')}
              disabled={disabled}
              value={node.text}
              onChange={text => onChange({ ...node, text })}
            />
          </>
        );
      case 'paragraph':
        return (
          <TextField
            label={t('content')}
            disabled={disabled}
            multiline
            value={node.text}
            onChange={text => onChange({ ...node, text })}
          />
        );
      case 'callout':
        return (
          <>
            <SelectField
              label={t('tone')}
              value={node.tone}
              disabled={disabled}
              options={(['info', 'risk', 'decision'] as const).map(value => ({
                value,
                label: t(value),
              }))}
              onChange={tone => onChange({ ...node, tone })}
            />
            <TextField
              label={t('content')}
              disabled={disabled}
              multiline
              value={node.text}
              onChange={text => onChange({ ...node, text })}
            />
          </>
        );
      case 'list':
        return (
          <>
            <TextField
              label={t('oneItemPerLine')}
              multiline
              disabled={disabled}
              value={node.items.join('\n')}
              onChange={text => onChange({ ...node, items: text.split('\n') })}
            />
            <label>
              <input
                type="checkbox"
                checked={node.ordered}
                disabled={disabled}
                onChange={event =>
                  onChange({ ...node, ordered: event.target.checked })
                }
              />{' '}
              {t('ordered')}
            </label>
          </>
        );
      case 'table':
        return (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {node.columns.map((column, index) => (
                      <th key={index}>
                        <input
                          aria-label={`${t('column')} ${index + 1}`}
                          className={styles.input}
                          disabled={disabled}
                          value={column}
                          onChange={event =>
                            onChange({
                              ...node,
                              columns: node.columns.map((old, i) =>
                                i === index ? event.target.value : old
                              ),
                            })
                          }
                        />
                        <Button
                          disabled={disabled || node.columns.length === 1}
                          onClick={() =>
                            onChange({
                              ...node,
                              columns: node.columns.filter(
                                (_, i) => i !== index
                              ),
                              rows: node.rows.map(row =>
                                row.filter((_, i) => i !== index)
                              ),
                            })
                          }
                        >
                          {t('removeColumn')}
                        </Button>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {node.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, index) => (
                        <td key={index}>
                          <input
                            className={styles.input}
                            aria-label={`${t('row')} ${rowIndex + 1} ${t('column')} ${index + 1}`}
                            disabled={disabled}
                            value={cell}
                            onChange={event =>
                              onChange({
                                ...node,
                                rows: node.rows.map((old, r) =>
                                  r === rowIndex
                                    ? old.map((text, c) =>
                                        c === index ? event.target.value : text
                                      )
                                    : old
                                ),
                              })
                            }
                          />
                        </td>
                      ))}
                      <td>
                        <Button
                          disabled={disabled}
                          onClick={() =>
                            onChange({
                              ...node,
                              rows: node.rows.filter((_, r) => r !== rowIndex),
                            })
                          }
                        >
                          {t('removeRow')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.row}>
              <Button
                disabled={disabled || node.rows.length >= 200}
                onClick={() =>
                  onChange({
                    ...node,
                    rows: [...node.rows, node.columns.map(() => '')],
                  })
                }
              >
                {t('addRow')}
              </Button>
              <Button
                disabled={disabled || node.columns.length >= 20}
                onClick={() =>
                  onChange({
                    ...node,
                    columns: [...node.columns, ''],
                    rows: node.rows.map(row => [...row, '']),
                  })
                }
              >
                {t('addColumn')}
              </Button>
            </div>
          </>
        );
      case 'metric':
        return (
          <>
            <div className={styles.formGrid}>
              <TextField
                label={t('label')}
                disabled={disabled}
                value={node.label}
                onChange={label => onChange({ ...node, label })}
              />
              <TextField
                label={t('value')}
                type="number"
                disabled={disabled || node.claimKind === 'calculation'}
                value={node.value === null ? '' : String(node.value)}
                onChange={value =>
                  onChange({
                    ...node,
                    value: value === '' ? null : Number(value),
                  })
                }
              />
              <TextField
                label={t('unit')}
                disabled={disabled}
                value={node.unit}
                onChange={unit => onChange({ ...node, unit })}
              />
              <TextField
                label={t('formula')}
                disabled={disabled}
                value={node.formula}
                onChange={formula => onChange({ ...node, formula })}
              />
            </div>
            <TextField
              label={t('exclusions')}
              disabled={disabled}
              value={node.exclusions}
              onChange={exclusions => onChange({ ...node, exclusions })}
            />
            {node.calculation && (
              <p className={styles.muted}>
                {node.calculation.kind === 'ratio'
                  ? `${node.calculation.numerator} / ${node.calculation.denominator} × ${node.calculation.scale}`
                  : node.calculation.values.join(' + ')}
              </p>
            )}
          </>
        );
      case 'timeline':
        return (
          <>
            {node.entries.map((entry, index) => (
              <div key={index} className={styles.node}>
                <div className={styles.formGrid}>
                  <TextField
                    label={t('date')}
                    value={entry.date}
                    disabled={disabled}
                    onChange={date =>
                      onChange({
                        ...node,
                        entries: node.entries.map((old, i) =>
                          i === index ? { ...old, date } : old
                        ),
                      })
                    }
                  />
                  <TextField
                    label={t('title')}
                    value={entry.title}
                    disabled={disabled}
                    onChange={title =>
                      onChange({
                        ...node,
                        entries: node.entries.map((old, i) =>
                          i === index ? { ...old, title } : old
                        ),
                      })
                    }
                  />
                  <SelectField
                    label={t('status')}
                    value={entry.status}
                    disabled={disabled}
                    options={(
                      [
                        'planned',
                        'in_progress',
                        'completed',
                        'blocked',
                        'unknown',
                      ] as const
                    ).map(value => ({ value, label: t(value) }))}
                    onChange={status =>
                      onChange({
                        ...node,
                        entries: node.entries.map((old, i) =>
                          i === index ? { ...old, status } : old
                        ),
                      })
                    }
                  />
                </div>
                <TextField
                  label={t('detail')}
                  multiline
                  value={entry.detail}
                  disabled={disabled}
                  onChange={detail =>
                    onChange({
                      ...node,
                      entries: node.entries.map((old, i) =>
                        i === index ? { ...old, detail } : old
                      ),
                    })
                  }
                />
                <Button
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...node,
                      entries: node.entries.filter((_, i) => i !== index),
                    })
                  }
                >
                  {t('remove')}
                </Button>
              </div>
            ))}
            <Button
              disabled={disabled || node.entries.length >= 100}
              onClick={() =>
                onChange({
                  ...node,
                  entries: [
                    ...node.entries,
                    { date: '', title: '', detail: '', status: 'unknown' },
                  ],
                })
              }
            >
              {t('addEntry')}
            </Button>
          </>
        );
      case 'image':
        return (
          <>
            <SelectField
              label={t('image')}
              value={node.assetId}
              disabled={disabled}
              options={[
                { value: 'unselected', label: t('selectImage') },
                ...document.assets.map(asset => ({
                  value: asset.id,
                  label: asset.alt || asset.id,
                })),
              ]}
              onChange={assetId => onChange({ ...node, assetId })}
            />
            <TextField
              label={t('altText')}
              value={node.alt}
              disabled={disabled}
              onChange={alt => onChange({ ...node, alt })}
            />
            <TextField
              label={t('caption')}
              value={node.caption}
              disabled={disabled}
              onChange={caption => onChange({ ...node, caption })}
            />
          </>
        );
      case 'chart':
        return (
          <>
            <div className={styles.formGrid}>
              <TextField
                label={t('title')}
                value={node.title}
                disabled={disabled}
                onChange={title => onChange({ ...node, title })}
              />
              <SelectField
                label={t('chartType')}
                value={node.chartType}
                disabled={disabled}
                options={(
                  ['bar', 'line', 'pie', 'donut', 'target'] as const
                ).map(value => ({ value, label: t(value) }))}
                onChange={chartType => onChange({ ...node, chartType })}
              />
            </div>
            <TextField
              label={t('categories')}
              multiline
              value={node.labels.join('\n')}
              disabled={disabled}
              onChange={text => {
                const labels = text.split('\n');
                onChange({
                  ...node,
                  labels,
                  series: node.series.map(series => ({
                    ...series,
                    values: labels.map((_, i) => series.values[i] ?? null),
                  })),
                });
              }}
            />
            {node.series.map((series, index) => (
              <div className={styles.formGrid} key={index}>
                <TextField
                  label={t('series')}
                  value={series.label}
                  disabled={disabled}
                  onChange={label =>
                    onChange({
                      ...node,
                      series: node.series.map((old, i) =>
                        i === index ? { ...old, label } : old
                      ),
                    })
                  }
                />
                <TextField
                  label={t('seriesValues')}
                  value={series.values.map(value => value ?? '').join(',')}
                  disabled={disabled}
                  onChange={text => {
                    const values = text
                      .split(',')
                      .map(value =>
                        value.trim() === '' ? null : Number(value)
                      );
                    if (
                      values.some(
                        value => value !== null && !Number.isFinite(value)
                      )
                    )
                      return;
                    onChange({
                      ...node,
                      series: node.series.map((old, i) =>
                        i === index
                          ? {
                              ...old,
                              values: node.labels.map(
                                (_, n) => values[n] ?? null
                              ),
                            }
                          : old
                      ),
                    });
                  }}
                />
              </div>
            ))}
            <div className={styles.row}>
              <Button
                disabled={disabled || node.series.length >= 12}
                onClick={() =>
                  onChange({
                    ...node,
                    series: [
                      ...node.series,
                      { label: '', values: node.labels.map(() => null) },
                    ],
                  })
                }
              >
                {t('addSeries')}
              </Button>
              <Button
                disabled={disabled || node.series.length <= 1}
                onClick={() =>
                  onChange({ ...node, series: node.series.slice(0, -1) })
                }
              >
                {t('removeSeries')}
              </Button>
            </div>
            <TextField
              label={t('unit')}
              value={node.unit}
              disabled={disabled}
              onChange={unit => onChange({ ...node, unit })}
            />
            <TextField
              label={t('methodology')}
              multiline
              value={node.methodology}
              disabled={disabled}
              onChange={methodology => onChange({ ...node, methodology })}
            />
          </>
        );
      case 'pageBreak':
        return <p>{t('pageBreak')}</p>;
    }
  })();
  return (
    <div className={styles.stack}>
      {content}
      {node.type !== 'pageBreak' && (
        <>
          <ResponsibilityEditor
            value={node.responsibility}
            creator={document.creator}
            members={members}
            disabled={disabled}
            onChange={responsibility => onChange({ ...node, responsibility })}
          />
          <Field label={t('sources')}>
            <select
              className={styles.input}
              multiple
              value={node.sourceIds}
              disabled={disabled}
              onChange={event =>
                onChange({
                  ...node,
                  sourceIds: Array.from(
                    event.target.selectedOptions,
                    option => option.value
                  ),
                })
              }
            >
              {document.sources.map(source => (
                <option key={source.id} value={source.id}>
                  {source.title} · {source.revision}
                </option>
              ))}
            </select>
          </Field>
          <span className={styles.muted}>{t(node.claimKind)}</span>
        </>
      )}
    </div>
  );
}
