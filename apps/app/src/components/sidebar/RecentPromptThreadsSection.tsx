import { useEffect, useMemo, useState } from "react";
import { useSetAtom } from "jotai";
import { NavLink } from "react-router-dom";
import type { ThreadListEntry } from "@bb/domain";
import type { SidebarRecentUserPrompt } from "@bb/server-contract";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { getThreadRoutePath } from "@/lib/route-paths";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
} from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { SidebarThreadTitle } from "./SidebarThreadTitleMentions";
import { ThreadStatusGlyph } from "./ThreadRow";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";
import {
  buildRecentPromptRoots,
  type RecentPromptRoot,
} from "./recentPromptRoots";

const RECENT_WINDOW_TICK_MS = 60_000;

interface RecentPromptThreadsSectionProps {
  onProjectSelect?: () => void;
  projectNamesById: ReadonlyMap<string, string>;
  recentUserPrompts: readonly SidebarRecentUserPrompt[];
  selectedThreadId?: string;
  threads: readonly ThreadListEntry[];
}

function RecentPromptThreadRow({
  entry,
  isActive,
  onProjectSelect,
}: {
  entry: RecentPromptRoot;
  isActive: boolean;
  onProjectSelect?: () => void;
}) {
  const { projectName, thread } = entry;
  const title = getThreadDisplayTitle(thread);
  const isUnreadDone = isUnreadDoneThread(thread);
  const setConversationCollapsed = useSetAtom(
    getThreadConversationCollapsedAtom(thread.id),
  );
  return (
    <NavLink
      to={getThreadRoutePath({
        projectId: thread.projectId,
        threadId: thread.id,
      })}
      aria-label={`Open ${title} in ${projectName}`}
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        LIST_HOVER_TRANSITION,
        isActive
          ? SIDEBAR_ROW_SELECTED_STATE_CLASS
          : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
      )}
      onClick={() => {
        setConversationCollapsed(false);
        onProjectSelect?.();
      }}
    >
      <span className="min-w-0 flex-1 truncate" title={title}>
        <SidebarThreadTitle title={title} />
      </span>
      <span
        className="max-w-[30%] shrink-0 truncate text-xs text-subtle-foreground"
        title={projectName}
      >
        {projectName}
      </span>
      <span className={SIDEBAR_ROW_GLYPH_SLOT_CLASS}>
        <ThreadStatusGlyph
          hasPendingInteraction={thread.hasPendingInteraction}
          hasUnsubmittedDraft={false}
          hasUnreadError={isUnreadDone && thread.status === "error"}
          hasUnreadSuccess={isUnreadDone && thread.status !== "error"}
          isBackgroundAgentActive={hasActiveBackgroundAgentActivity(thread)}
          isBackgroundCommandActive={hasActiveBackgroundCommandActivity(thread)}
          isGoalActive={hasActiveGoalActivity(thread)}
          isPlanModeActive={hasActivePlanModeActivity(thread)}
          isRuntimeActive={isRuntimeBusyThread(thread)}
          isWorkflowActive={hasActiveWorkflowActivity(thread)}
        />
      </span>
    </NavLink>
  );
}

export function RecentPromptThreadsSection({
  onProjectSelect,
  projectNamesById,
  recentUserPrompts,
  selectedThreadId,
  threads,
}: RecentPromptThreadsSectionProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Date.now()),
      RECENT_WINDOW_TICK_MS,
    );
    return () => window.clearInterval(interval);
  }, []);
  const recentRoots = useMemo(
    () =>
      buildRecentPromptRoots({
        now,
        projectNamesById,
        recentUserPrompts,
        threads,
      }),
    [now, projectNamesById, recentUserPrompts, threads],
  );

  if (recentRoots.length === 0) return null;
  return (
    <TopLevelSidebarSection label="Recent">
      <div
        className="space-y-px"
        aria-label="Threads prompted in the past 24 hours"
      >
        {recentRoots.map((entry) => (
          <RecentPromptThreadRow
            key={entry.thread.id}
            entry={entry}
            isActive={selectedThreadId === entry.thread.id}
            onProjectSelect={onProjectSelect}
          />
        ))}
      </div>
    </TopLevelSidebarSection>
  );
}
