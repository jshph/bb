// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { ProjectModeSections } from "./ProjectList";
import { sidebarSectionOrderAtom } from "./sidebarCollapsedAtoms";

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: [] }),
  usePrimaryHost: () => undefined,
}));

vi.mock("@/hooks/queries/host-path-queries", () => ({
  isHostPathMissing: () => false,
  useHostPathExistence: () => ({ status: "ready", entries: [] }),
}));

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => false,
  usePromptDraftInputThreadIds: () => new Set<string>(),
}));

vi.mock("@/hooks/mutations/environment-mutations", () => ({
  useArchiveEnvironmentThreads: () => ({
    isPending: false,
    mutate: vi.fn(),
    variables: undefined,
  }),
  useUpdateEnvironment: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
    variables: undefined,
  }),
}));

vi.mock("@/hooks/useCreateThreadInWorktree", () => ({
  useCreateThreadInWorktree: () => vi.fn(),
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

function makeProject(id: string, name: string): ProjectResponse {
  return {
    id,
    kind: "standard",
    name,
    gitRemoteUrl: null,
    sources: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderProjectMode() {
  const projects = [
    makeProject("dormant", "Dormant"),
    makeProject("zulu", "Zulu"),
    makeProject("alpha", "Alpha"),
  ];
  const store = createStore();
  store.set(sidebarSectionOrderAtom, [
    "pinned",
    "project:dormant",
    "project:zulu",
    "project:alpha",
    "threads",
  ]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <MemoryRouter>
            <ProjectModeSections
              projects={projects}
              threads={[
                makeThreadListEntry({
                  id: "zulu-thread",
                  projectId: "zulu",
                  status: "active",
                }),
                makeThreadListEntry({
                  id: "alpha-thread",
                  projectId: "alpha",
                  hasPendingInteraction: true,
                }),
                makeThreadListEntry({
                  id: "dormant-thread",
                  projectId: "dormant",
                }),
              ]}
              draftThreadIds={new Set()}
              effectivePinnedThreadIds={new Set()}
              status="ready"
              showPinnedSection={false}
              pinnedSection={{ label: "Pinned", content: null }}
              pinnedReorderPending={false}
              pinnedRootNodes={[]}
              pinnedThreads={[]}
              onReorderPinnedThread={vi.fn()}
              threadsSection={{ label: "Threads" }}
              collapsedSectionIds={new Set()}
              collapsedThreadIds={new Set()}
              collapsedEnvironmentIds={new Set()}
              compareThreads={() => 0}
              onCreateProjectThread={vi.fn()}
              onToggleCollapsed={vi.fn()}
              onToggleThreadCollapsed={vi.fn()}
              onToggleEnvironmentCollapsed={vi.fn()}
            />
          </MemoryRouter>
        </JotaiProvider>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("project mode groups", () => {
  it("renders active projects alphabetically above dormant projects", () => {
    const { container } = renderProjectMode();
    const active = container.querySelector(
      '[data-sidebar-section-id="project-mode-active"]',
    );
    const projects = container.querySelector(
      '[data-sidebar-section-id="project-mode-projects"]',
    );

    expect(active?.textContent).toContain("Alpha");
    expect(active?.textContent).toContain("Zulu");
    expect((active?.textContent ?? "").indexOf("Alpha")).toBeLessThan(
      (active?.textContent ?? "").indexOf("Zulu"),
    );
    expect(projects?.textContent).toContain("Dormant");
    expect(projects?.textContent).not.toContain("Alpha");
    expect(projects?.textContent).not.toContain("Zulu");
  });
});
