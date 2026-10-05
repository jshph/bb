import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  CompactHomePage,
  HOME_THREADS,
  PhoneFrame,
} from "./mobile-home-story-fixtures";

export default {
  title: "views/Compact Home",
};

export function Overview() {
  return (
    <StoryCard labelWidth="170px">
      <StoryRow
        label="full-height recents"
        hint="393×852 with the real recents list spanning from the app chrome to the bottom. The composer stays pinned while rows scroll underneath it and dissolve into the fade."
      >
        <PhoneFrame>
          <CompactHomePage />
        </PhoneFrame>
      </StoryRow>
      <StoryRow
        label="short list"
        hint="with only a few threads the list starts directly below the app chrome"
      >
        <PhoneFrame>
          <CompactHomePage threads={HOME_THREADS.slice(0, 3)} />
        </PhoneFrame>
      </StoryRow>
    </StoryCard>
  );
}
