// @vitest-environment jsdom

import { ThreadRowNavigationProvider } from "../rows/threadRowNavigation.js";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { SidebarRenameProvider } from "../rows/SidebarInlineRename.js";
import { makeSidebarThread } from "../model/fixtures.js";

installTestPluginRuntime();
const { ProjectThreadTree } = await import("./ProjectRow.js");

function Slot({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ThreadRowNavigationProvider>
        <SidebarRenameProvider>{children}</SidebarRenameProvider>
      </ThreadRowNavigationProvider>
    </TooltipProvider>
  );
}

function makePlainThreads(count: number): SidebarThread[] {
  return Array.from({ length: count }, (_, index) =>
    makeSidebarThread({
      lastReadAt: 100,
      latestAttentionAt: 100,
      id: `thr_item_${index}`,
      title: `Thread ${index}`,
      titleFallback: `Thread ${index}`,
      createdAt: index,
      updatedAt: index,
    }),
  );
}

function renderThreadTree(
  threads: SidebarThread[],
  {
    progressiveDisclosureEnabled,
    selectedThreadId,
  }: { progressiveDisclosureEnabled?: boolean; selectedThreadId?: string } = {},
) {
  const tree = (entries: SidebarThread[]) => (
    <ProjectThreadTree
      threadListState={{ status: "ready", threads: entries }}
      progressiveDisclosureEnabled={progressiveDisclosureEnabled}
      compareThreads={() => 0}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={new Set()}
      collapsedEnvironmentIds={new Set()}
      onToggleThreadCollapsed={vi.fn()}
      onToggleEnvironmentCollapsed={vi.fn()}
    />
  );
  const view = renderSlot(
    { component: Slot },
    { children: tree(threads) },
    { sidebarThreads: { threads } },
  );
  return {
    ...view,
    rerenderThreads: (entries: SidebarThread[]) =>
      view.rerender(<Slot>{tree(entries)}</Slot>),
  };
}

describe("ProjectThreadTree", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the full list without a Show more control when disclosure is off", () => {
    renderThreadTree(makePlainThreads(17));

    expect(screen.getByText("Thread 0")).not.toBeNull();
    expect(screen.getByText("Thread 16")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("shows the unavailable state instead of rows when threads cannot load", () => {
    renderSlot(
      { component: Slot },
      {
        children: (
          <ProjectThreadTree
            threadListState={{ status: "unavailable" }}
            compareThreads={() => 0}
            collapsedThreadIds={new Set()}
            collapsedEnvironmentIds={new Set()}
            onToggleThreadCollapsed={vi.fn()}
            onToggleEnvironmentCollapsed={vi.fn()}
          />
        ),
      },
    );

    expect(screen.getByText("Threads unavailable")).not.toBeNull();
  });
});

describe("ProjectThreadTree progressive disclosure", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const enabled = { progressiveDisclosureEnabled: true };

  it("renders every item without controls when the list fits the limit", () => {
    renderThreadTree(makePlainThreads(5), enabled);

    expect(screen.getByText("Thread 0")).not.toBeNull();
    expect(screen.getByText("Thread 4")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it.each([
    ["busy", { activity: { backgroundAgents: 1 } }],
    ["waiting for input", { hasPendingInteraction: true }],
    ["unread finished", { isUnread: true, latestAttentionAt: 200 }],
  ] as const)(
    "keeps %s threads visible beyond the limit",
    (_label, overrides) => {
      const threads = makePlainThreads(7);
      threads[6] = makeSidebarThread({ ...threads[6], ...overrides });
      renderThreadTree(threads, enabled);

      expect(screen.getByText("Thread 4")).not.toBeNull();
      expect(screen.queryByText("Thread 5")).toBeNull();
      expect(screen.getByText("Thread 6")).not.toBeNull();
    },
  );

  it("keeps the selected thread visible beyond the limit", () => {
    renderThreadTree(makePlainThreads(7), {
      ...enabled,
      selectedThreadId: "thr_item_6",
    });

    expect(screen.getByText("Thread 4")).not.toBeNull();
    expect(screen.queryByText("Thread 5")).toBeNull();
    expect(screen.getByText("Thread 6")).not.toBeNull();
  });

  it("reveals ten more items per Show more click and hides the button when exhausted", () => {
    renderThreadTree(makePlainThreads(17), enabled);

    expect(screen.queryByText("Thread 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Thread 14")).not.toBeNull();
    expect(screen.queryByText("Thread 15")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Thread 16")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("does not spend Show more slots on attention items", () => {
    const threads = makePlainThreads(18);
    for (let index = 5; index <= 14; index += 1) {
      threads[index] = { ...threads[index], hasPendingInteraction: true };
    }
    renderThreadTree(threads, enabled);

    expect(screen.getByText("Thread 14")).not.toBeNull();
    expect(screen.queryByText("Thread 15")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Thread 17")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("retains revealed groups when attention clears or the list is reordered", () => {
    const threads = makePlainThreads(17);
    threads[5] = { ...threads[5], hasPendingInteraction: true };
    const { rerenderThreads } = renderThreadTree(threads, enabled);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Thread 15")).not.toBeNull();

    const settled = threads.map((thread) => ({
      ...thread,
      hasPendingInteraction: false,
    }));
    rerenderThreads(settled);
    expect(screen.getByText("Thread 15")).not.toBeNull();
    expect(screen.queryByText("Thread 16")).toBeNull();

    rerenderThreads([...settled].reverse());
    expect(screen.getByText("Thread 0")).not.toBeNull();
    expect(screen.getByText("Thread 15")).not.toBeNull();
  });

  it("focuses the first newly revealed thread only for keyboard expansion", () => {
    renderThreadTree(makePlainThreads(17), enabled);
    const showMore = screen.getByRole("button", { name: "Show more" });
    showMore.focus();
    fireEvent.click(showMore, { detail: 1 });
    expect(document.activeElement).toBe(showMore);

    fireEvent.click(showMore, { detail: 0 });
    expect(document.activeElement?.getAttribute("data-sidebar-thread-id")).toBe(
      "thr_item_15",
    );
  });

  it("keeps a parent group visible when a nested thread needs attention", () => {
    const threads = makePlainThreads(8);
    threads[7] = {
      ...threads[7],
      parentThreadId: threads[6].id,
      hasPendingInteraction: true,
    };
    renderThreadTree(threads, enabled);

    expect(screen.queryByText("Thread 5")).toBeNull();
    expect(screen.getByText("Thread 6")).not.toBeNull();
    expect(screen.getByText("Thread 7")).not.toBeNull();
  });

  it("ranks a root tree by its most recently finished descendant", () => {
    const read = { lastReadAt: 1_000 };
    const threads = [
      makeSidebarThread({
        ...read,
        id: "older-parent",
        title: "Older parent",
        createdAt: 1,
        latestAttentionAt: 1,
      }),
      makeSidebarThread({
        ...read,
        id: "recent-child",
        parentThreadId: "older-parent",
        title: "Recent child",
        createdAt: 2,
        latestAttentionAt: 100,
      }),
      ...Array.from({ length: 5 }, (_, index) =>
        makeSidebarThread({
          ...read,
          id: `other-${index}`,
          title: `Other ${index}`,
          createdAt: index + 3,
          latestAttentionAt: index + 10,
        }),
      ),
    ];
    renderThreadTree(threads, enabled);

    expect(screen.getByText("Older parent")).not.toBeNull();
    expect(screen.getByText("Recent child")).not.toBeNull();
    expect(screen.queryByText("Other 0")).toBeNull();
    expect(screen.getByRole("button", { name: "Show more" })).not.toBeNull();
  });
});
