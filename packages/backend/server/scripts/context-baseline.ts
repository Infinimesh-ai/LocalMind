import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';

import {
  countPromptTokensNative,
  renderPromptSessionNative,
} from '../src/plugins/copilot/prompt/native-contract';
import type { PromptMessage } from '../src/plugins/copilot/providers/types';
import {
  CANDIDATE_CONTEXT_PLANNER_STRATEGY_VERSION,
  CONTEXT_PLANNER_STRATEGY_VERSION,
  ContextPlanner,
  type ContextPlannerMemory,
  type ContextPlannerStrategyVersion,
  LEGACY_CONTEXT_PLANNER_STRATEGY_VERSION,
  PREVIOUS_CONTEXT_PLANNER_STRATEGY_VERSION,
  SYSTEM_CONTEXT_PLANNER_STRATEGY_VERSION,
  UNTRUSTED_CONTEXT_PLANNER_STRATEGY_VERSION,
} from '../src/plugins/copilot/runtime/context-planner';

const BASELINE_VERSION = 'context-baseline/v1';
const TOKENIZER_MODEL = 'gpt-4';
const DEFAULT_ITERATIONS = 2_000;
const DEFAULT_OUTPUT = 'tmp/context-baseline/latest.json';

type BaselineScenario = {
  id: string;
  description: string;
  turns: PromptMessage[];
  maxTokenSize: number;
  markers: Array<{
    id: string;
    value: string;
    category: 'required' | 'recent' | 'cross_session';
  }>;
  memories?: ContextPlannerMemory[];
};

type ScenarioResult = {
  id: string;
  description: string;
  inputMessages: number;
  retainedMessages: number;
  messageRetentionRate: number;
  markerResults: Array<{
    id: string;
    category: 'required' | 'recent' | 'cross_session';
    retained: boolean;
  }>;
  automaticSummaryCheckpoint: boolean;
};

type BenchmarkResult = {
  iterations: number;
  meanMicros: number;
  p50Micros: number;
  p95Micros: number;
  p99Micros: number;
  operationsPerSecond: number;
};

function round(value: number, digits = 4) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function percentile(sorted: number[], value: number) {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(value * sorted.length) - 1)
  );
  return sorted[index];
}

function countTokens(messages: Pick<PromptMessage, 'content'>[]) {
  return countPromptTokensNative({
    model: TOKENIZER_MODEL,
    messages,
  }).tokens;
}

function promptMessage(role: PromptMessage['role'], content: string) {
  return { role, content } satisfies PromptMessage;
}

function padding(label: string, words = 40) {
  return `${label} ${Array.from({ length: words }, () => 'context').join(' ')}`;
}

const promptMessages = [
  promptMessage('system', 'Answer using only the available conversation.'),
];
const promptTokens = countTokens(promptMessages);

function render(turns: PromptMessage[], maxTokenSize: number) {
  return renderPromptSessionNative({
    prompt: {
      model: TOKENIZER_MODEL,
      promptTokens,
      templateParams: {},
      messages: promptMessages,
    },
    turns,
    renderParams: {},
    maxTokenSize,
  }).messages;
}

const planner = new ContextPlanner();

function plan(
  scenario: BaselineScenario,
  strategyVersion: ContextPlannerStrategyVersion
) {
  return planner.plan(
    {
      turns: scenario.turns,
      memories: scenario.memories,
      render: turns => render(turns, scenario.maxTokenSize),
    },
    strategyVersion
  );
}

