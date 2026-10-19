import { Button, Loading, Menu, MenuItem } from '@affine/component';
import {
  getProjectPath,
  getProjectReportPath,
  getProjectReportPresentationPath,
} from '@affine/core/desktop/route-paths';
import type {
  ProjectReportApi,
  ReportCommand,
  ReportSelection,
} from '@affine/core/modules/project-reports/contracts';
import {
  compareReportDocuments,
  mergeLocalReportDocument,
  moveItem,
  newReportNode,
  ReportEditHistory,
} from '@affine/core/modules/project-reports/edit-state';
import {
  useReportCollection,
  useReportLease,
  useReportState,
} from '@affine/core/modules/project-reports/hooks';
import { paginateReport } from '@affine/core/modules/project-reports/presentation';
import { useProjectEditGuard } from '@affine/core/modules/project-resources/edit-guard';
import {
  isProjectAccessError,
  projectErrorMessage,
} from '@affine/core/modules/project-resources/error';
import {
  AiIcon,
  ArrowDownSmallIcon,
  ArrowLeftSmallIcon,
  CommentIcon,
  EditIcon,
  ExportIcon,
  HistoryIcon,
  LinkIcon,
  MinusIcon,
  PaletteIcon,
  PlusIcon,
  PresentationIcon,
  SelectIcon,
  SidebarIcon,
  ViewLayersIcon,
} from '@blocksuite/icons/rc';
import type { ProjectReportAiContext } from '@localmind/office';
import {
  type ReportDocument,
  ReportDocumentSchema,
  type ReportNode,
  reportNodeText,
} from '@localmind/office/report';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ReportAccessDenied } from './access';
import { SourceSelection, ThemeEditor } from './configuration';
import { SelectField, TextField, useReportText } from './fields';
import { ReportNodeEditor, ResponsibilityEditor } from './node-editor';
import { ReportOutputPanel } from './output-panel';
import { ReportNodeView, ReportSlide } from './render';
import * as styles from './reports.css';
import * as studio from './studio.css';
import { ReportChatPane } from './studio-chat';

type Mode = 'select' | 'comment' | 'edit';
type Drawer =
  | 'inspector'
  | 'sources'
  | 'ai'
  | 'comments'
  | 'history'
  | 'style'
  | 'outputs'
  | 'compare';

const GENERATION_STEPS = [
  'discover',
  'capture',
  'shared-background',
  'work-orders',
  'extract',
  'reconcile',
  'compose',
  'layout',
  'validate',
] as const;
const ZOOM_LEVELS = [50, 67, 75, 90, 100, 110, 125, 150];
const CHAT_KEY = 'localmind:project-report-chat-collapsed';

function DrawerShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useReportText();
  return (
    <aside className={studio.drawer} aria-label={title}>
      <header className={studio.drawerHeader}>
        <h2>{title}</h2>
        <button
          type="button"
          className={studio.iconButton}
          aria-label={t('close')}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className={studio.drawerBody}>{children}</div>
    </aside>
  );
}

