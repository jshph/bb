// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { RootComposeRecents } from "./RootComposeRecents";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_recent",
    projectId: "proj_recent",
    environmentId: null,
    providerId: "codex",
    title: "Recent activity",
    titleFallback: "Recent activity",
    sectionId: null,
    status: "active",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
      activeGoalCount: 1,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("RootComposeRecents", () => {
  it("stays visible at the desktop breakpoint", () => {
    const { container } = render(
      <MemoryRouter>
        <RootComposeRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </MemoryRouter>,
    );

    const section = container.querySelector("[data-root-compose-recents]");
    expect(section).not.toBeNull();
    expect(section?.classList).not.toContain("md:hidden");
  });

  it("shows the 15 most recent threads", () => {
    const threads = Array.from({ length: 17 }, (_, index) =>
      makeThread({
        id: `thr_${index + 1}`,
        title: `Thread ${index + 1}`,
        titleFallback: `Thread ${index + 1}`,
        latestAttentionAt: index + 1,
      }),
    );

    render(
      <MemoryRouter>
        <RootComposeRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={threads}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link")).toHaveLength(15);
    expect(screen.getByText("Thread 17")).not.toBeNull();
    expect(screen.queryByText("Thread 2")).toBeNull();
  });

  it("shows concurrent Plan activity before the runtime spinner", () => {
    render(
      <MemoryRouter>
        <RootComposeRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(screen.queryByLabelText("Goal active")).toBeNull();
  });

  it("shows runtime activity before concurrent workflow activity", () => {
    render(
      <MemoryRouter>
        <RootComposeRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              activity: {
                activeWorkflowCount: 1,
                activeBackgroundAgentCount: 1,
                activeBackgroundCommandCount: 1,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Thread working")).not.toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
  });

  it("keeps the working draft state ahead of runtime activity", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_recent-thr_recent-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );

    render(
      <MemoryRouter>
        <RootComposeRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByLabelText("Thread working with unsubmitted draft"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("includes only the resolved idle draft indicator in the link label", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_recent-thr_recent-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );

    render(
      <MemoryRouter>
        <RootComposeRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              status: "idle",
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
              runtime: {
                displayStatus: "idle",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", {
        name: "Open Recent activity — Thread has unsubmitted draft",
      }),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });
});