function buildScenarios(): BaselineScenario[] {
  const shortTurns = [
    promptMessage('user', 'SHORT_1 Define the release goal.'),
    promptMessage('assistant', 'SHORT_2 The goal is a reliable release.'),
    promptMessage('user', 'SHORT_3 Use PostgreSQL for persistence.'),
    promptMessage('assistant', 'SHORT_4 PostgreSQL is selected.'),
    promptMessage('user', 'SHORT_5 Summarize the current decisions.'),
    promptMessage('assistant', 'SHORT_6 The release prioritizes reliability.'),
  ];
  const shortBudget = promptTokens + countTokens(shortTurns) + 16;

  const longTurns: PromptMessage[] = [
    promptMessage(
      'user',
      `EARLY_REQUIRED_FACT The deployment region is eu-west-1. ${padding(
        'Initial deployment context'
      )}`
    ),
    promptMessage('assistant', padding('Acknowledged the deployment region')),
  ];
  for (let index = 0; index < 12; index++) {
    longTurns.push(
      promptMessage('user', padding(`Intermediate user turn ${index}`)),
      promptMessage(
        'assistant',
        padding(`Intermediate assistant turn ${index}`)
      )
    );
  }
  longTurns.push(
    promptMessage(
      'user',
      'RECENT_REQUIRED_FACT Produce the final deployment checklist now.'
    )
  );
  const retainedTail = longTurns.slice(-6);
  const longBudget = promptTokens + countTokens(retainedTail);

  const sourceSessionTurns = [
    promptMessage(
      'user',
      'CROSS_SESSION_FACT The project codename is Juniper.'
    ),
    promptMessage('assistant', 'I will use Juniper in this conversation.'),
  ];
  const targetSessionTurns = [
    promptMessage('user', 'What is the project codename?'),
  ];
  const crossSessionBudget =
    promptTokens +
    countTokens([...sourceSessionTurns, ...targetSessionTurns]) +
    16;

  return [
    {
      id: 'short-conversation-retention',
      description: 'All messages fit inside the context budget.',
      turns: shortTurns,
      maxTokenSize: shortBudget,
      markers: shortTurns.map((turn, index) => ({
        id: `short-${index + 1}`,
        value: turn.content.split(' ')[0],
        category: 'required',
      })),
    },
    {
      id: 'long-conversation-early-fact',
      description:
        'An early required fact competes with a recent six-message tail.',
      turns: longTurns,
      maxTokenSize: longBudget,
      markers: [
        {
          id: 'early-required-fact',
          value: 'EARLY_REQUIRED_FACT',
          category: 'required',
        },
        {
          id: 'recent-required-fact',
          value: 'RECENT_REQUIRED_FACT',
          category: 'recent',
        },
      ],
    },
    {
      id: 'cross-session-continuity',
      description:
        'The target session uses an authorized memory from the source session.',
      turns: targetSessionTurns,
      maxTokenSize: crossSessionBudget,
      memories: [
        {
          scope: 'workspace',
          kind: 'auto_memory',
          content: sourceSessionTurns[0].content,
        },
      ],
      markers: [
        {
          id: 'cross-session-fact',
          value: 'CROSS_SESSION_FACT',
          category: 'cross_session',
        },
      ],
    },
  ];
}

function evaluateScenario(
  scenario: BaselineScenario,
  strategyVersion: ContextPlannerStrategyVersion
): ScenarioResult {
  const result = plan(scenario, strategyVersion);
  const rendered = result.messages;
  const renderedContent = rendered.map(message => message.content).join('\n');
  const inputContents = new Set(scenario.turns.map(turn => turn.content));
  const retainedMessages = rendered.filter(message =>
    inputContents.has(message.content)
  ).length;

  return {
    id: scenario.id,
    description: scenario.description,
    inputMessages: scenario.turns.length,
    retainedMessages,
    messageRetentionRate: round(retainedMessages / scenario.turns.length),
    markerResults: scenario.markers.map(marker => ({
      id: marker.id,
      category: marker.category,
      retained: renderedContent.includes(marker.value),
    })),
    automaticSummaryCheckpoint: Boolean(result.checkpoint),
  };
}

function benchmark(
  operation: () => unknown,
  iterations: number
): BenchmarkResult {
  const warmupIterations = Math.min(250, Math.max(25, iterations / 10));
  for (let index = 0; index < warmupIterations; index++) {
    operation();
  }

  const durations: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const startedAt = process.hrtime.bigint();
    operation();
    const durationMicros = Number(process.hrtime.bigint() - startedAt) / 1_000;
    durations.push(durationMicros);
  }

  durations.sort((left, right) => left - right);
  const mean =
    durations.reduce((total, duration) => total + duration, 0) /
    durations.length;

  return {
    iterations,
    meanMicros: round(mean, 2),
    p50Micros: round(percentile(durations, 0.5), 2),
    p95Micros: round(percentile(durations, 0.95), 2),
    p99Micros: round(percentile(durations, 0.99), 2),
    operationsPerSecond: round(1_000_000 / mean, 2),
  };
}

function readArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(command: string, fallback = 'unavailable') {
  try {
    return execFileSync('git', command.split(' '), {
      encoding: 'utf8',
    }).trim();
  } catch {
    return fallback;
  }
}

