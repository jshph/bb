// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useContext, useLayoutEffect, useRef } from "react";
import { RootComposeHome } from "./RootComposeHome";
import { ComposerMaxHeightContext } from "@/components/promptbox/composer-max-height";
import { registerPaneComposerFocus } from "@/lib/pane-composer-focus";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ComposerRootProbe() {
  const rootRef = useRef<HTMLDivElement>(null);
  const maxHeight = useContext(ComposerMaxHeightContext);
  useLayoutEffect(
    () => registerPaneComposerFocus(rootRef.current!, () => false),
    [],
  );
  return (
    <div
      ref={rootRef}
      data-testid="composer-root"
      data-max-height={maxHeight}
    />
  );
}

function renderCompactHome() {
  return render(
    <RootComposeHome
      isCompact
      composer={<div data-testid="composer" />}
      compactScrollContent={<div data-testid="recents" />}
      homepageSections={null}
    />,
  );
}

describe("RootComposeHome", () => {
  it("keeps the composer above a scroll viewport that runs behind it", () => {
    renderCompactHome();

    const viewport = screen.getByTestId("root-compose-compact-scroll-viewport");
    const composer = screen.getByTestId("root-compose-compact-composer");

    expect(viewport.className).toContain("bottom-0");
    expect(viewport.className).toContain("overflow-y-auto");
    expect(composer.className).toContain("absolute");
    expect(composer.className).toContain("bottom-0");
    expect(composer.className).toContain("z-10");
    expect(composer.contains(screen.getByTestId("composer"))).toBe(true);
    expect(viewport.contains(screen.getByTestId("recents"))).toBe(true);
  });

  it("spans the scroll viewport from the app chrome to the bottom", () => {
    renderCompactHome();

    const viewport = screen.getByTestId("root-compose-compact-scroll-viewport");
    expect(viewport.style.top).toBe("56px");
    expect(viewport.className).toContain("bottom-0");
  });

  it("writes the measured composer spacer before the compact home paints", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "root-compose-compact-composer") {
          return 188;
        }
        return 0;
      },
    );

    renderCompactHome();

    const bottomSpacer = screen.getByTestId(
      "root-compose-compact-bottom-spacer",
    );
    expect(bottomSpacer.style.height).toBe("188px");
  });

  it("caps the composer so a tall draft keeps it below the app chrome row", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "root-compose-compact-home") return 480;
        if (this.dataset.testid === "root-compose-compact-composer") {
          return 682;
        }
        if (this.dataset.testid === "composer-root") return 600;
        return 0;
      },
    );

    render(
      <RootComposeHome
        isCompact
        composer={<ComposerRootProbe />}
        compactScrollContent={<div />}
        homepageSections={null}
      />,
    );

    expect(screen.getByTestId("composer-root").dataset.maxHeight).toBe(
      `${480 - 56 - (682 - 600)}`,
    );
  });

  it("rests a list that fits on the composer instead of the viewport top", () => {
    renderCompactHome();

    const content = screen.getByTestId("root-compose-compact-scroll-content");
    expect(content.className).toContain("min-h-full");
    expect(content.className).toContain("justify-end");
    expect(content.lastElementChild).toBe(
      screen.getByTestId("root-compose-compact-bottom-spacer"),
    );
  });

  it("shows recents below the composer in the desktop layout", () => {
    render(
      <RootComposeHome
        isCompact={false}
        composer={<div data-testid="composer" />}
        compactScrollContent={<div data-testid="recents" />}
        homepageSections={<div data-testid="homepage-sections" />}
      />,
    );

    const composer = screen.getByTestId("root-compose-compact-composer");
    const recents = screen.getByTestId("recents");
    expect(
      screen.queryByTestId("root-compose-compact-scroll-viewport"),
    ).toBeNull();
    expect(composer.nextElementSibling).toBe(recents);
    expect(recents.nextElementSibling).toBe(
      screen.getByTestId("homepage-sections"),
    );
  });

  it("drops the composer fade when nothing scrolls behind it", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(534);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(534);

    renderCompactHome();

    expect(screen.getByTestId("root-compose-compact-fade").hidden).toBe(true);
  });

  it("keeps the composer fade while rows overflow behind it", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(873);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(534);

    renderCompactHome();

    expect(screen.getByTestId("root-compose-compact-fade").hidden).toBe(false);
  });
});
