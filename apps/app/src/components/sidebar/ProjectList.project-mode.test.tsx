// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
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

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_test",
    projectId: "proj_alpha",
    environmentId: null,
    providerId: "codex",
    title: "Test thread",
    titleFallback: "Test thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 2,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

interface RenderProjectModeOptions {
  draftThreadIds?: ReadonlySet<string>;
  effectivePinnedThreadIds?: ReadonlySet<string>;
  projects?: ProjectResponse[];
  status?: "loading" | "ready" | "unavailable";
  threads?: ThreadListEntry[];
}

function renderProjectMode({
  draftThreadIds = new Set(),
  effectivePinnedThreadIds = new Set(),
  projects = [],
  status = "ready",
  threads = [],
}: RenderProjectModeOptions = {}) {
  const store = createStore();
  store.set(sidebarSectionOrderAtom, [
    "pinned",
    "project:proj_delta",
    "project:proj_beta",
    "threads",
    "project:proj_alpha",
    "project:proj_gamma",
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
              personalProjectName="Personal"
              threads={threads}
              draftThreadIds={draftThreadIds}
              effectivePinnedThreadIds={effectivePinnedThreadIds}
              status={status}
              isReady
              showPinnedSection={false}
              pinnedSection={{ label: "Pinned", content: null }}
              threadsSection={{ label: "Threads" }}
              collapsedSectionIds={new Set()}
              collapsedThreadIds={new Set()}
              collapsedEnvironmentIds={new Set()}
              compareThreads={() => 0}
              renderSectionDisplayOptions={() => null}
              isSectionDisplayOptionsOpen={() => false}
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

function findStickyLabelByText(container: ParentNode | null, text: string) {
  return Array.from(
    container?.querySelectorAll('[data-sidebar-sticky-tier="label"]') ?? [],
  ).find((element) => element.textContent?.includes(text));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("project mode Active and Projects groups", () => {
  it("renders Personal first, active projects alphabetically, and no duplicate project rows", () => {
    const projects = [
      makeProject("proj_delta", "Delta"),
      makeProject("proj_beta", "Beta"),
      makeProject("proj_alpha", "Alpha"),
      makeProject("proj_gamma", "Gamma"),
    ];
    const pinnedThread = makeThread({
      id: "thr_pinned",
      projectId: "proj_gamma",
      status: "active",
    });
    const { container } = renderProjectMode({
      projects,
      threads: [
        makeThread({
          id: "thr_personal",
          projectId: PERSONAL_PROJECT_ID,
          status: "active",
          title: "Personal work",
        }),
        makeThread({
          id: "thr_beta",
          projectId: "proj_beta",
          status: "active",
        }),
        makeThread({
          id: "thr_alpha",
          projectId: "proj_alpha",
          hasPendingInteraction: true,
        }),
        pinnedThread,
      ],
      effectivePinnedThreadIds: new Set([pinnedThread.id]),
    });

    const active = container.querySelector(
      '[data-sidebar-section-id="project-mode-active"]',
    );
    const dormant = container.querySelector(
      '[data-sidebar-section-id="project-mode-projects"]',
    );
    expect(active).not.toBeNull();
    expect(dormant).not.toBeNull();
    if (!(active instanceof HTMLElement) || !dormant) {
      throw new Error("Expected project mode groups");
    }

    const activeText = active.textContent ?? "";
    expect(activeText.indexOf("Personal")).toBeLessThan(
      activeText.indexOf("Alpha"),
    );
    expect(activeText.indexOf("Alpha")).toBeLessThan(
      activeText.indexOf("Beta"),
    );
    expect(dormant.textContent).toContain("Delta");
    expect(dormant.textContent).toContain("Gamma");
    expect((dormant.textContent ?? "").indexOf("Delta")).toBeLessThan(
      (dormant.textContent ?? "").indexOf("Gamma"),
    );

    const activeHeading = active.querySelector(
      '[data-sidebar-project-mode-heading="project-mode-active"]',
    );
    const dormantHeading = dormant.querySelector(
      '[data-sidebar-project-mode-heading="project-mode-projects"]',
    );
    expect(activeHeading).not.toBeNull();
    expect(dormantHeading).not.toBeNull();
    expect(activeHeading?.hasAttribute("data-sidebar-sticky-tier")).toBe(false);
    expect(dormantHeading?.hasAttribute("data-sidebar-sticky-tier")).toBe(
      false,
    );
    expect(findStickyLabelByText(active, "Personal")).toBeDefined();
    expect(
      active.querySelector(
        '[data-sidebar-project-id="proj_alpha"] [data-sidebar-sticky-tier="label"]',
      ),
    ).not.toBeNull();
    expect(
      dormant.querySelector(
        '[data-sidebar-project-id="proj_delta"] [data-sidebar-sticky-tier="label"]',
      ),
    ).not.toBeNull();

    for (const project of projects) {
      expect(
        container.querySelectorAll(`[data-sidebar-project-id="${project.id}"]`),
      ).toHaveLength(1);
    }
  });

  it("keeps active rows non-draggable while dormant rows retain reorder bindings", () => {
    const { container } = renderProjectMode({
      projects: [
        makeProject("proj_alpha", "Alpha"),
        makeProject("proj_delta", "Delta"),
        makeProject("proj_gamma", "Gamma"),
      ],
      threads: [makeThread({ status: "active" })],
    });
    const activeLabel = container.querySelector(
      '[data-sidebar-project-id="proj_alpha"] [data-sidebar-sticky-tier="label"]',
    );
    const dormantLabel = container.querySelector(
      '[data-sidebar-project-id="proj_delta"] [data-sidebar-sticky-tier="label"]',
    );

    expect(activeLabel?.getAttribute("role")).not.toBe("button");
    expect(dormantLabel?.getAttribute("role")).toBe("button");
  });

  it("does not promote a project for a draft alone", () => {
    const draftThread = makeThread({ id: "thr_draft" });
    const { container } = renderProjectMode({
      projects: [makeProject("proj_alpha", "Alpha")],
      threads: [draftThread],
      draftThreadIds: new Set([draftThread.id]),
    });
    const active = container.querySelector(
      '[data-sidebar-section-id="project-mode-active"]',
    );
    const dormant = container.querySelector(
      '[data-sidebar-section-id="project-mode-projects"]',
    );

    expect(active).toBeNull();
    expect(
      dormant?.querySelector('[data-sidebar-project-id="proj_alpha"]'),
    ).not.toBeNull();
  });

  it("omits empty groups and keeps Personal in its qualifying group", () => {
    const dormantOnlyRender = renderProjectMode({
      projects: [makeProject("proj_delta", "Delta")],
    });
    expect(
      dormantOnlyRender.container.querySelector(
        '[data-sidebar-section-id="project-mode-active"]',
      ),
    ).toBeNull();
    const dormantGroup = dormantOnlyRender.container.querySelector(
      '[data-sidebar-section-id="project-mode-projects"]',
    );
    expect(findStickyLabelByText(dormantGroup, "Personal")).toBeDefined();
    dormantOnlyRender.unmount();

    const activeOnlyRender = renderProjectMode({
      projects: [makeProject("proj_alpha", "Alpha")],
      threads: [
        makeThread({ status: "active" }),
        makeThread({
          id: "thr_personal",
          projectId: PERSONAL_PROJECT_ID,
          status: "active",
        }),
      ],
    });
    const activeGroup = activeOnlyRender.container.querySelector(
      '[data-sidebar-section-id="project-mode-active"]',
    );
    expect(
      activeOnlyRender.container.querySelector(
        '[data-sidebar-section-id="project-mode-projects"]',
      ),
    ).toBeNull();
    expect(findStickyLabelByText(activeGroup, "Personal")).toBeDefined();
    expect((activeGroup?.textContent ?? "").indexOf("Personal")).toBeLessThan(
      (activeGroup?.textContent ?? "").indexOf("Alpha"),
    );
  });
});
