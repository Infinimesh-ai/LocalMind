import { getProjectPath } from '@affine/core/desktop/route-paths';
import { CloseIcon } from '@blocksuite/icons/rc';
import type { ProjectReportAiContext } from '@localmind/office';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { WorkbenchConversation } from '../workbench-conversation';
import { useReportText } from './fields';
import * as styles from './studio.css';

const sessionKey = (reportId: string) =>
  `localmind:project-report-chat:${reportId}`;

function readSession(reportId: string) {
  try {
    return localStorage.getItem(sessionKey(reportId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export type ReportChatScope = {
  chapter?: { id: string; title: string };
  node?: { id: string; label: string };
};

/** Project AI conversation bound to one report; the session is remembered per report. */
export function ReportChatPane({
  projectId,
  reportId,
  reportContext,
  scope,
  onClearScope,
  onChanged,
}: {
  projectId: string;
  reportId: string;
  reportContext?: ProjectReportAiContext;
  scope: ReportChatScope;
  onClearScope: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useReportText();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState(() => readSession(reportId));
  // Fixed for the runtime's lifetime; flipping it would recreate the chat.
  const [startEmpty] = useState(() => !sessionId);
  const remember = useCallback(
    (id: string) => {
      try {
        localStorage.setItem(sessionKey(reportId), id);
      } catch {
        // Storage can be unavailable in private windows; the chat still works.
      }
      setSessionId(id);
    },
    [reportId]
  );
  return (
    <aside className={styles.chat} aria-label={t('studio.assistant')}>
      <div className={styles.chatScope} role="status">
        <span>{t('studio.scope')}</span>
        {scope.chapter ? (
          <span className={styles.scopeChip}>
            <span>
              {scope.chapter.title}
              {scope.node ? ` · ${scope.node.label}` : ''}
            </span>
            <button
              type="button"
              aria-label={t('studio.clearScope')}
              onClick={onClearScope}
            >
              <CloseIcon width={12} height={12} />
            </button>
          </span>
        ) : (
          <span className={styles.scopeChip}>
            <span>{t('studio.wholeReport')}</span>
          </span>
        )}
      </div>
      <div className={styles.chatBody}>
        <WorkbenchConversation
          key={`${projectId}:${reportId}`}
          selectedProjectId={projectId}
          selectedSessionId={sessionId}
          startEmpty={startEmpty}
          reportContext={reportContext}
          onSessionCreated={remember}
          onDocumentsChanged={onChanged}
          onOpenResource={resourceId =>
            navigate(getProjectPath(projectId, resourceId))
          }
        />
      </div>
    </aside>
  );
}
