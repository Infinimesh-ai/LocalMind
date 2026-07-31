import { Button, IconButton } from '@affine/component';
import { Header } from '@affine/core/components/pure/header';
import { WorkspaceDialogService } from '@affine/core/modules/dialogs';
import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
  WorkbenchService,
} from '@affine/core/modules/workbench';
import {
  AiOutlineIcon,
  CloseIcon,
  HelpIcon,
  LockIcon,
  SearchIcon,
  SettingsIcon,
  WarningIcon,
} from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import {
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';

import * as styles from './index.css';

type GuideSection = {
  id: string;
  index: string;
  title: string;
  summary: string;
  searchText: string;
  content: ReactNode;
};

const Path = ({ children }: PropsWithChildren) => (
  <code className={styles.path}>{children}</code>
);

const QuickStart = () => (
  <>
    <div className={styles.stepGrid}>
      {[
        ['01', '准备资料', '在工作区中打开或创建需要 AI 使用的文档。'],
        ['02', '添加上下文', '进入 AI Chat，用输入框旁的 + 选择文档或文件。'],
        ['03', '明确任务', '说明资料范围、输出格式，以及哪些内容不能猜测。'],
        [
          '04',
          '沉淀经验',
          '把稳定约束保存为 Rule，并定期检查 Automatic Memory。',
        ],
      ].map(([number, title, description]) => (
        <div className={styles.step} key={number}>
          <span className={styles.stepNumber}>{number}</span>
          <div>
            <div className={styles.stepTitle}>{title}</div>
            <p className={styles.stepDescription}>{description}</p>
          </div>
        </div>
      ))}
    </div>
    <div className={styles.promptExample}>
      <div className={styles.exampleLabel}>推荐提问方式</div>
      <p>
        只根据“发布计划”和“风险清单”整理下周检查表，按负责人分组。资料中
        无法确认的内容标记为“待确认”，不要自行补写。
      </p>
    </div>
  </>
);

const DocumentSnapshots = () => (
  <div className={styles.twoColumn}>
    <div>
      <h3>为什么使用快照</h3>
      <p>
        对话保存读取资料时的版本，让历史回答可以复现，不会因为源文档后来
        被编辑而悄悄改变旧回答的依据。
      </p>
    </div>
    <div>
      <h3>读取最新版本</h3>
      <ol className={styles.orderedList}>
        <li>保存文档并等待同步完成。</li>
        <li>等待当前对话输入框上方出现更新提示。</li>
        <li>点击提示中的 New Chat。</li>
        <li>在新对话中重新选择或引用文档。</li>
        <li>明确要求 AI 根据最新版本回答。</li>
      </ol>
      <p>提示可以关闭；同一保存版本不会重复出现，文档再次保存后会重新提示。</p>
    </div>
  </div>
);

const ChatGuide = () => (
  <>
    <div className={styles.featureRows}>
      <div>
        <h3>添加资料</h3>
        <p>
          点击输入框旁的 <Path>+</Path>，可添加工作区文档、标签、集合、
          PDF、TXT、CSV 和图片。优先选择少量权威资料。
        </p>
      </div>
      <div>
        <h3>管理会话</h3>
        <p>
          使用 <Path>New Chat</Path> 创建干净会话，使用
          <Path>Chat History</Path> 返回历史记录。一个对话尽量只处理一个
          持续主题。
        </p>
      </div>
      <div>
        <h3>长对话</h3>
        <p>
          LocalMind 会保留最近消息，并压缩较早内容。目标、资料或假设发生
          明显变化时，应新建对话。
        </p>
      </div>
    </div>
    <div className={styles.tipLine}>
      <strong>提问检查：</strong>
      任务、资料范围、输出格式、必须保留的内容、禁止猜测的内容。
    </div>
  </>
);

const MemoryGuide = () => (
  <>
    <div className={styles.definitionTable} role="table">
      <div className={styles.definitionHeader} role="row">
        <span role="columnheader">类型</span>
        <span role="columnheader">用途</span>
        <span role="columnheader">管理方式</span>
      </div>
      {[
        ['Rule', '明确约束回答格式和工作方式', '创建、编辑、停用、删除'],
        [
          'Automatic Memory',
          '保存当前用户的稳定偏好和决定',
          '自动生成，可复核和修改',
        ],
        [
          'Project Summary',
          '保存当前用户对项目的稳定背景总结',
          '按 Context Project 管理',
        ],
        ['Rolling Summary', '压缩当前长对话的较早内容', '仅属于当前对话'],
      ].map(row => (
        <div className={styles.definitionRow} role="row" key={row[0]}>
          {row.map(cell => (
            <span role="cell" key={cell}>
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
    <div className={styles.exampleColumns}>
      <div>
        <div className={styles.exampleLabel}>适合保存</div>
        <p>“记住：我希望先看结论，再看详细依据。”</p>
        <p>“所有日期使用 YYYY-MM-DD 格式。”</p>
      </div>
      <div>
        <div className={styles.exampleLabel}>不适合保存</div>
        <p>一次性任务、普通问题、密码、Token、API Key 或私钥。</p>
      </div>
    </div>
  </>
);

const ProjectGuide = () => (
  <div className={styles.featureRows}>
    <div>
      <h3>建立项目</h3>
      <p>
        Owner/Admin 可在 <Path>AI context</Path> 中创建 Context Project， 并选择
        1 到 100 个工作区文档。
      </p>
    </div>
    <div>
      <h3>项目记忆</h3>
      <p>
        每位用户可保存自己的 Project Summary 或项目 Rule。作用范围是项目，
        所有权仍属于创建它的用户本人。
      </p>
    </div>
    <div>
      <h3>归档与删除</h3>
      <p>
        项目结束后先归档。只有已归档且不再被个人项目 Memory 引用的项目才
        能删除。
      </p>
    </div>
  </div>
);

const PermissionGuide = () => (
  <>
    <div className={styles.securityLead}>
      <LockIcon />
      <div>
        <strong>先检查权限，再进行相关度排序</strong>
        <p>
          用户只能搜索和使用自己有权读取的文档。Context Project 不会绕过
          原有文档权限。
        </p>
      </div>
    </div>
    <ul className={styles.bulletList}>
      <li>Rule、Automatic Memory 和 Project Summary 只属于当前用户。</li>
      <li>团队或项目范围只控制私人 Memory 在哪里使用，不代表共享。</li>
      <li>
        停用 Memory 不会删除记录，关闭 Automatic Memory 也不会清理旧内容。
      </li>
      <li>团队共同制度应写入有权限控制的权威文档，不要依赖个人 Memory。</li>
    </ul>
  </>
);

const SearchGuide = () => (
  <div className={styles.twoColumn}>
    <div>
      <h3>建立索引</h3>
      <p>
        在 <Path>Workspace settings &gt; Embedding</Path> 开启工作区语义
        索引、查看进度、上传补充文件或设置忽略文档。
      </p>
    </div>
    <div>
      <h3>没有结果时</h3>
      <p>
        依次检查文档读取权限、Embedding 开关、索引进度、忽略列表，以及
        当前对话是否选择了正确资料。
      </p>
    </div>
  </div>
);

const Troubleshooting = () => (
  <div className={styles.faqList}>
    {[
      [
        'Automatic Memory 为什么无法开启？',
        '请先登录并同步当前工作区，同时确认服务器已启用 Copilot。本地未同步工作区会禁用 Automatic Memory。',
      ],
      [
        'AI 为什么仍引用文档旧内容？',
        '这是快照机制的预期行为。点击 New Chat 新建对话，并重新选择更新后的文档。切换到另一个旧对话不能刷新旧快照。',
      ],
      [
        '关闭 Automatic Memory 后，旧记忆为什么还在？',
        '关闭开关只停止创建新记忆。请在 Automatic 列表中逐条停用或删除已有内容。',
      ],
      [
        '为什么普通成员不能创建 Context Project？',
        'Context Project 会改变工作区级文档分组，只能由 Owner/Admin 管理。普通成员仍可使用有权访问的项目。',
      ],
      [
        '为什么项目无法删除？',
        '项目必须先归档，并且不能再被任何用户的私人项目 Memory 引用。',
      ],
      [
        '为什么搜索不到已存在的文档？',
        '检查权限、Embedding 开关、索引进度、忽略列表和当前查询范围。',
      ],
    ].map(([question, answer]) => (
      <details className={styles.faqItem} key={question}>
        <summary>{question}</summary>
        <p>{answer}</p>
      </details>
    ))}
  </div>
);

const guideSections: GuideSection[] = [
  {
    id: 'start',
    index: '01',
    title: '快速开始',
    summary: '从准备资料到获得可验证答案。',
    searchText: '开始 入门 资料 上下文 提问 输出',
    content: <QuickStart />,
  },
  {
    id: 'snapshots',
    index: '02',
    title: '文档更新与快照',
    summary: '了解为什么旧对话不会自动读取修改后的文档。',
    searchText: '文档 更新 快照 最新 新对话 New Chat 同步',
    content: <DocumentSnapshots />,
  },
  {
    id: 'chat',
    index: '03',
    title: 'AI Chat',
    summary: '添加资料、管理对话并提出边界清晰的问题。',
    searchText: '聊天 对话 历史 上传 PDF TXT CSV 标签 集合 长对话',
    content: <ChatGuide />,
  },
  {
    id: 'memory',
    index: '04',
    title: 'Rule 与 Memory',
    summary: '管理个人规则、自动记忆和项目总结。',
    searchText:
      'Rule Automatic Memory Project Summary Rolling Summary 规则 自动记忆 停用 删除',
    content: <MemoryGuide />,
  },
  {
    id: 'projects',
    index: '05',
    title: '项目与团队',
    summary: '建立 Context Project，并理解成员与项目边界。',
    searchText: 'Context Project 项目 团队 Owner Admin 归档 删除 文档',
    content: <ProjectGuide />,
  },
  {
    id: 'permissions',
    index: '06',
    title: '权限与隐私',
    summary: '理解权限过滤、个人所有权和团队制度边界。',
    searchText: '权限 隐私 私人 用户 团队 共享 过滤 搜索 安全',
    content: <PermissionGuide />,
  },
  {
    id: 'search',
    index: '07',
    title: '索引与搜索',
    summary: '管理 Embedding，并排查搜索结果为空的问题。',
    searchText: 'Embedding 索引 搜索 无结果 忽略文档 上传 权限',
    content: <SearchGuide />,
  },
  {
    id: 'troubleshooting',
    index: '08',
    title: '常见问题',
    summary: '快速定位 Automatic Memory、项目和搜索问题。',
    searchText:
      '问题 故障 Automatic Memory 无法开启 项目无法删除 搜索不到 文档旧内容',
    content: <Troubleshooting />,
  },
];

export const filterGuideSections = (query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return guideSections;
  return guideSections.filter(section =>
    `${section.title} ${section.summary} ${section.searchText}`
      .toLocaleLowerCase()
      .includes(normalized)
  );
};

export const HelpCenterPage = () => {
  const workbench = useService(WorkbenchService).workbench;
  const workspaceDialogService = useService(WorkspaceDialogService);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => filterGuideSections(query), [query]);

  const openAIChat = useCallback(() => {
    workbench.open('/chat', { at: 'active' });
  }, [workbench]);

  const openAIContext = useCallback(() => {
    workspaceDialogService.open('setting', {
      activeTab: 'workspace:ai-context',
    });
  }, [workspaceDialogService]);

  const openEmbedding = useCallback(() => {
    workspaceDialogService.open('setting', {
      activeTab: 'workspace:embedding',
    });
  }, [workspaceDialogService]);

  return (
    <>
      <ViewTitle title="LocalMind 使用指南" />
      <ViewIcon icon="ai" />
      <ViewHeader>
        <Header
          left={
            <div className={styles.headerTitle}>
              <HelpIcon />
              <span>Help &amp; guide</span>
            </div>
          }
          right={
            <label className={styles.headerSearch}>
              <SearchIcon />
              <span className={styles.visuallyHidden}>搜索使用指南</span>
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索使用指南"
              />
              {query ? (
                <IconButton
                  size="20"
                  title="清除搜索"
                  icon={<CloseIcon />}
                  onClick={() => setQuery('')}
                />
              ) : null}
            </label>
          }
        />
      </ViewHeader>
      <ViewBody>
        <div className={styles.root}>
          <main className={styles.page}>
            <div className={styles.intro}>
              <div>
                <div className={styles.eyebrow}>LOCALMIND HELP CENTER</div>
                <h1>LocalMind 使用指南</h1>
                <p>
                  了解如何把工作区资料、AI Chat、个人记忆和项目上下文组织成
                  一条可靠、可复核的工作流。
                </p>
              </div>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  prefix={<AiOutlineIcon />}
                  onClick={openAIChat}
                >
                  打开 AI Chat
                </Button>
                <Button prefix={<SettingsIcon />} onClick={openAIContext}>
                  管理 AI 上下文
                </Button>
              </div>
            </div>

            <div className={styles.snapshotAlert} role="note">
              <WarningIcon />
              <div>
                <strong>文档更新后，AI Chat 会提醒你新建对话</strong>
                <p>
                  已有对话使用读取文档时保存的快照，不会自动拉取源文档的新
                  版本。文档保存后，输入框上方会显示可关闭的提示。请点击
                  提示中的 <Path>New Chat</Path>
                  ，并在新对话中重新选择或引用文档。关闭提示只对当前版本
                  生效；文档再次保存后会重新提示。
                </p>
              </div>
            </div>

            <div className={styles.layout}>
              <aside className={styles.toc} aria-label="指南目录">
                <div className={styles.tocLabel}>目录</div>
                {sections.map(section => (
                  <a href={`#${section.id}`} key={section.id}>
                    <span>{section.index}</span>
                    {section.title}
                  </a>
                ))}
                <button
                  type="button"
                  className={styles.embeddingButton}
                  onClick={openEmbedding}
                >
                  <SettingsIcon />
                  <span>打开 Embedding 设置</span>
                </button>
              </aside>

              <div className={styles.content}>
                {sections.length ? (
                  sections.map(section => (
                    <section
                      id={section.id}
                      className={styles.section}
                      data-testid={`guide-section-${section.id}`}
                      key={section.id}
                    >
                      <div className={styles.sectionHeading}>
                        <span>{section.index}</span>
                        <div>
                          <h2>{section.title}</h2>
                          <p>{section.summary}</p>
                        </div>
                      </div>
                      <div className={styles.sectionContent}>
                        {section.content}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className={styles.empty} role="status">
                    <SearchIcon />
                    <h2>没有匹配的内容</h2>
                    <p>尝试搜索“文档更新”“Automatic Memory”或“权限”。</p>
                    <Button onClick={() => setQuery('')}>清除搜索</Button>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </ViewBody>
    </>
  );
};

export const Component = () => {
  return <HelpCenterPage />;
};
