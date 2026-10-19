import type {
  RenderReportNode,
  ReportPage,
} from '@affine/core/modules/project-reports/presentation';
import {
  type ReportDocument,
  reportSlideBackgroundAssetId,
} from '@localmind/office/report';
import type { CSSProperties, ReactNode } from 'react';

import { useReportText } from './fields';
import * as styles from './reports.css';

function ReportChart({
  node,
}: {
  node: Extract<RenderReportNode, { type: 'chart' }>;
}) {
  const t = useReportText();
  const values = node.series
    .flatMap(series => series.values)
    .filter((value): value is number => value !== null);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const span = max - min || 1;
  const x = (index: number) => 50 + (index + 0.5) * (700 / node.labels.length);
  const y = (value: number) => 250 - ((value - min) / span) * 210;
  const colors = [
    '#315f8c',
    '#ae5a27',
    '#427a5a',
    '#80589a',
    '#946700',
    '#387d84',
  ];
  const pie = node.chartType === 'pie' || node.chartType === 'donut';
  const total = node.series[0].values.reduce<number>(
    (sum, value) => sum + Math.max(0, value ?? 0),
    0
  );
  let accumulated = 0;
  return (
    <figure style={{ margin: 0 }}>
      <figcaption>
        {node.title} · {node.unit}
      </figcaption>
      <svg
        viewBox="0 0 800 300"
        role="img"
        aria-label={node.title}
        style={{ width: '100%', maxHeight: 320 }}
      >
        {pie ? (
          node.series[0].values.map((value, index) => {
            if (value === null || value <= 0 || !total) return null;
            const start = (accumulated / total) * Math.PI * 2;
            accumulated += value;
            const end = (accumulated / total) * Math.PI * 2;
            const sx = 400 + 110 * Math.sin(start);
            const sy = 145 - 110 * Math.cos(start);
            const ex = 400 + 110 * Math.sin(end);
            const ey = 145 - 110 * Math.cos(end);
            return value === total ? (
              <circle
                key={index}
                cx={400}
                cy={145}
                r={110}
                fill={colors[index % colors.length]}
              />
            ) : (
              <path
                key={index}
                d={`M400 145 L${sx} ${sy} A110 110 0 ${end - start > Math.PI ? 1 : 0} 1 ${ex} ${ey} Z`}
                fill={colors[index % colors.length]}
              />
            );
          })
        ) : (
          <>
            <line x1={50} x2={750} y1={y(0)} y2={y(0)} stroke="currentColor" />
            {node.series.map((series, seriesIndex) =>
              node.chartType === 'line' ? (
                <g key={seriesIndex}>
                  {series.values.map((value, index) =>
                    value === null ? null : (
                      <g key={index}>
                        {index > 0 && series.values[index - 1] !== null && (
                          <line
                            x1={x(index - 1)}
                            y1={y(series.values[index - 1] ?? 0)}
                            x2={x(index)}
                            y2={y(value)}
                            stroke={colors[seriesIndex % colors.length]}
                            strokeWidth={3}
                          />
                        )}
                        <circle
                          cx={x(index)}
                          cy={y(value)}
                          r={4}
                          fill={colors[seriesIndex % colors.length]}
                        />
                      </g>
                    )
                  )}
                </g>
              ) : (
                <g key={seriesIndex}>
                  {series.values.map((value, index) =>
                    value === null ? null : (
                      <rect
                        key={index}
                        x={
                          x(index) -
                          250 / node.labels.length +
                          (seriesIndex * 500) /
                            node.labels.length /
                            node.series.length
                        }
                        y={Math.min(y(0), y(value))}
                        width={Math.max(
                          1,
                          480 / node.labels.length / node.series.length
                        )}
                        height={Math.abs(y(value) - y(0)) || 1}
                        fill={colors[seriesIndex % colors.length]}
                      />
                    )
                  )}
                </g>
              )
            )}
            {node.labels.map((label, index) => (
              <text
                key={index}
                x={x(index)}
                y={280}
                textAnchor="middle"
                fill="currentColor"
                fontSize={14}
              >
                {label.slice(0, 16)}
              </text>
            ))}
          </>
        )}
        {node.chartType === 'donut' && (
          <circle cx={400} cy={145} r={58} fill="var(--report-background)" />
        )}
      </svg>
      <details>
        <summary>{t('dataTable')}</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('label')}</th>
              {node.series.map((series, index) => (
                <th key={index}>{series.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.labels.map((label, index) => (
              <tr key={index}>
                <th>{label}</th>
                {node.series.map((series, i) => (
                  <td key={i}>{series.values[index] ?? t('notRecorded')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p>{node.methodology}</p>
      </details>
    </figure>
  );
}

const emptyAssetUrls: Record<string, string> = {};

export function ReportNodeView({
  node,
  assetUrls = emptyAssetUrls,
}: {
  node: RenderReportNode;
  assetUrls?: Record<string, string>;
}) {
  const t = useReportText();
  let content;
  switch (node.type) {
    case 'heading':
      content =
        node.level === '1' ? <h2>{node.text}</h2> : <h3>{node.text}</h3>;
      break;
    case 'paragraph':
      content = <p>{node.text}</p>;
      break;
    case 'callout':
      content = (
        <aside className={styles.callout}>
          <strong>{t(node.tone)}</strong>
          <p>{node.text}</p>
        </aside>
      );
      break;
    case 'list':
      content = node.ordered ? (
        <ol>
          {node.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul>
          {node.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
      break;
    case 'table':
      content = (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {node.columns.map((column, i) => (
                  <th key={i}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      break;
    case 'metric':
      content = (
        <dl className={styles.metric}>
          <dt>{node.label}</dt>
          <dd>
            <strong>{node.value ?? t('notRecorded')}</strong> {node.unit}
          </dd>
          <dd>{node.formula}</dd>
          {node.exclusions && <dd>{node.exclusions}</dd>}
        </dl>
      );
      break;
    case 'timeline':
      content = (
        <ol className={styles.timeline}>
          {node.entries.map((entry, i) => (
            <li key={i}>
              <strong>
                {entry.date} · {entry.title}
              </strong>{' '}
              — {t(entry.status)}
              <p>{entry.detail}</p>
            </li>
          ))}
        </ol>
      );
      break;
    case 'image':
      content = (
        <figure>
          {assetUrls[node.assetId] ? (
            <img src={assetUrls[node.assetId]} alt={node.alt} />
          ) : (
            <p role="status">{t('imageUnavailable')}</p>
          )}
          <figcaption>{node.caption}</figcaption>
        </figure>
      );
      break;
    case 'chart':
      content = <ReportChart node={node} />;
      break;
    case 'pageBreak':
      return null;
  }
  const responsible = node.responsibility;
  const label =
    responsible &&
    ('identity' in responsible
      ? responsible.identity.label
      : responsible.label);
  const defaulted =
    responsible &&
    ('origin' in responsible
      ? responsible.origin === 'creator_fallback'
      : responsible.defaulted);
  return (
    <div>
      {content}
      {node.claimKind === 'inference' && (
        <small>{t('suggestedAttention')}</small>
      )}
      {label && (
        <small>
          {t('responsible')}: {label}
          {defaulted ? ` · ${t('default')}` : ''}
        </small>
      )}
      {'sources' in node && node.sources.length > 0 && (
        <small> · {node.sources.join(', ')}</small>
      )}
    </div>
  );
}

export function ReportSlide({
  page,
  theme,
  assetUrls,
  kicker,
  footer,
  emptyLabel,
  renderNode,
}: {
  page: ReportPage;
  theme: ReportDocument['theme'];
  assetUrls?: Record<string, string>;
  kicker?: string;
  footer?: ReactNode;
  emptyLabel?: string;
  renderNode?: (node: RenderReportNode, content: ReactNode) => ReactNode;
}) {
  const backgroundId = reportSlideBackgroundAssetId(theme, page.layout);
  const background = backgroundId ? assetUrls?.[backgroundId] : undefined;
  return (
    <article
      className={styles.slide}
      data-layout={page.layout}
      style={
        {
          '--report-background': theme.background,
          '--report-foreground': theme.foreground,
          '--report-accent': theme.accent,
          '--report-font':
            theme.fontFamily === 'serif'
              ? 'Georgia, serif'
              : 'var(--affine-font-family)',
          aspectRatio: theme.aspectRatio === '4:3' ? '4 / 3' : '16 / 9',
        } as CSSProperties
      }
    >
      {background && (
        <img className={styles.slideBackground} src={background} alt="" />
      )}
      {theme.logoAssetId && assetUrls?.[theme.logoAssetId] && (
        <img
          className={styles.logo}
          src={assetUrls[theme.logoAssetId]}
          alt=""
        />
      )}
      {kicker && <div className={styles.slideKicker}>{kicker}</div>}
      <h1>{page.title}</h1>
      {page.nodes.length ? (
        <div className={styles.slideContent}>
          {page.nodes.map((node, index) => {
            const content = (
              <ReportNodeView node={node} assetUrls={assetUrls} />
            );
            return (
              <div key={`${node.id}:${index}`}>
                {renderNode ? renderNode(node, content) : content}
              </div>
            );
          })}
        </div>
      ) : emptyLabel ? (
        <div className={styles.slideEmpty}>{emptyLabel}</div>
      ) : null}
      {footer && <div className={styles.slideFooter}>{footer}</div>}
    </article>
  );
}