export function ReportEditor({
  api,
  projectId,
  reportId,
  revisionId,
  uploadImage,
}: {
  api: ProjectReportApi;
  projectId: string;
  reportId: string;
  revisionId?: string;
  uploadImage: (file: File) => Promise<string>;
}) {
  const t = useReportText();
  const navigate = useNavigate();
  const location = useLocation();
  const presentButton = useRef<HTMLButtonElement>(null);
  const {
    state,
    loading,
    error: loadError,
    refresh,
  } = useReportState(api, { projectId, reportId, revisionId, view: 'detail' });
  const lease = useReportLease(
    api,
    projectId,
    reportId,
    !revisionId &&
      state.report?.lifecycle === 'active' &&
      state.capabilities?.canEdit === true
  );
  const comments = useReportCollection(
    api,
    projectId,
    reportId,
    'comments',
    state.comments,
    state.nextCursors?.comments
  );
  const reviews = useReportCollection(
    api,
    projectId,
    reportId,
    'reviews',
    state.reviews,
    state.nextCursors?.reviews
  );
  const revisions = useReportCollection(
    api,
    projectId,
    reportId,
    'revisions',
    state.revisions,
    state.nextCursors?.revisions
  );
  const [document, setDocument] = useState<ReportDocument>();
  const documentReady = !!document;
  const returnFocus = location.state?.reportReturnFocus;
  useEffect(() => {
    if (!documentReady) return;
    if (returnFocus === 'present' || returnFocus === 'presenter')
      presentButton.current?.focus();
  }, [documentReady, location.key, returnFocus]);
  const [selectedChapter, selectChapter] = useState('');
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [zoom, setZoom] = useState(100);
  const [chatCollapsed, setChatCollapsed] = useState(() => {
    try {
      return localStorage.getItem(CHAT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [selectedNode, selectNode] = useState('');
  const [selection, setSelection] = useState<ReportSelection>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [conflictChoices, setConflictChoices] = useState<
    Record<string, 'current' | 'local'>
  >({});
  const [composing, setComposing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [comment, setComment] = useState('');
  const [issueNotes, setIssueNotes] = useState<Record<string, string>>({});
  const [replyTo, setReplyTo] = useState<string>();
  const [reviewer, setReviewer] = useState('');
  const [choices, setChoices] = useState<
    Record<string, 'current' | 'candidate'>
  >({});
  const [compare, setCompare] = useState<ReportDocument>();
  const [nodeType, setNodeType] = useState<ReportNode['type']>('paragraph');
  const history = useRef<ReportEditHistory | undefined>(undefined);
  const baseline = useRef('');
  const version = useRef(0);
  const docRef = useRef(document);
  docRef.current = document;
  const busy = useRef(false);
  const suspended = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dirty = !!document && JSON.stringify(document) !== baseline.current;
  const canEdit = !!lease.proof && !revisionId && !pending && !conflict;
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, chatCollapsed ? '1' : '0');
    } catch {
      // Ignore unavailable storage.
    }
  }, [chatCollapsed]);
  useEffect(() => {
    if (!state.document || !state.report) return;
    const localDirty =
      docRef.current && JSON.stringify(docRef.current) !== baseline.current;
    if (localDirty) {
      if (state.report.version !== version.current) setConflict(true);
      return;
    }
    if (
      docRef.current &&
      JSON.stringify(docRef.current) === JSON.stringify(state.document)
    ) {
      version.current = state.report.version;
      baseline.current = JSON.stringify(state.document);
      return;
    }
    setDocument(state.document);
    docRef.current = state.document;
    baseline.current = JSON.stringify(state.document);
    version.current = state.report.version;
    history.current = new ReportEditHistory(state.document);
    selectChapter(selected =>
      !selected ||
      state.document?.chapters.some(chapter => chapter.id === selected)
        ? selected
        : ''
    );
  }, [state.document, state.report]);
  const change = (next: ReportDocument) => {
    history.current?.change(next);
    docRef.current = next;
    setDocument(next);
    setError(undefined);
  };
  const execute = useCallback(
    async (command: ReportCommand) => {
      if (busy.current) throw new Error('A report operation is pending');
      busy.current = true;
      setPending(true);
      setError(undefined);
      try {
        const result = await api.command({
          projectId,
          reportId,
          requestKey: crypto.randomUUID(),
          expectedVersion: version.current,
          editLease: lease.proof,
          command,
        });
        if (
          (command.operation === 'save' || command.operation === 'finalize') &&
          result.report
        ) {
          baseline.current = JSON.stringify(command.document);
          version.current = result.report.version;
        }
        await refresh().catch(setError);
        return result;
      } catch (caught) {
        setError(caught);
        throw caught;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [api, lease.proof, projectId, reportId, refresh]
  );
  const save = useCallback(async () => {
    const current = docRef.current;
    if (!current || JSON.stringify(current) === baseline.current) return;
    if (!lease.proof || conflict)
      throw new Error('Report edit lease or version is unavailable');
    const parsed = ReportDocumentSchema.safeParse(current);
    if (!parsed.success) {
      setError(new Error(t('invalidDocument')));
      throw new Error(t('invalidDocument'));
    }
    await execute({
      operation: 'save',
      document: parsed.data,
      reason: 'user_edit',
    });
  }, [conflict, execute, lease.proof, t]);
  useProjectEditGuard({
    hasUnsavedChanges: dirty,
    save,
    discard: async () => {
      if (state.document) {
        baseline.current = JSON.stringify(state.document);
        setDocument(state.document);
        docRef.current = state.document;
        version.current = state.report?.version ?? 0;
        setConflict(false);
      }
    },
    suspend: () => {
      suspended.current = true;
    },
    resume: () => {
      suspended.current = false;
    },
  });
  useEffect(() => {
    if (!dirty || !canEdit || composing) return;
    const timer = setTimeout(() => {
      if (!suspended.current && !busy.current) void save().catch(() => {});
    }, 1400);
    return () => clearTimeout(timer);
  }, [document, dirty, canEdit, composing, save]);
  const run = (command: ReportCommand) => {
    void execute(command).catch(() => {});
  };
  const editingPages = useMemo(
    () =>
      document
        ? paginateReport({
            ...document,
            chapters: document.chapters.map(chapter => ({
              ...chapter,
              hidden: false,
            })),
          })
        : [],
    [document]
  );
  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of comments.items) {
      if (item.resolved || item.stale) continue;
      const key = item.nodeId ?? item.chapterId;
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [comments.items]);
  const reportContext = useMemo<ProjectReportAiContext | undefined>(() => {
    if (!state.report || !state.revision || revisionId) return undefined;
    return {
      version: 'localmind-project-report-ai-context/v1',
      projectId,
      reportId,
      revisionId: state.revision.id,
      reportVersion: state.report.version,
      chapterIds: selectedChapter ? [selectedChapter] : [],
      nodeIds: selectedNode ? [selectedNode] : [],
    };
  }, [
    projectId,
    reportId,
    revisionId,
    selectedChapter,
    selectedNode,
    state.report,
    state.revision,
  ]);

  if (loading)
    return (
      <div className={studio.loading}>
        <Loading />
      </div>
    );
  if (loadError && isProjectAccessError(loadError) && !BUILD_CONFIG.isElectron)
    return <ReportAccessDenied />;
  if (loadError || !document || !state.report)
    return (
      <div role="alert" className={styles.empty}>
        <p>{projectErrorMessage(loadError)}</p>
        <Button onClick={() => void refresh().catch(setError)}>
          {t('retry')}
        </Button>
      </div>
    );
  const localMerge =
    conflict && state.document && baseline.current
      ? mergeLocalReportDocument(
          ReportDocumentSchema.parse(JSON.parse(baseline.current)),
          state.document,
          document,
          conflictChoices
        )
      : undefined;
  const chapterIndex = document.chapters.findIndex(
    chapter => chapter.id === selectedChapter
  );
  const chapter =
    chapterIndex >= 0 ? document.chapters[chapterIndex] : undefined;
  const nodeIndex =
    chapter?.nodes.findIndex(node => node.id === selectedNode) ?? -1;
  const node = chapter && nodeIndex >= 0 ? chapter.nodes[nodeIndex] : undefined;
  const updateChapter = (next: NonNullable<typeof chapter>) =>
    change({
      ...document,
      chapters: document.chapters.map(item =>
        item.id === next.id ? next : item
      ),
    });
  const present = async (presenter: boolean) => {
    if (dirty) await save();
    const current = docRef.current;
    if (!current) throw new Error('Report is unavailable');
    const fixedRevision =
      revisionId ??
      (!lease.proof ? state.report?.latestFinalRevisionId : undefined);
    const result = fixedRevision
      ? { revisionId: fixedRevision }
      : await execute({
          operation: 'save',
          document: current,
          kind: 'preview',
          reason: 'presentation_preview',
        });
    const snapshot = result.revisionId ?? result.revision?.id;
    if (!snapshot) throw new Error(t('snapshotUnavailable'));
    navigate(
      getProjectReportPresentationPath(
        projectId,
        reportId,
        presenter ? 'presenter' : 'present',
        { revisionId: snapshot, nonce: crypto.randomUUID() }
      )
    );
  };
  const canPresent =
    !pending &&
    (!!revisionId || !!lease.proof || !!state.report.latestFinalRevisionId);
  const openDrawer = (next: Drawer) =>
    setDrawer(current => (current === next ? null : next));
  const focusChapter = (id: string) => {
    selectChapter(id);
    selectNode('');
    canvasRef.current
      ?.querySelector(`[data-chapter-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const pickNode = (chapterId: string, nodeId: string) => {
    selectChapter(chapterId);
    selectNode(current =>
      current === nodeId && mode === 'select' ? '' : nodeId
    );
    if (mode === 'comment') setDrawer('comments');
    if (mode === 'edit') setDrawer('inspector');
  };
  const pickChapter = (chapterId: string) => {
    selectChapter(chapterId);
    selectNode('');
    if (mode === 'comment') setDrawer('comments');
    if (mode === 'edit') setDrawer('inspector');
  };
  const addChapter = () => {
    const id = crypto.randomUUID();
    change({
      ...document,
      chapters: [
        ...document.chapters,
        {
          id,
          title: t('newChapter'),
          nodes: [],
          notes: '',
          hidden: false,
          locked: false,
          layout: 'content',
        },
      ],
    });
    selectChapter(id);
    selectNode('');
    setMode('edit');
    setDrawer('inspector');
  };
  const activeRuns =
    state.runs?.filter(
      item => !['completed', 'failed', 'cancelled'].includes(item.status)
    ) ?? [];
  const pendingCandidates =
    state.candidates?.filter(candidate => candidate.status === 'pending') ?? [];
  const saveState = pending
    ? 'saving'
    : conflict
      ? 'conflict'
      : dirty
        ? 'dirty'
        : 'saved';
  const nodeLabel = (item: ReportNode) =>
    `${t(item.type)} · ${reportNodeText(item).slice(0, 18) || '…'}`;
  const currentRevision = state.revision?.sequence;
  const drawerTitle: Record<Drawer, string> = {
    inspector: node ? t('studio.nodeInspector') : t('studio.chapterInspector'),
    sources: t('sources'),
    ai: t('studio.aiTasks'),
    comments: t('comments'),
    history: t('history'),
    style: t('style'),
    outputs: t('outputs'),
    compare: t('comparison'),
  };

  const outlineMenu = (
    <div className={studio.outlineMenu} role="list">
      {document.chapters.map((item, index) => (
        <div
          key={item.id}
          role="listitem"
          className={studio.outlineRow}
          aria-current={item.id === selectedChapter}
        >
          <span>{index + 1}</span>
          <button
            type="button"
            className={studio.outlineTitle}
            onClick={() => focusChapter(item.id)}
          >
            {item.title}
            {item.hidden ? ` · ${t('hidden')}` : ''}
            {item.locked ? ' 🔒' : ''}
          </button>
          <span className={styles.row} style={{ gap: 0 }}>
            <button
              type="button"
              className={studio.iconButton}
              aria-label={t('moveUp')}
              disabled={!canEdit || item.locked || index === 0}
              onClick={() =>
                change({
                  ...document,
                  chapters: moveItem(document.chapters, index, -1),
                })
              }
            >
              ↑
            </button>
            <button
              type="button"
              className={studio.iconButton}
              aria-label={t('moveDown')}
              disabled={
                !canEdit ||
                item.locked ||
                index === document.chapters.length - 1
              }
              onClick={() =>
                change({
                  ...document,
                  chapters: moveItem(document.chapters, index, 1),
                })
              }
            >
              ↓
            </button>
          </span>
        </div>
      ))}
      <MenuItem
        prefixIcon={<PlusIcon />}
        disabled={!canEdit || document.chapters.length >= 60}
        onClick={addChapter}
      >
        {t('addChapter')}
      </MenuItem>
    </div>
  );

  const inspector = chapter ? (
    node ? (
      <>
        <div className={studio.section}>
          <div className={studio.itemHead}>
            <strong>{t(node.type)}</strong>
            <button
              type="button"
              className={studio.iconButton}
              onClick={() => selectNode('')}
              aria-label={t('studio.backToChapter')}
            >
              ↩
            </button>
          </div>
          <div className={studio.actions}>
            <label>
              <input
                type="checkbox"
                checked={node.locked}
                disabled={!canEdit || chapter.locked}
                onChange={event =>
                  updateChapter({
                    ...chapter,
                    nodes: chapter.nodes.map(item =>
                      item.id === node.id
                        ? { ...item, locked: event.target.checked }
                        : item
                    ),
                  })
                }
              />
              {t('locked')}
            </label>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={
                !canEdit || node.locked || chapter.locked || nodeIndex === 0
              }
              onClick={() =>
                updateChapter({
                  ...chapter,
                  nodes: moveItem(chapter.nodes, nodeIndex, -1),
                })
              }
            >
              ↑ {t('moveUp')}
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={
                !canEdit ||
                node.locked ||
                chapter.locked ||
                nodeIndex === chapter.nodes.length - 1
              }
              onClick={() =>
                updateChapter({
                  ...chapter,
                  nodes: moveItem(chapter.nodes, nodeIndex, 1),
                })
              }
            >
              ↓ {t('moveDown')}
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={!canEdit || node.locked || chapter.locked}
              onClick={() => {
                updateChapter({
                  ...chapter,
                  nodes: chapter.nodes.filter(item => item.id !== node.id),
                });
                selectNode('');
              }}
            >
              {t('remove')}
            </button>
          </div>
          <SelectField
            label={t('moveToChapter')}
            value={chapter.id}
            disabled={!canEdit || chapter.locked || node.locked}
            options={document.chapters
              .filter(item => !item.locked)
              .map(item => ({ value: item.id, label: item.title }))}
            onChange={target => {
              change({
                ...document,
                chapters: document.chapters.map(item =>
                  item.id === chapter.id
                    ? {
                        ...item,
                        nodes: item.nodes.filter(old => old.id !== node.id),
                      }
                    : item.id === target
                      ? { ...item, nodes: [...item.nodes, node] }
                      : item
                ),
              });
              selectChapter(target);
            }}
          />
        </div>
        {revisionId ? (
          <ReportNodeView node={node} assetUrls={state.assetUrls} />
        ) : (
          <ReportNodeEditor
            node={node}
            document={document}
            members={state.members ?? []}
            disabled={!canEdit || chapter.locked || node.locked}
            onChange={next =>
              updateChapter({
                ...chapter,
                nodes: chapter.nodes.map(item =>
                  item.id === node.id ? { ...next, claimKind: 'manual' } : item
                ),
              })
            }
          />
        )}
      </>
    ) : (
      <>
        <div className={studio.section}>
          <TextField
            label={t('chapterTitle')}
            disabled={!canEdit || chapter.locked}
            value={chapter.title}
            onChange={title => updateChapter({ ...chapter, title })}
          />
          <SelectField
            label={t('layout')}
            value={chapter.layout}
            options={(
              ['content', 'cover', 'comparison', 'timeline', 'gallery'] as const
            ).map(value => ({ value, label: t(value) }))}
            disabled={!canEdit || chapter.locked}
            onChange={layout => updateChapter({ ...chapter, layout })}
          />
          <div className={studio.actions}>
            <label>
              <input
                type="checkbox"
                checked={chapter.hidden}
                disabled={!canEdit || chapter.locked}
                onChange={event =>
                  updateChapter({ ...chapter, hidden: event.target.checked })
                }
              />
              {t('hidden')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={chapter.locked}
                disabled={!canEdit}
                onChange={event =>
                  updateChapter({ ...chapter, locked: event.target.checked })
                }
              />
              {t('locked')}
            </label>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={!canEdit || chapter.locked}
              onClick={() => {
                change({
                  ...document,
                  chapters: document.chapters.filter(
                    item => item.id !== chapter.id
                  ),
                });
                selectChapter('');
              }}
            >
              {t('removeChapter')}
            </button>
          </div>
        </div>
        <div className={studio.section}>
          <h3 className={studio.sectionTitle}>{t('addContent')}</h3>
          <div className={studio.actions}>
            <div style={{ flex: 1 }}>
              <SelectField
                label={t('nodeType')}
                value={nodeType}
                options={(
                  [
                    'heading',
                    'paragraph',
                    'list',
                    'table',
                    'metric',
                    'timeline',
                    'image',
                    'chart',
                    'callout',
                    'pageBreak',
                  ] as const
                ).map(value => ({ value, label: t(value) }))}
                onChange={setNodeType}
              />
            </div>
            <button
              type="button"
              className={studio.secondaryButton}
              style={{ alignSelf: 'flex-end' }}
              disabled={
                !canEdit || chapter.locked || chapter.nodes.length >= 200
              }
              onClick={() => {
                const created = newReportNode(nodeType);
                updateChapter({
                  ...chapter,
                  nodes: [...chapter.nodes, created],
                });
                selectNode(created.id);
              }}
            >
              <PlusIcon /> {t('addContent')}
            </button>
          </div>
        </div>
        <div className={studio.section}>
          <TextField
            label={t('speakerNotes')}
            multiline
            value={chapter.notes}
            disabled={!canEdit || chapter.locked}
            onChange={notes => updateChapter({ ...chapter, notes })}
          />
        </div>
      </>
    )
  ) : (
    <p className={styles.muted}>{t('studio.pickSomething')}</p>
  );

  const drawerContent = (() => {
    switch (drawer) {
      case 'inspector':
        return inspector;
      case 'compare':
        return compare ? (
          <>
            {compareReportDocuments(compare, document).map(item => (
              <article key={item.id} className={studio.item}>
                <strong>{t(item.kind)}</strong>
                {item.before && (
                  <del className={studio.diffBefore}>
                    {reportNodeText(item.before)}
                  </del>
                )}
                {item.after && (
                  <ins className={studio.diffAfter}>
                    {reportNodeText(item.after)}
                  </ins>
                )}
              </article>
            ))}
            <p className={styles.muted}>{t('studio.compareHint')}</p>
          </>
        ) : null;
      case 'sources':
        return (
          <>
            <div className={studio.section}>
              <div className={styles.row}>
                <span className={styles.pill} data-tone="signal">
                  {t('coverage')} {document.coverage.parsed} /{' '}
                  {document.coverage.selected}
                </span>
                <span className={styles.muted}>
                  {t('cutoff')}: {new Date(document.cutoffAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className={studio.secondaryButton}
                onClick={() => setDrawer('ai')}
              >
                {t('studio.updateFromSources')}
              </button>
            </div>
            {document.issues.length > 0 && (
              <div className={studio.section}>
                <h3 className={studio.sectionTitle}>{t('studio.issues')}</h3>
                {document.issues.map(issue => (
                  <article
                    key={issue.id}
                    className={studio.item}
                    data-tone={issue.resolution ? 'muted' : 'warning'}
                  >
                    <strong>{t(issue.kind)}</strong>
                    <p>{issue.message}</p>
                    {issue.resolution ? (
                      <p>✓ {issue.resolution.note}</p>
                    ) : (
                      <>
                        <TextField
                          label={t('resolution')}
                          multiline
                          disabled={
                            !canEdit ||
                            ['invalid_reference', 'missing_asset'].includes(
                              issue.kind
                            )
                          }
                          value={issueNotes[issue.id] ?? ''}
                          onChange={note =>
                            setIssueNotes({ ...issueNotes, [issue.id]: note })
                          }
                        />
                        <button
                          type="button"
                          className={studio.secondaryButton}
                          disabled={
                            !canEdit ||
                            !state.currentActorId ||
                            !issueNotes[issue.id]?.trim() ||
                            ['invalid_reference', 'missing_asset'].includes(
                              issue.kind
                            )
                          }
                          onClick={() => {
                            const actorId = state.currentActorId;
                            if (!actorId) return;
                            change({
                              ...document,
                              issues: document.issues.map(old =>
                                old.id === issue.id
                                  ? {
                                      ...old,
                                      resolution: {
                                        actorId,
                                        note: issueNotes[issue.id],
                                        resolvedAt: new Date().toISOString(),
                                      },
                                    }
                                  : old
                              ),
                            });
                          }}
                        >
                          {t('resolve')}
                        </button>
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}
            <div className={studio.section}>
              <h3 className={studio.sectionTitle}>{t('sources')}</h3>
              {document.sources.length === 0 && (
                <p className={styles.muted}>{t('studio.noSources')}</p>
              )}
              {document.sources.map(source => (
                <article key={source.id} className={studio.item}>
                  <div className={studio.itemHead}>
                    <strong>{source.title}</strong>
                    <span
                      className={styles.pill}
                      data-tone={
                        source.status === 'parsed' ? 'success' : 'warning'
                      }
                    >
                      {t(source.status)}
                    </span>
                  </div>
                  <p className={styles.muted}>
                    {t(`sourceKind.${source.kind}`)} · {source.revision}
                  </p>
                  {source.reason && <p>{source.reason}</p>}
                  {source.resourceId && (
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() =>
                        navigate(getProjectPath(projectId, source.resourceId))
                      }
                    >
                      <LinkIcon /> {t('studio.openSource')}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        );
      case 'ai':
        return (
          <>
            {activeRuns.map(runItem => {
              const stepIndex = GENERATION_STEPS.indexOf(
                runItem.step?.split(':')[0] as (typeof GENERATION_STEPS)[number]
              );
              return (
                <div key={runItem.id} className={studio.section}>
                  <div className={studio.itemHead}>
                    <span className={styles.pulseDot} />
                    <strong>{t(runItem.status)}</strong>
                    {runItem.total ? (
                      <span className={styles.muted}>
                        {runItem.completed ?? 0} / {runItem.total}
                      </span>
                    ) : null}
                  </div>
                  <ol className={studio.steps}>
                    {GENERATION_STEPS.map((step, index) => (
                      <li
                        key={step}
                        className={studio.step}
                        data-state={
                          stepIndex < 0
                            ? 'pending'
                            : index < stepIndex
                              ? 'done'
                              : index === stepIndex
                                ? 'active'
                                : 'pending'
                        }
                      >
                        <span className={studio.stepDot}>
                          {stepIndex >= 0 && index < stepIndex ? '✓' : ''}
                          {stepIndex >= 0 && index === stepIndex ? (
                            <span className={styles.pulseDot} />
                          ) : null}
                          {stepIndex < 0 || index > stepIndex ? index + 1 : ''}
                        </span>
                        <span>{t(step)}</span>
                        <span />
                      </li>
                    ))}
                  </ol>
                  <div className={studio.actions}>
                    <button
                      type="button"
                      className={studio.secondaryButton}
                      disabled={pending}
                      onClick={() =>
                        run({
                          operation: 'generation.cancel',
                          runId: runItem.id,
                        })
                      }
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              );
            })}
            {pendingCandidates.map(candidate => (
              <div key={candidate.id} className={studio.section}>
                <article className={studio.item} data-tone="warning">
                  <div className={studio.itemHead}>
                    <strong>{t('candidate')}</strong>
                    <span className={styles.pill} data-tone="warning">
                      {t('studio.needsReview')}
                    </span>
                  </div>
                  <p>{t('studio.candidateHelp')}</p>
                  {candidate.conflicts.map(id => (
                    <SelectField
                      key={id}
                      label={`${t('conflict')} ${id}`}
                      value={choices[id] ?? ''}
                      options={[
                        { value: '', label: t('choose') },
                        { value: 'current', label: t('keepCurrent') },
                        { value: 'candidate', label: t('useCandidate') },
                      ]}
                      onChange={value =>
                        setChoices({
                          ...choices,
                          [id]: value as 'current' | 'candidate',
                        })
                      }
                    />
                  ))}
                  <div className={studio.actions}>
                    <button
                      type="button"
                      className={studio.secondaryButton}
                      onClick={() => {
                        setCompare(candidate.document);
                        setDrawer('compare');
                      }}
                    >
                      {t('compare')}
                    </button>
                    <button
                      type="button"
                      className={studio.primaryButton}
                      disabled={
                        !canEdit ||
                        dirty ||
                        candidate.conflicts.some(id => !choices[id])
                      }
                      onClick={() =>
                        run({
                          operation: 'candidate.apply',
                          candidateId: candidate.id,
                          choices,
                        })
                      }
                    >
                      {t('apply')}
                    </button>
                  </div>
                </article>
              </div>
            ))}
            <div className={studio.section}>
              <h3 className={studio.sectionTitle}>{t('studio.quickTask')}</h3>
              <p className={styles.muted}>{t('studio.quickTaskHelp')}</p>
              <SourceSelection
                value={selection ?? state.report?.selection}
                resources={state.resources ?? []}
                disabled={!canEdit}
                onChange={setSelection}
              />
              <TextField
                label={t('aiInstructions')}
                multiline
                value={instruction}
                onChange={setInstruction}
              />
              <div className={studio.actions}>
                <button
                  type="button"
                  className={studio.secondaryButton}
                  disabled={!canEdit || dirty || !state.revision || !chapter}
                  onClick={() =>
                    run({
                      operation: 'generate',
                      mode: 'rewrite',
                      revisionId: state.revision?.id ?? '',
                      chapterIds: chapter ? [chapter.id] : [],
                      nodeIds: node ? [node.id] : undefined,
                      instructions: instruction,
                    })
                  }
                >
                  {t(node ? 'rewriteNode' : 'rewriteChapter')}
                </button>
                <button
                  type="button"
                  className={studio.primaryButton}
                  disabled={!canEdit || dirty || !state.revision}
                  onClick={() =>
                    run({
                      operation: 'generate',
                      mode: 'refresh',
                      selection: selection ?? state.report?.selection,
                      revisionId: state.revision?.id ?? '',
                      instructions: instruction,
                    })
                  }
                >
                  {t('refreshReport')}
                </button>
              </div>
            </div>
            {state.runs
              ?.filter(item => ['failed', 'cancelled'].includes(item.status))
              .map(runItem => (
                <article key={runItem.id} className={studio.item}>
                  <div className={studio.itemHead}>
                    <strong>{t(runItem.status)}</strong>
                    <button
                      type="button"
                      className={studio.secondaryButton}
                      disabled={pending}
                      onClick={() =>
                        run({
                          operation: 'generation.retry',
                          runId: runItem.id,
                        })
                      }
                    >
                      {t('retry')}
                    </button>
                  </div>
                  {runItem.error && <p>{t('generationFailed')}</p>}
                </article>
              ))}
          </>
        );
      case 'comments':
        return (
          <>
            <div className={studio.section}>
              <p className={styles.muted}>
                {t('studio.commentAnchor')}:{' '}
                {chapter
                  ? `${chapter.title}${node ? ` · ${nodeLabel(node)}` : ''}`
                  : t('studio.wholeReport')}
              </p>
              <TextField
                label={replyTo ? t('reply') : t('comment')}
                multiline
                value={comment}
                onChange={setComment}
              />
              <div className={studio.actions}>
                {replyTo && (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setReplyTo(undefined)}
                  >
                    {t('cancel')}
                  </button>
                )}
                <button
                  type="button"
                  className={studio.primaryButton}
                  disabled={pending || !comment.trim() || !state.revision}
                  onClick={() => {
                    const parent = replyTo
                      ? comments.items.find(item => item.id === replyTo)
                      : undefined;
                    void execute({
                      operation: 'comment.add',
                      revisionId:
                        parent?.revisionId ?? state.revision?.id ?? '',
                      body: comment,
                      chapterId: parent
                        ? parent.nodeId
                          ? undefined
                          : (parent.chapterId ?? undefined)
                        : chapter?.id,
                      nodeId: parent ? (parent.nodeId ?? undefined) : node?.id,
                      parentId: replyTo,
                    })
                      .then(() => {
                        setComment('');
                        setReplyTo(undefined);
                      })
                      .catch(() => {});
                  }}
                >
                  {t('sendComment')}
                </button>
              </div>
            </div>
            <div className={studio.section}>
              {comments.items.length === 0 && (
                <p className={styles.muted}>{t('studio.noComments')}</p>
              )}
              {comments.items.map(item => (
                <article
                  key={item.id}
                  className={studio.item}
                  data-tone={item.resolved ? 'muted' : undefined}
                >
                  <div className={studio.itemHead}>
                    <strong>{item.authorLabel ?? item.actorId}</strong>
                    {item.resolved && (
                      <span className={styles.pill} data-tone="success">
                        {t('resolved')}
                      </span>
                    )}
                  </div>
                  <p>{item.body}</p>
                  {item.stale && (
                    <p className={styles.muted}>{t('anchorChanged')}</p>
                  )}
                  <div className={studio.actions}>
                    {(item.chapterId || item.nodeId) && !item.stale && (
                      <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() => {
                          if (item.chapterId) focusChapter(item.chapterId);
                          selectNode(item.nodeId ?? '');
                        }}
                      >
                        {t('jumpToAnchor')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setReplyTo(item.id)}
                    >
                      {t('reply')}
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      disabled={pending}
                      onClick={() =>
                        run({
                          operation: 'comment.resolve',
                          commentId: item.id,
                          expectedCommentVersion: item.version,
                          resolved: !item.resolved,
                        })
                      }
                    >
                      {t(item.resolved ? 'reopen' : 'resolve')}
                    </button>
                  </div>
                </article>
              ))}
              {comments.hasMore && (
                <button
                  type="button"
                  className={studio.secondaryButton}
                  onClick={() => void comments.loadMore().catch(setError)}
                >
                  {t('loadMore')}
                </button>
              )}
            </div>
            <div className={studio.section}>
              <h3 className={studio.sectionTitle}>{t('requestReview')}</h3>
              <SelectField
                label={t('reviewer')}
                value={reviewer}
                options={[
                  { value: '', label: t('choose') },
                  ...(state.members ?? []).map(member => ({
                    value: member.id,
                    label: member.name,
                  })),
                ]}
                onChange={setReviewer}
              />
              <button
                type="button"
                className={studio.secondaryButton}
                disabled={pending || !reviewer || !state.revision}
                onClick={() =>
                  run({
                    operation: 'review.request',
                    reviewerIds: [reviewer],
                    revisionId: state.revision?.id ?? '',
                  })
                }
              >
                {t('requestReview')}
              </button>
              {reviews.items.map(review => (
                <article key={review.id} className={studio.item}>
                  <div className={studio.itemHead}>
                    <strong>
                      {state.members?.find(
                        member => member.id === review.reviewerId
                      )?.name ?? review.reviewerId}
                    </strong>
                    <span className={styles.pill}>{t(review.status)}</span>
                  </div>
                  {review.stale && (
                    <p className={styles.muted}>{t('reviewStale')}</p>
                  )}
                  <div className={studio.actions}>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      disabled={
                        pending ||
                        review.stale ||
                        review.reviewerId !== state.currentActorId
                      }
                      onClick={() =>
                        run({
                          operation: 'review.respond',
                          reviewId: review.id,
                          expectedReviewVersion: review.version,
                          status: 'approved',
                          note: comment,
                        })
                      }
                    >
                      {t('approveReview')}
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      disabled={
                        pending ||
                        review.stale ||
                        review.reviewerId !== state.currentActorId ||
                        !comment.trim()
                      }
                      onClick={() =>
                        run({
                          operation: 'review.respond',
                          reviewId: review.id,
                          expectedReviewVersion: review.version,
                          status: 'changes_requested',
                          note: comment,
                        })
                      }
                    >
                      {t('requestChanges')}
                    </button>
                  </div>
                </article>
              ))}
              {reviews.hasMore && (
                <button
                  type="button"
                  className={studio.secondaryButton}
                  onClick={() => void reviews.loadMore().catch(setError)}
                >
                  {t('moreReviews')}
                </button>
              )}
            </div>
          </>
        );
      case 'history':
        return (
          <>
            {revisions.items.map(revision => (
              <article
                key={revision.id}
                className={studio.item}
                data-tone={revision.id === revisionId ? 'warning' : undefined}
              >
                <div className={studio.itemHead}>
                  <strong>v{revision.sequence}</strong>
                  <span
                    className={styles.pill}
                    data-tone={
                      revision.kind === 'final' ? 'success' : undefined
                    }
                  >
                    {t(revision.kind)}
                  </span>
                </div>
                <p className={styles.muted}>
                  {new Date(revision.createdAt).toLocaleString()}
                </p>
                <div className={studio.actions}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() =>
                      navigate(
                        getProjectReportPath(projectId, reportId, revision.id)
                      )
                    }
                  >
                    {t('open')}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() =>
                      void api
                        .query({ projectId, reportId, revisionId: revision.id })
                        .then(result => {
                          setCompare(result.document);
                          setDrawer('compare');
                        })
                        .catch(setError)
                    }
                  >
                    {t('compare')}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={!canEdit}
                    onClick={() =>
                      run({ operation: 'restore', revisionId: revision.id })
                    }
                  >
                    {t('restoreAsDraft')}
                  </button>
                </div>
              </article>
            ))}
            {revisions.hasMore && (
              <button
                type="button"
                className={studio.secondaryButton}
                onClick={() => void revisions.loadMore().catch(setError)}
              >
                {t('loadMore')}
              </button>
            )}
          </>
        );
      case 'style':
        return (
          <>
            <div className={studio.section}>
              <ResponsibilityEditor
                value={document.responsibility}
                creator={document.creator}
                members={state.members ?? []}
                disabled={!canEdit}
                onChange={responsibility =>
                  change({ ...document, responsibility })
                }
              />
            </div>
            <div className={studio.section}>
              <ThemeEditor
                value={document.theme}
                disabled={!canEdit}
                onChange={theme => change({ ...document, theme })}
              />
            </div>
            <div className={studio.section}>
              <label className={styles.field}>
                {t('uploadImage')}
                <input
                  className={styles.input}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  disabled={!canEdit}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setPending(true);
                    void uploadImage(file)
                      .then(blobKey => {
                        const current = docRef.current;
                        if (!current) throw new Error('Report is unavailable');
                        change({
                          ...current,
                          assets: [
                            ...current.assets,
                            {
                              id: crypto.randomUUID(),
                              blobKey,
                              mimeType:
                                file.type as ReportDocument['assets'][number]['mimeType'],
                              alt: file.name,
                            },
                          ],
                        });
                      })
                      .catch(setError)
                      .finally(() => setPending(false));
                  }}
                />
              </label>
              <SelectField
                label={t('logo')}
                value={document.theme.logoAssetId ?? ''}
                options={[
                  { value: '', label: t('none') },
                  ...document.assets.map(asset => ({
                    value: asset.id,
                    label: asset.alt,
                  })),
                ]}
                disabled={!canEdit}
                onChange={logoAssetId =>
                  change({
                    ...document,
                    theme: {
                      ...document.theme,
                      logoAssetId: logoAssetId || undefined,
                    },
                  })
                }
              />
            </div>
            <button
              type="button"
              className={studio.secondaryButton}
              disabled={pending}
              onClick={() =>
                run({
                  operation: 'template.save',
                  content: {
                    assets: document.assets,
                    name: document.title,
                    audience: document.audience,
                    language: document.language,
                    durationMinutes: document.durationMinutes,
                    prompt: '',
                    theme: document.theme,
                    chapters: document.chapters.map(item => ({
                      key: item.id,
                      title: item.title,
                      question: '',
                      layout: item.layout,
                    })),
                  },
                })
              }
            >
              {t('saveAsTemplate')}
            </button>
          </>
        );
      case 'outputs':
        return (
          <ReportOutputPanel
            state={state}
            document={document}
            pending={pending}
            execute={execute}
            api={api}
          />
        );
      default:
        return null;
    }
  })();

  const modeButton = (value: Mode, icon: ReactNode) => (
    <button
      type="button"
      className={styles.viewSwitchButton}
      aria-pressed={mode === value}
      title={t(`studio.mode.${value}`)}
      onClick={() => {
        setMode(value);
        if (value === 'comment') setDrawer('comments');
        if (value === 'edit') setDrawer('inspector');
        if (
          value === 'select' &&
          (drawer === 'inspector' || drawer === 'comments')
        )
          setDrawer(null);
      }}
    >
      {icon}
      <span className={studio.compactLabel}>{t(`studio.mode.${value}`)}</span>
    </button>
  );
  const drawerButton = (value: Drawer, icon: ReactNode, badge?: number) => (
    <button
      type="button"
      className={styles.ghostButton}
      aria-pressed={drawer === value}
      title={drawerTitle[value]}
      onClick={() => openDrawer(value)}
    >
      {icon}
      <span className={studio.compactLabel}>{drawerTitle[value]}</span>
      {badge ? (
        <span className={styles.pill} data-tone="warning">
          {badge}
        </span>
      ) : null}
    </button>
  );
  const zoomIndex = ZOOM_LEVELS.indexOf(zoom);

  return (
    <div
      className={studio.studio}
      data-chat={chatCollapsed ? 'collapsed' : 'open'}
      onKeyDown={event => {
        if (
          composing ||
          !canEdit ||
          !(event.metaKey || event.ctrlKey) ||
          event.key.toLowerCase() !== 'z' ||
          (event.target instanceof HTMLElement &&
            event.target.closest('[data-testid="workbench-conversation"]'))
        )
          return;
        event.preventDefault();
        const next = event.shiftKey
          ? history.current?.redo()
          : history.current?.undo();
        if (next) {
          docRef.current = next;
          setDocument(next);
        }
      }}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
    >
      <header className={studio.header}>
        <div className={studio.headerLead}>
          <button
            type="button"
            className={studio.iconButton}
            aria-label={t('back')}
            onClick={() => navigate(getProjectReportPath(projectId))}
          >
            <ArrowLeftSmallIcon />
          </button>
          <div className={studio.headerLeadTitle}>
            <strong>{t('studio.assistant')}</strong>
            <span>{t('studio.assistantHint')}</span>
          </div>
          <button
            type="button"
            className={studio.iconButton}
            aria-pressed={chatCollapsed}
            aria-label={t(
              chatCollapsed ? 'studio.showChat' : 'studio.hideChat'
            )}
            title={t(chatCollapsed ? 'studio.showChat' : 'studio.hideChat')}
            onClick={() => setChatCollapsed(value => !value)}
          >
            <SidebarIcon />
          </button>
        </div>
        <div className={studio.headerMain}>
          <input
            className={studio.titleInput}
            aria-label={t('title')}
            value={document.title}
            disabled={!canEdit}
            onChange={event =>
              change({ ...document, title: event.target.value })
            }
          />
          <span
            role="status"
            className={studio.saveState}
            data-state={saveState}
            title={t(
              {
                saving: 'saving',
                conflict: 'versionConflict',
                dirty: 'unsaved',
                saved: 'saved',
              }[saveState]
            )}
          >
            <span className={studio.saveLabel}>
              {t(
                {
                  saving: 'saving',
                  conflict: 'versionConflict',
                  dirty: 'unsaved',
                  saved: 'saved',
                }[saveState]
              )}
            </span>
          </span>
          {dirty && (
            <button
              type="button"
              className={styles.ghostButton}
              disabled={!canEdit}
              onClick={() => void save().catch(setError)}
            >
              {t('save')}
            </button>
          )}
          <span className={studio.divider} />
          <Menu contentOptions={{ align: 'start' }} items={outlineMenu}>
            <button type="button" className={styles.ghostButton}>
              <ViewLayersIcon />
              <span className={studio.chapterLabel}>
                {chapter ? chapter.title : t('chapters')}
              </span>
              <ArrowDownSmallIcon />
            </button>
          </Menu>
          <button
            type="button"
            className={styles.ghostButton}
            aria-pressed={drawer === 'history'}
            onClick={() => openDrawer('history')}
          >
            <HistoryIcon />
            {revisionId
              ? t('studio.viewingRevision')
              : currentRevision
                ? `v${currentRevision}`
                : t('history')}
          </button>
          <span className={studio.zoom} aria-label={t('studio.zoom')}>
            <button
              type="button"
              aria-label={t('studio.zoomOut')}
              disabled={zoomIndex <= 0}
              onClick={() => setZoom(ZOOM_LEVELS[Math.max(0, zoomIndex - 1)])}
            >
              <MinusIcon />
            </button>
            <span className={studio.zoomValue}>{zoom}%</span>
            <button
              type="button"
              aria-label={t('studio.zoomIn')}
              disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
              onClick={() =>
                setZoom(
                  ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, zoomIndex + 1)]
                )
              }
            >
              <PlusIcon />
            </button>
          </span>
          <span className={styles.viewSwitch} role="group">
            {modeButton('select', <SelectIcon />)}
            {modeButton('comment', <CommentIcon />)}
            {modeButton('edit', <EditIcon />)}
          </span>
          <span className={studio.spacer} />
          {drawerButton(
            'sources',
            <LinkIcon />,
            document.issues.filter(issue => !issue.resolution).length
          )}
          {drawerButton('ai', <AiIcon />, pendingCandidates.length)}
          {drawerButton('style', <PaletteIcon />)}
          <span className={studio.divider} />
          <Menu
            contentOptions={{ align: 'end' }}
            items={
              <>
                <MenuItem
                  prefixIcon={<PresentationIcon />}
                  disabled={!canPresent}
                  onClick={() => void present(false).catch(setError)}
                >
                  {t('studio.presentFullscreen')}
                </MenuItem>
                <MenuItem
                  prefixIcon={<PresentationIcon />}
                  disabled={!canPresent}
                  onClick={() => void present(true).catch(setError)}
                >
                  {t('presenter')}
                </MenuItem>
              </>
            }
          >
            <button
              ref={presentButton}
              type="button"
              className={studio.secondaryButton}
              disabled={!canPresent}
            >
              <PresentationIcon />
              {t('present')}
              <ArrowDownSmallIcon />
            </button>
          </Menu>
          <button
            type="button"
            className={studio.secondaryButton}
            aria-pressed={drawer === 'outputs'}
            onClick={() => openDrawer('outputs')}
          >
            <ExportIcon />
            <span className={studio.compactLabel}>
              {t('studio.shareExport')}
            </span>
          </button>
          {revisionId ? (
            <button
              type="button"
              className={studio.primaryButton}
              onClick={() =>
                navigate(getProjectReportPath(projectId, reportId))
              }
            >
              {t('continueEditing')}
            </button>
          ) : (
            <button
              type="button"
              className={studio.primaryButton}
              disabled={!canEdit}
              onClick={() =>
                run({
                  operation: 'finalize',
                  document: ReportDocumentSchema.parse(document),
                })
              }
            >
              {t('finalize')}
            </button>
          )}
        </div>
      </header>
      <ReportChatPane
        projectId={projectId}
        reportId={reportId}
        reportContext={reportContext}
        scope={{
          chapter: chapter
            ? { id: chapter.id, title: chapter.title }
            : undefined,
          node: node ? { id: node.id, label: nodeLabel(node) } : undefined,
        }}
        onClearScope={() => {
          selectChapter('');
          selectNode('');
        }}
        onChanged={refresh}
      />
      <div className={studio.workspace}>
        <div className={studio.canvasColumn}>
          <div className={studio.banners}>
            {!!(error || lease.error) && (
              <div role="alert" className={studio.banner} data-tone="danger">
                <span>
                  {error instanceof Error &&
                  error.message === t('invalidDocument')
                    ? t('invalidDocument')
                    : projectErrorMessage(error ?? lease.error)}
                </span>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setError(undefined)}
                >
                  {t('dismiss')}
                </button>
              </div>
            )}
            {!revisionId && !lease.proof && (
              <div className={studio.banner} role="status" data-tone="warning">
                <span>
                  {lease.holder
                    ? `${t('heldBy')} ${lease.holder}`
                    : t('readOnly')}
                </span>
                <button
                  type="button"
                  className={studio.secondaryButton}
                  disabled={pending}
                  onClick={() => void lease.acquire().catch(setError)}
                >
                  {t('acquireLease')}
                </button>
              </div>
            )}
            {conflict && (
              <div role="alert" className={studio.banner} data-tone="danger">
                <span>{t('versionConflictHelp')}</span>
                <button
                  type="button"
                  className={studio.secondaryButton}
                  onClick={() => {
                    setCompare(state.document);
                    setDrawer('compare');
                  }}
                >
                  {t('compare')}
                </button>
                <button
                  type="button"
                  className={studio.secondaryButton}
                  onClick={() => {
                    if (!state.document) return;
                    baseline.current = JSON.stringify(state.document);
                    version.current = state.report?.version ?? 0;
                    setDocument(state.document);
                    docRef.current = state.document;
                    history.current = new ReportEditHistory(state.document);
                    setConflict(false);
                  }}
                >
                  {t('useServerVersion')}
                </button>
                {localMerge?.conflicts.map(path => (
                  <SelectField
                    key={path}
                    label={path}
                    value={conflictChoices[path] ?? ''}
                    options={[
                      { value: '', label: t('choose') },
                      { value: 'current', label: t('keepCurrent') },
                      { value: 'local', label: t('keepLocalForMerge') },
                    ]}
                    onChange={value =>
                      setConflictChoices({
                        ...conflictChoices,
                        [path]: value as 'current' | 'local',
                      })
                    }
                  />
                ))}
                <button
                  type="button"
                  className={studio.primaryButton}
                  disabled={!localMerge || localMerge.conflicts.length > 0}
                  onClick={() => {
                    if (!localMerge || !state.document || !state.report) return;
                    const result = ReportDocumentSchema.safeParse(
                      localMerge.document
                    );
                    if (!result.success) {
                      setError(new Error(t('invalidDocument')));
                      return;
                    }
                    baseline.current = JSON.stringify(state.document);
                    version.current = state.report.version;
                    change(result.data);
                    setConflict(false);
                    setConflictChoices({});
                  }}
                >
                  {t('applyMerge')}
                </button>
              </div>
            )}
            {!!state.sourceChanges &&
              (state.sourceChanges.count > 0 ||
                state.sourceChanges.removed > 0) && (
                <div className={studio.banner} role="status" data-tone="signal">
                  <span>
                    {t('sourceChanges')}: {state.sourceChanges.count} ·{' '}
                    {t('sourceRemoved')}: {state.sourceChanges.removed}
                  </span>
                  <button
                    type="button"
                    className={studio.secondaryButton}
                    onClick={() => setDrawer('ai')}
                  >
                    {t('reviewUpdates')}
                  </button>
                </div>
              )}
            {activeRuns.length > 0 && (
              <div className={studio.banner} role="status" data-tone="signal">
                <span className={styles.pulseDot} />
                <span>
                  {t('studio.generating')}
                  {activeRuns[0].step
                    ? ` · ${t(activeRuns[0].step.split(':')[0])}`
                    : ''}
                  {activeRuns[0].total
                    ? ` · ${activeRuns[0].completed ?? 0} / ${activeRuns[0].total}`
                    : ''}
                </span>
                <button
                  type="button"
                  className={studio.secondaryButton}
                  onClick={() => setDrawer('ai')}
                >
                  {t('studio.viewProgress')}
                </button>
              </div>
            )}
            {pendingCandidates.length > 0 && (
              <div className={studio.banner} role="status" data-tone="warning">
                <strong>{t('candidate')}</strong>
                <span>
                  {t('studio.candidatesReady').replace(
                    '{count}',
                    String(pendingCandidates.length)
                  )}
                </span>
                <button
                  type="button"
                  className={studio.secondaryButton}
                  onClick={() => {
                    setCompare(pendingCandidates[0].document);
                    setDrawer('compare');
                  }}
                >
                  {t('compare')}
                </button>
                <button
                  type="button"
                  className={studio.primaryButton}
                  onClick={() => setDrawer('ai')}
                >
                  {t('studio.review')}
                </button>
              </div>
            )}
          </div>
          <div
            ref={canvasRef}
            className={studio.canvas}
            data-mode={mode}
            style={assignInlineVars({
              [studio.slideWidthVar]: `${Math.round((960 * zoom) / 100)}px`,
            })}
          >
            {editingPages.map((page, index) => {
              const pageChapter = document.chapters.find(
                item => item.id === page.chapterId
              );
              const firstOfChapter =
                index === 0 ||
                editingPages[index - 1].chapterId !== page.chapterId;
              return (
                <section
                  key={page.id}
                  className={studio.page}
                  data-chapter-id={firstOfChapter ? page.chapterId : undefined}
                >
                  <div className={studio.pageMeta}>
                    <span>
                      {index + 1} / {editingPages.length}
                    </span>
                    <button
                      type="button"
                      className={studio.pageMetaTitle}
                      aria-current={page.chapterId === selectedChapter}
                      onClick={() => pickChapter(page.chapterId)}
                    >
                      {page.title}
                    </button>
                    {pageChapter?.hidden && (
                      <span className={styles.pill}>{t('hidden')}</span>
                    )}
                    {pageChapter?.locked && (
                      <span className={styles.pill}>🔒 {t('locked')}</span>
                    )}
                    {commentCounts.get(page.chapterId) ? (
                      <span className={styles.pill} data-tone="warning">
                        <CommentIcon /> {commentCounts.get(page.chapterId)}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={studio.pageFrame}
                    data-hidden={pageChapter?.hidden}
                    data-current={
                      page.chapterId === selectedChapter && !selectedNode
                    }
                  >
                    <ReportSlide
                      page={page}
                      theme={document.theme}
                      assetUrls={state.assetUrls}
                      kicker={
                        page.layout === 'cover'
                          ? document.title
                          : `${String(
                              document.chapters.findIndex(
                                item => item.id === page.chapterId
                              ) + 1
                            ).padStart(2, '0')}`
                      }
                      footer={
                        <>
                          <span>{document.title}</span>
                          <span>{index + 1}</span>
                        </>
                      }
                      emptyLabel={t('studio.emptyChapter')}
                      renderNode={(item, content) => (
                        <div
                          className={studio.nodeTarget}
                          data-selected={item.id === selectedNode}
                          data-locked={'locked' in item && item.locked}
                          role="button"
                          tabIndex={0}
                          aria-label={t(item.type)}
                          onClick={event => {
                            event.stopPropagation();
                            pickNode(page.chapterId, item.id);
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              pickNode(page.chapterId, item.id);
                            }
                          }}
                        >
                          {content}
                          {commentCounts.get(item.id) ? (
                            <span className={studio.commentBadge}>
                              {commentCounts.get(item.id)}
                            </span>
                          ) : null}
                        </div>
                      )}
                    />
                  </div>
                </section>
              );
            })}
            {!revisionId && (
              <button
                type="button"
                className={studio.addChapter}
                disabled={!canEdit || document.chapters.length >= 60}
                onClick={addChapter}
              >
                <PlusIcon /> {t('addChapter')}
              </button>
            )}
          </div>
        </div>
        {drawer && (drawer !== 'compare' || compare) && (
          <DrawerShell
            title={drawerTitle[drawer]}
            onClose={() => {
              if (drawer === 'compare') setCompare(undefined);
              setDrawer(null);
            }}
          >
            {drawerContent}
          </DrawerShell>
        )}
      </div>
    </div>
  );
}
