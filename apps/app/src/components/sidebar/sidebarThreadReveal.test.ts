// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { scheduleSidebarThreadReveal } from "./sidebarThreadReveal";

describe("scheduleSidebarThreadReveal", () => {
  it("retries until a route-expanded thread row mounts, then scrolls it", () => {
    const root = document.createElement("div");
    const callbacks: FrameRequestCallback[] = [];
    const onSettled = vi.fn();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    scheduleSidebarThreadReveal({
      cancelFrame: vi.fn(),
      onSettled,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      root,
      threadId: 'thr_with_"quotes"',
    });

    callbacks.shift()?.(0);
    const row = document.createElement("a");
    row.dataset.sidebarThreadId = 'thr_with_"quotes"';
    root.append(row);
    callbacks.shift()?.(1);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
