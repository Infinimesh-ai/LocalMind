import { Modal } from '@affine/component';
import type { XlsxSemanticState } from '@affine/core/modules/office';
import { useI18n } from '@affine/i18n';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  type WorkbookChart,
  workbookChartData,
} from './spreadsheet-chart-data';
import * as styles from './surface.css';

const colors = [
  '#315f8c',
  '#b45309',
  '#166534',
  '#9d174d',
  '#6d28d9',
  '#0e7490',
];

export function SpreadsheetChart({
  state,
  sheet,
  chart,
  onClose,
}: {
  state: XlsxSemanticState;
  sheet: XlsxSemanticState['sheets'][number];
  chart: WorkbookChart;
  onClose: () => void;
}) {
  const i18n = useI18n();
  const data = workbookChartData(state, sheet, chart);
  const horizontal = chart.type === 'bar';
  const type =
    chart.type === 'unknown'
      ? i18n['com.affine.office.chart']()
      : i18n[`com.affine.office.${chart.type}`]();
  const title = `${chart.title || i18n['com.affine.office.chart']()} · ${type}`;
  const axes = [
    <CartesianGrid key="grid" strokeDasharray="3 3" />,
    <XAxis
      key="x"
      type={horizontal ? 'number' : 'category'}
      dataKey={horizontal ? undefined : 'category'}
    />,
    <YAxis
      key="y"
      type={horizontal ? 'category' : 'number'}
      dataKey={horizontal ? 'category' : undefined}
      width={80}
    />,
    <Tooltip key="tooltip" />,
    <Legend key="legend" />,
  ];
  return (
    <Modal
      open
      title={title}
      width={760}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      {data ? (
        <>
          <div className={styles.workbookChart} role="img" aria-label={title}>
            <ResponsiveContainer width="100%" height="100%">
              {chart.type === 'pie' ? (
                <PieChart>
                  <Tooltip />
                  <Legend />
                  <Pie
                    data={data.rows.map(row => ({
                      category: row.category,
                      value: row.values[0],
                    }))}
                    dataKey="value"
                    nameKey="category"
                    isAnimationActive={false}
                  >
                    {data.rows.map((_, i) => (
                      <Cell key={i} fill={colors[i % colors.length]} />
                    ))}
                  </Pie>
                </PieChart>
              ) : chart.type === 'line' ? (
                <LineChart data={data.rows}>
                  {axes}
                  {data.names.map((name, i) => (
                    <Line
                      key={i}
                      name={name}
                      dataKey={(row: { values: (number | null)[] }) =>
                        row.values[i]
                      }
                      stroke={colors[i % colors.length]}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart
                  data={data.rows}
                  layout={horizontal ? 'vertical' : 'horizontal'}
                >
                  {axes}
                  {data.names.map((name, i) => (
                    <Bar
                      key={i}
                      name={name}
                      dataKey={(row: { values: (number | null)[] }) =>
                        row.values[i]
                      }
                      fill={colors[i % colors.length]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          <div className={styles.workbookChartData}>
            <table>
              <thead>
                <tr>
                  <th>{i18n['com.affine.office.chart-category']()}</th>
                  {data.names.map((name, i) => (
                    <th key={i}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i}>
                    <th>{row.category}</th>
                    {row.values.map((value, j) => (
                      <td key={j}>{value ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p role="status">
          {i18n['com.affine.office.chart-preview-unsupported']()}
        </p>
      )}
    </Modal>
  );
}
