import { Button } from '@affine/component';
import type {
  ReportSelection,
  ReportState,
} from '@affine/core/modules/project-reports/contracts';
import type { ReportDocument, ReportTemplate } from '@localmind/office/report';

import { Field, SelectField, TextField, useReportText } from './fields';
import * as styles from './reports.css';

export function reportRecipientLabels(
  recipients: string[],
  members: NonNullable<ReportState['members']>,
  unavailableLabel: string
) {
  return recipients.map(
    (id, index) =>
      members.find(member => member.id === id)?.name ||
      (id.includes('@') ? id : `${unavailableLabel} ${index + 1}`)
  );
}

export function MemberRecipients({
  value,
  members,
  onChange,
  disabled,
}: {
  value: string[];
  members: NonNullable<ReportState['members']>;
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const t = useReportText();
  const unknown = value.filter(id => !members.some(member => member.id === id));
  return (
    <Field label={t('memberRecipients')}>
      <select
        className={styles.input}
        multiple
        disabled={disabled}
        value={value}
        onChange={event =>
          onChange(
            Array.from(event.target.selectedOptions, option => option.value)
          )
        }
      >
        {members.map(member => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
        {unknown.map((id, index) => (
          <option key={id} value={id}>
            {t('externalAccount')} {index + 1}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SourceSelection({
  value,
  resources,
  onChange,
  disabled,
  limited,
}: {
  value: ReportSelection;
  resources: NonNullable<ReportState['resources']>;
  onChange: (value: ReportSelection) => void;
  disabled?: boolean;
  limited?: boolean;
}) {
  const t = useReportText();
  return (
    <div className={styles.stack}>
      <SelectField
        label={t('sourceScope')}
        disabled={disabled}
        value={value.kind}
        options={(['all', 'folders', 'resources'] as const).map(kind => ({
          value: kind,
          label: t(kind),
        }))}
        onChange={kind =>
          onChange(
            kind === 'all'
              ? { kind }
              : kind === 'folders'
                ? { kind, folderIds: [] }
                : { kind, resourceIds: [] }
          )
        }
      />
      {value.kind !== 'all' && (
        <Field label={t('selectedSources')}>
          <select
            className={styles.input}
            multiple
            disabled={disabled}
            value={
              value.kind === 'folders' ? value.folderIds : value.resourceIds
            }
            onChange={event => {
              const ids = Array.from(
                event.target.selectedOptions,
                option => option.value
              );
              onChange(
                value.kind === 'folders'
                  ? { kind: 'folders', folderIds: ids }
                  : { kind: 'resources', resourceIds: ids }
              );
            }}
          >
            {resources
              .filter(resource =>
                value.kind === 'folders'
                  ? resource.kind === 'folder'
                  : resource.kind !== 'folder'
              )
              .map(resource => (
                <option key={resource.id} value={resource.id}>
                  {resource.title}
                </option>
              ))}
          </select>
        </Field>
      )}
      <p className={styles.muted}>{t('documentsOnly')}</p>
      {limited && (
        <p role="status" className={styles.muted}>
          {t('sourceListLimited')}
        </p>
      )}
    </div>
  );
}

export function ThemeEditor({
  value,
  onChange,
  disabled,
}: {
  value: ReportDocument['theme'];
  onChange: (value: ReportDocument['theme']) => void;
  disabled?: boolean;
}) {
  const t = useReportText();
  return (
    <div className={styles.formGrid}>
      <TextField
        label={t('themeName')}
        value={value.name}
        disabled={disabled}
        onChange={name => onChange({ ...value, name })}
      />
      <SelectField
        label={t('aspectRatio')}
        value={value.aspectRatio}
        disabled={disabled}
        options={['16:9', '4:3'].map(value => ({
          value: value as '16:9' | '4:3',
          label: value,
        }))}
        onChange={aspectRatio => onChange({ ...value, aspectRatio })}
      />
      {(['background', 'foreground', 'accent'] as const).map(key => (
        <TextField
          key={key}
          label={t(key)}
          type="color"
          disabled={disabled}
          value={value[key]}
          onChange={color => onChange({ ...value, [key]: color })}
        />
      ))}
      <SelectField
        label={t('font')}
        value={value.fontFamily}
        disabled={disabled}
        options={(['sans', 'serif'] as const).map(value => ({
          value,
          label: t(value),
        }))}
        onChange={fontFamily => onChange({ ...value, fontFamily })}
      />
    </div>
  );
}

export function TemplateContentEditor({
  value,
  onChange,
  disabled,
}: {
  value: ReportTemplate;
  onChange: (value: ReportTemplate) => void;
  disabled?: boolean;
}) {
  const t = useReportText();
  return (
    <div className={styles.stack}>
      <div className={styles.formGrid}>
        <TextField
          label={t('templateName')}
          disabled={disabled}
          value={value.name}
          onChange={name => onChange({ ...value, name })}
        />
        <SelectField
          label={t('audience')}
          value={value.audience}
          disabled={disabled}
          options={(['management', 'customer', 'team'] as const).map(value => ({
            value,
            label: t(value),
          }))}
          onChange={audience => onChange({ ...value, audience })}
        />
        <SelectField
          label={t('language')}
          value={value.language}
          disabled={disabled}
          options={['zh-Hans', 'zh-Hant', 'en'].map(value => ({
            value: value as ReportTemplate['language'],
            label: value,
          }))}
          onChange={language => onChange({ ...value, language })}
        />
        <TextField
          label={t('durationMinutes')}
          type="number"
          value={String(value.durationMinutes)}
          disabled={disabled}
          onChange={duration =>
            onChange({ ...value, durationMinutes: Number(duration) })
          }
        />
      </div>
      <TextField
        label={t('defaultPrompt')}
        multiline
        value={value.prompt}
        disabled={disabled}
        onChange={prompt => onChange({ ...value, prompt })}
      />
      <ThemeEditor
        value={value.theme}
        disabled={disabled}
        onChange={theme => onChange({ ...value, theme })}
      />
      {value.chapters.map((chapter, index) => (
        <section className={styles.node} key={chapter.key}>
          <TextField
            label={t('chapterTitle')}
            value={chapter.title}
            disabled={disabled}
            onChange={title =>
              onChange({
                ...value,
                chapters: value.chapters.map((old, i) =>
                  i === index ? { ...old, title } : old
                ),
              })
            }
          />
          <TextField
            label={t('requiredQuestion')}
            multiline
            value={chapter.question}
            disabled={disabled}
            onChange={question =>
              onChange({
                ...value,
                chapters: value.chapters.map((old, i) =>
                  i === index ? { ...old, question } : old
                ),
              })
            }
          />
          <SelectField
            label={t('layout')}
            value={chapter.layout}
            disabled={disabled}
            options={(
              ['content', 'cover', 'comparison', 'timeline', 'gallery'] as const
            ).map(value => ({ value, label: t(value) }))}
            onChange={layout =>
              onChange({
                ...value,
                chapters: value.chapters.map((old, i) =>
                  i === index ? { ...old, layout } : old
                ),
              })
            }
          />
          <div className={styles.row}>
            <Button
              disabled={disabled || index === 0}
              onClick={() => {
                const chapters = [...value.chapters];
                [chapters[index - 1], chapters[index]] = [
                  chapters[index],
                  chapters[index - 1],
                ];
                onChange({ ...value, chapters });
              }}
            >
              {t('moveUp')}
            </Button>
            <Button
              disabled={disabled || value.chapters.length === 1}
              onClick={() =>
                onChange({
                  ...value,
                  chapters: value.chapters.filter((_, i) => i !== index),
                })
              }
            >
              {t('removeChapter')}
            </Button>
          </div>
        </section>
      ))}
      <Button
        disabled={disabled || value.chapters.length >= 60}
        onClick={() =>
          onChange({
            ...value,
            chapters: [
              ...value.chapters,
              {
                key: crypto.randomUUID(),
                title: t('newChapter'),
                question: '',
                layout: 'content',
              },
            ],
          })
        }
      >
        {t('addChapter')}
      </Button>
    </div>
  );
}

export function localDateTime(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
}

/** Convert the user's explicit wall time without using the server or browser time zone. */
export function zonedDateTime(value: string, timeZone: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) throw new Error('Invalid report date');
  const target = Date.UTC(
    ...([
      Number(parts[1]),
      Number(parts[2]) - 1,
      Number(parts[3]),
      Number(parts[4]),
      Number(parts[5]),
    ] as [number, number, number, number, number])
  );
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const wall = (stamp: number) => {
    const values = Object.fromEntries(
      format.formatToParts(stamp).map(part => [part.type, part.value])
    );
    return Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute)
    );
  };
  let result = target;
  for (let attempt = 0; attempt < 4; attempt++) result += target - wall(result);
  if (wall(result) !== target)
    throw new Error('The selected local time does not exist');
  return new Date(result).toISOString();
}
