import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  PROJECT_IDS,
  PROJECT_NAMES,
  makeThreadListEntry,
} from "../../.ladle/story-fixtures";
import { RootComposeRecents } from "./RootComposeRecents";

export default {
  title: "views/Recents",
};

interface RecentsStageProps {
  children: ReactNode;
}

interface MakeRecentThreadArgs {
  overrides?: Partial<ThreadListEntry>;
}

function RecentsStage({ children }: RecentsStageProps) {
  return (
    <div className="w-[720px] max-w-full bg-background p-4">{children}</div>
  );
}

function makeRecentThread({
  overrides = {},
}: MakeRecentThreadArgs = {}): ThreadListEntry {
  return makeThreadListEntry({
    projectId: PROJECT_IDS.bb,
    ...overrides,
  });
}

const recentThreads: ThreadListEntry[] = [
  makeRecentThread({
    overrides: {
      id: "thr_recent_just_starting",
      title: "Trace thread creation feedback",
      titleFallback: "Trace thread creation feedback",
      status: "starting",
      createdAt: 300,
      latestAttentionAt: 300,
      runtime: {
        displayStatus: "starting",
        hostReconnectGraceExpiresAt: null,
      },
    },
  }),
  makeRecentThread({
    overrides: {
      id: "thr_recent_working",
      projectId: PROJECT_IDS.pierre,
      title: "Review prompt box spacing on iPhone",
      titleFallback: "Review prompt box spacing on iPhone",
      status: "active",
      createdAt: 250,
      latestAttentionAt: 250,
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
    },
  }),
  makeRecentThread({
    overrides: {
      id: "thr_recent_ready",
      title: "Backfill root compose tests",
      titleFallback: "Backfill root compose tests",
      createdAt: 200,
      latestAttentionAt: 200,
    },
  }),
];

const statusThreads: ThreadListEntry[] = [
  makeRecentThread({
    overrides: {
      id: "thr_recent_pending",
      title: "Needs environment approval",
      titleFallback: "Needs environment approval",
      hasPendingInteraction: true,
      status: "active",
      createdAt: 500,
      latestAttentionAt: 500,
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
    },
  }),
  makeRecentThread({
    overrides: {
      id: "thr_recent_reconnecting",
      projectId: PROJECT_IDS.pierre,
      title: "Host reconnecting after sleep",
      titleFallback: "Host reconnecting after sleep",
      status: "active",
      createdAt: 450,
      latestAttentionAt: 450,
      runtime: {
        displayStatus: "host-reconnecting",
        hostReconnectGraceExpiresAt: 600,
      },
    },
  }),
  makeRecentThread({
    overrides: {
      id: "thr_recent_error",
      title: "Runtime failed to start",
      titleFallback: "Runtime failed to start",
      status: "error",
      createdAt: 400,
      latestAttentionAt: 400,
      runtime: {
        displayStatus: "error",
        hostReconnectGraceExpiresAt: null,
      },
    },
  }),
];

const projectNamesById = new Map<string, string>([
  [PROJECT_IDS.bb, PROJECT_NAMES.bb],
  [PROJECT_IDS.pierre, PROJECT_NAMES.pierre],
]);

export function Overview() {
  return (
    <StoryCard labelWidth="170px">
      <StoryRow label="just starting">
        <RecentsStage>
          <RootComposeRecents
            highlightedThreadId="thr_recent_just_starting"
            projectNamesById={projectNamesById}
            showCreatingRow={false}
            threads={recentThreads}
          />
        </RecentsStage>
      </StoryRow>
      <StoryRow label="creating">
        <RecentsStage>
          <RootComposeRecents
            highlightedThreadId={null}
            projectNamesById={projectNamesById}
            showCreatingRow
            threads={recentThreads.slice(1)}
          />
        </RecentsStage>
      </StoryRow>
      <StoryRow label="status variants">
        <RecentsStage>
          <RootComposeRecents
            highlightedThreadId={null}
            projectNamesById={projectNamesById}
            showCreatingRow={false}
            threads={statusThreads}
          />
        </RecentsStage>
      </StoryRow>
    </StoryCard>
  );
}
