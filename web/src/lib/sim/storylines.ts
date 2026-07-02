import type { StorylineSpec } from "./types";

// Scripted multi-step event replays. Each step injects a scenario at a tick
// offset from the storyline's start; the engine fires steps in order and the
// storyline completes once every step has run and dissipated. These are
// dramatizations inspired by real event patterns, not real data.

export const STORYLINES: StorylineSpec[] = [
  {
    id: "santa-ana-fire",
    label: "Wind-driven fire outbreak",
    blurb:
      "A Santa Ana-style fire day: a SoCal ignition, a second fire in the Desert Southwest, and a node knocked off the network mid-event.",
    steps: [
      { atTick: 0, kind: "wildfire", regionId: "socal" },
      { atTick: 18, kind: "dropout", regionId: "socal" },
      { atTick: 40, kind: "wildfire", regionId: "southwest" },
    ],
  },
  {
    id: "gulf-landfall",
    label: "Gulf hurricane landfall",
    blurb:
      "A Harvey-pattern landfall: hurricane conditions cross the Gulf Coast, then stalled rain drives flash flooding there and up the Mississippi Valley.",
    steps: [
      { atTick: 0, kind: "hurricane", regionId: "gulf" },
      { atTick: 45, kind: "flood", regionId: "gulf" },
      { atTick: 85, kind: "flood", regionId: "midwest" },
    ],
  },
  {
    id: "plains-outbreak",
    label: "Plains severe-weather outbreak",
    blurb:
      "A spring outbreak day: back-to-back tornado-signature wind events over the Southern Plains with flooding downstream in the Mississippi Valley.",
    steps: [
      { atTick: 0, kind: "tornado", regionId: "plains" },
      { atTick: 32, kind: "tornado", regionId: "plains" },
      { atTick: 50, kind: "flood", regionId: "midwest" },
    ],
  },
  {
    id: "noreaster",
    label: "Northeast nor'easter",
    blurb:
      "A nor'easter tracks up the coast: a winter storm crosses the Northeast Corridor, coastal flooding follows, and stagnant air degrades air quality after.",
    steps: [
      { atTick: 0, kind: "winter_storm", regionId: "northeast" },
      { atTick: 40, kind: "flood", regionId: "northeast" },
      { atTick: 90, kind: "air_quality", regionId: "northeast" },
    ],
  },
];

export const STORYLINE_BY_ID = new Map(STORYLINES.map((s) => [s.id, s]));
