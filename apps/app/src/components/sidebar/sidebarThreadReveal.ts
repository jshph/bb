const SIDEBAR_THREAD_REVEAL_MAX_FRAMES = 12;

interface ScheduleSidebarThreadRevealArgs {
  cancelFrame?: (frameId: number) => void;
  maxFrames?: number;
  onSettled: () => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  root?: ParentNode;
  threadId: string;
}

export function findSidebarThreadRow(
  root: ParentNode,
  threadId: string,
): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(
    "[data-sidebar-thread-id]",
  )) {
    if (element.dataset.sidebarThreadId === threadId) return element;
  }
  return null;
}

/**
 * Waits through the route-driven expand/elision/virtualization commits before
 * revealing the ordinary sidebar row selected from a duplicate Recent link.
 */
export function scheduleSidebarThreadReveal({
  cancelFrame = window.cancelAnimationFrame.bind(window),
  maxFrames = SIDEBAR_THREAD_REVEAL_MAX_FRAMES,
  onSettled,
  requestFrame = window.requestAnimationFrame.bind(window),
  root = document,
  threadId,
}: ScheduleSidebarThreadRevealArgs): () => void {
  let attempts = 0;
  let frameId = 0;
  let cancelled = false;

  const reveal = () => {
    if (cancelled) return;
    const row = findSidebarThreadRow(root, threadId);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      onSettled();
      return;
    }
    attempts += 1;
    if (attempts >= maxFrames) {
      onSettled();
      return;
    }
    frameId = requestFrame(reveal);
  };

  frameId = requestFrame(reveal);
  return () => {
    cancelled = true;
    cancelFrame(frameId);
  };
}