function run() {
  const iterations = Number.parseInt(
    readArgument('--iterations') ?? String(DEFAULT_ITERATIONS),
    10
  );
  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error('--iterations must be a positive integer.');
  }

  const outputPath = resolve(readArgument('--output') ?? DEFAULT_OUTPUT);
  const strategyArgument =
    readArgument('--strategy') ?? CONTEXT_PLANNER_STRATEGY_VERSION;
  if (
    strategyArgument !== CONTEXT_PLANNER_STRATEGY_VERSION &&
    strategyArgument !== UNTRUSTED_CONTEXT_PLANNER_STRATEGY_VERSION &&
    strategyArgument !== CANDIDATE_CONTEXT_PLANNER_STRATEGY_VERSION &&
    strategyArgument !== SYSTEM_CONTEXT_PLANNER_STRATEGY_VERSION &&
    strategyArgument !== PREVIOUS_CONTEXT_PLANNER_STRATEGY_VERSION &&
    strategyArgument !== LEGACY_CONTEXT_PLANNER_STRATEGY_VERSION
  ) {
    throw new Error(
      `--strategy must be ${CONTEXT_PLANNER_STRATEGY_VERSION}, ${UNTRUSTED_CONTEXT_PLANNER_STRATEGY_VERSION}, ${SYSTEM_CONTEXT_PLANNER_STRATEGY_VERSION}, ${CANDIDATE_CONTEXT_PLANNER_STRATEGY_VERSION}, ${PREVIOUS_CONTEXT_PLANNER_STRATEGY_VERSION}, or ${LEGACY_CONTEXT_PLANNER_STRATEGY_VERSION}.`
    );
  }
  const strategyVersion = strategyArgument as ContextPlannerStrategyVersion;
  const scenarios = buildScenarios();
  const scenarioResults = scenarios.map(scenario =>
    evaluateScenario(scenario, strategyVersion)
  );
  const shortScenario = scenarios[0];
  const longScenario = scenarios[1];

  const report = {
    baselineVersion: BASELINE_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      commit: git('rev-parse HEAD'),
      branch: git('branch --show-current'),
      dirty: git('status --porcelain', '').length > 0,
    },
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      architecture: arch(),
      tokenizerModel: TOKENIZER_MODEL,
    },
    quality: {
      scenarios: scenarioResults,
      shortConversationRequiredFactRecall: round(
        scenarioResults[0].markerResults.filter(marker => marker.retained)
          .length / scenarioResults[0].markerResults.length
      ),
      longConversationEarlyFactRecall: scenarioResults[1].markerResults.find(
        marker => marker.id === 'early-required-fact'
      )?.retained
        ? 1
        : 0,
      longConversationRecentFactRecall: scenarioResults[1].markerResults.find(
        marker => marker.id === 'recent-required-fact'
      )?.retained
        ? 1
        : 0,
      crossSessionFactRecall: scenarioResults[2].markerResults[0].retained
        ? 1
        : 0,
      automaticSummaryCheckpoints: scenarioResults.filter(
        scenario => scenario.automaticSummaryCheckpoint
      ).length,
      contextPlannerStrategy: strategyVersion,
    },
    performance: {
      promptAssemblyShort: benchmark(
        () => plan(shortScenario, strategyVersion),
        iterations
      ),
      promptAssemblyLong: benchmark(
        () => plan(longScenario, strategyVersion),
        iterations
      ),
    },
    exclusions: [
      'No external chat model was configured, so answer correctness and LLM-judge scores were not measured.',
      'No persistent search service was detected, so Recall@K and nDCG were not measured.',
      'Online user metrics require shadow traffic or an A/B experiment and are not part of this local run.',
    ],
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Context baseline: ${BASELINE_VERSION}`);
  console.log(`Commit: ${report.source.commit}`);
  console.log(`Report: ${outputPath}`);
  console.table({
    short_fact_recall: report.quality.shortConversationRequiredFactRecall,
    long_early_fact_recall: report.quality.longConversationEarlyFactRecall,
    long_recent_fact_recall: report.quality.longConversationRecentFactRecall,
    cross_session_fact_recall: report.quality.crossSessionFactRecall,
    automatic_summary_checkpoints: report.quality.automaticSummaryCheckpoints,
  });
  console.table(report.performance);
}

run();
