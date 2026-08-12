// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { recentPromptSectionCollapsedAtom } from "./sidebarCollapsedAtoms";
import {
  RECENT_PROMPT_COMPACT_LIMIT,
  RecentPromptThreadsSection,
} from "./RecentPromptThreadsSection";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("RecentPromptThreadsSection", () => {
  it("pins a collapsible ten-row page and reveals all rows on request", () => {
    const now = Date.now();
    const threads = Array.from(
      { length: RECENT_PROMPT_COMPACT_LIMIT + 1 },
      (_, index) =>
        makeThreadListEntry({
          id: `thr_${index}`,
          projectId: "project-a",
          title: `Recent ${index}`,
        }),
    );
    const onRevealThread = vi.fn();
    const store = createStore();
    store.set(recentPromptSectionCollapsedAtom, false);
    const result = render(
      <Provider store={store}>
        <MemoryRouter>
          <RecentPromptThreadsSection
            onRevealThread={onRevealThread}
            projectNamesById={new Map([["project-a", "Alpha"]])}
            recentUserPrompts={threads.map((thread, index) => ({
              threadId: thread.id,
              latestUserPromptAt: now - index,
            }))}
            threads={threads}
          />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getAllByRole("link")).toHaveLength(
      RECENT_PROMPT_COMPACT_LIMIT,
    );
    const header = screen
      .getByTitle("Recent")
      .closest('[data-sidebar-sticky-tier="label"]');
    expect(header?.getAttribute("data-sidebar-sticky-scope")).toBe("stack");
    expect(header?.closest("[data-sidebar-sticky-group]")?.className).toContain(
      "contents",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show all Recent threads; 1 hidden" }),
    );
    expect(screen.getAllByRole("link")).toHaveLength(
      RECENT_PROMPT_COMPACT_LIMIT + 1,
    );
    fireEvent.click(
      screen.getByRole("link", { name: "Open Recent 0 in Alpha" }),
    );
    expect(onRevealThread).toHaveBeenCalledWith("thr_0");

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Recent section" }),
    );
    expect(result.container.querySelector('[aria-label^="Open Recent"]')).toBe(
      null,
    );
  });
  it("mirrors working and ready-for-action states from normal thread rows", () => {
    const now = Date.now();
    const threads = [
      makeThreadListEntry({
        id: "thr_working",
        projectId: "project-a",
        title: "Working thread",
        runtime: {
          displayStatus: "starting",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      makeThreadListEntry({
        id: "thr_ready",
        projectId: "project-a",
        title: "Ready thread",
        hasPendingInteraction: true,
        runtime: {
          displayStatus: "starting",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    ];
    const store = createStore();
    store.set(recentPromptSectionCollapsedAtom, false);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <RecentPromptThreadsSection
            projectNamesById={new Map([["project-a", "Alpha"]])}
            recentUserPrompts={threads.map((thread, index) => ({
              threadId: thread.id,
              latestUserPromptAt: now - index,
            }))}
            threads={threads}
          />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByLabelText("Thread working")).not.toBeNull();
    expect(screen.getByLabelText("Thread needs user input")).not.toBeNull();
  });
});
