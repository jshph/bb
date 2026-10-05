// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadArchiveDialog } from "./ThreadArchiveDialog";

afterEach(() => {
  cleanup();
});

function renderDialog({
  childThreadCount = 1,
  status = "idle",
  pending = false,
  workingThreadCount = 0,
}: {
  pending?: boolean;
  childThreadCount?: number;
  workingThreadCount?: number;
  status?: "idle" | "starting" | "active" | "stopping";
} = {}) {
  const onArchive = vi.fn();
  const onOpenChange = vi.fn();
  const thread = makeThread({ status });
  const view = render(
    <ThreadArchiveDialog
      target={{ thread, childThreadCount, workingThreadCount }}
      pending={pending}
      onOpenChange={onOpenChange}
      onArchive={onArchive}
    />,
  );
  return { onArchive, onOpenChange, thread, view };
}

describe("ThreadArchiveDialog", () => {
  it("announces the cascade with singular and plural child counts", () => {
    const { view } = renderDialog({ childThreadCount: 1 });
    expect(
      screen.getByText(/1 child thread will be archived with this thread\./),
    ).toBeTruthy();

    view.unmount();
    renderDialog({ childThreadCount: 3 });
    expect(
      screen.getByText(/3 child threads will be archived with this thread\./),
    ).toBeTruthy();
  });

  it("names the total number of threads in the title and action", () => {
    renderDialog({ childThreadCount: 3 });

    expect(
      screen.getByRole("heading", { name: "Archive 4 threads?" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Archive 4 threads" }),
    ).toBeTruthy();
  });

  it.each(["starting", "active", "stopping"] as const)(
    "warns that current work will stop for a %s thread",
    (status) => {
      renderDialog({ status });
      expect(screen.getByText(/This will stop current work\./)).toBeTruthy();
    },
  );

  it("omits the active-work warning for an idle thread", () => {
    renderDialog();
    expect(screen.queryByText(/This will stop current work\./)).toBeNull();
  });

  it("warns about cached active work anywhere in the thread tree", () => {
    renderDialog({ childThreadCount: 2, workingThreadCount: 2 });
    expect(
      screen.getByText(
        /2 threads are currently working in this thread tree\. Archiving will stop current work\./,
      ),
    ).toBeTruthy();
  });

  it("names a single thread when active work has no children to archive", () => {
    renderDialog({ childThreadCount: 0, workingThreadCount: 1 });
    expect(
      screen.getByRole("heading", { name: "Archive thread?" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive thread" })).toBeTruthy();
    expect(screen.getByText(/A thread is currently working/)).toBeTruthy();
    expect(screen.queryByText(/child thread/)).toBeNull();
  });

  it("focuses the archive action when opened for keyboard confirmation", () => {
    renderDialog();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Archive 2 threads" }),
    );
  });

  it("cancels with Escape without archiving", () => {
    const { onArchive, onOpenChange } = renderDialog();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("ignores confirmation while archiving is pending", () => {
    const { onArchive } = renderDialog({ pending: true });
    fireEvent.click(screen.getByRole("button", { name: "Archive 2 threads" }));
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("archives only when confirmation is accepted", () => {
    const { onArchive, onOpenChange, thread } = renderDialog({
      childThreadCount: 2,
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onArchive).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Archive 3 threads" }));
    expect(onArchive).toHaveBeenCalledWith({
      thread,
      childThreadCount: 2,
      workingThreadCount: 0,
    });
  });
});
