import { describe, expect, it } from "vitest";

import { discoveryFiltersFromCampaign } from "../../src/components/LeadDiscovery/LeadDiscoveryTab.js";

describe("LeadDiscoveryTab campaign filters", () => {
  it("maps campaign audience filters into discovery controls", () => {
    const filters = discoveryFiltersFromCampaign({
      filterTags: ["stage:series-a", "signal:yc-backed"],
      filterRegion: "__US__",
      filterStage: "Series A",
      filterBatch: "W26",
      filterIsHiring: true,
    });

    expect(filters).toEqual({
      selectedTags: ["stage:series-a", "signal:yc-backed"],
      regionFilter: "us",
      stageFilter: "Series A",
      batchFilter: "W26",
      isHiring: true,
    });
  });
});
