import { buildHomepageSidebarData } from "@/lib/homepage-sidebar";
import type { GroupHomepageContest } from "@/lib/group-homepage";

export function buildHomepageSidebarSections(
  personalInput: Promise<Parameters<typeof buildHomepageSidebarData>[0]>,
  cards: Promise<GroupHomepageContest[]>,
) {
  return {
    personal: personalInput.then(buildHomepageSidebarData),
    matches: Promise.all([personalInput, cards]).then(([data, matchCards]) =>
      buildHomepageSidebarData({ ...data, cards: matchCards }),
    ),
  };
}
