import {
  usePluginSlots,
  type PluginHomepageSectionSlot,
} from "@/lib/plugin-slots";
import { useRouteState } from "@/hooks/useRouteState";
import { getPluginHomepageSectionAnchor } from "@/lib/plugin-homepage-section";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginHomepageSections({
  lastCreatedThreadId = null,
}: {
  lastCreatedThreadId?: string | null;
}) {
  const { homepageSections } = usePluginSlots();
  if (homepageSections.length === 0) return null;
  return (
    <PluginHomepageSectionList
      sections={homepageSections}
      lastCreatedThreadId={lastCreatedThreadId}
    />
  );
}

function PluginHomepageSectionList({
  sections,
  lastCreatedThreadId,
}: {
  lastCreatedThreadId: string | null;
  sections: readonly PluginHomepageSectionSlot[];
}) {
  const { projectId } = useRouteState();
  return (
    <div className="contents" data-testid="plugin-homepage-sections">
      {sections.map((section) => (
        <section
          key={`${section.pluginId}/${section.id}/${section.generation}`}
          id={getPluginHomepageSectionAnchor(section.pluginId, section.id)}
          className={
            section.experimental_layout === "flush"
              ? "contents"
              : "mt-6 space-y-3"
          }
        >
          {section.experimental_layout === "flush" ? null : (
            <h2 className="text-sm font-semibold text-foreground">
              {section.title}
            </h2>
          )}
          <PluginSlotMount
            pluginId={section.pluginId}
            slotKind="homepageSection"
            slotId={section.id}
          >
            <section.component
              projectId={projectId ?? null}
              experimental_lastCreatedThreadId={lastCreatedThreadId}
            />
          </PluginSlotMount>
        </section>
      ))}
    </div>
  );
}
