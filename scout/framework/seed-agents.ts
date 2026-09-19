/** First versions of the agents, written to Atlas on first boot. After that, they're edited in the UI. */
import type { AgentDefinition } from "./types";

const MODEL = "claude-sonnet-5";

export const SEED_AGENTS: AgentDefinition[] = [
  {
    name: "discover",
    description: "Finds new Saturday-trip leads for a focus and area, for a person to choose which to research.",
    model: MODEL,
    effort: "high",
    maxTurns: 30,
    tools: ["known_places", "recall", "remember", "web_search", "read_page", "geocode"],
    output: "propose_leads",
    handoff: "research",
    recall: ["agent/discover/lessons"],
    input: [
      { name: "focus", label: "Focus", type: "string", help: "lake, woods, town, history, or anything specific; blank = the thinnest kind" },
      { name: "count", label: "How many leads", type: "number", default: 5 },
      { name: "origin", label: "Look around", type: "place", help: "A town, ZIP, address, or lat,lng; blank = home (41144 Greenup, KY)" },
      { name: "radius", label: "Radius (miles)", type: "number", default: 150 },
    ],
    instructions: `Find new places a family from 41144 Greenup, Kentucky would enjoy for a Saturday day trip, matching the run's focus, inside the search area.

What fits: public places (parks, preserves, lakes with swimming beaches, historic sites, covered bridges, iron furnaces, mounds, river towns with murals or main streets, overlooks) with something to do for two to four hours, reachable by paved or packed-gravel road with room to turn a full-size vehicle around. Not restaurants, shops, private businesses, or places that need four-wheel drive.

How to work:
1. Call known_places first. Skip anything already a place, rejected, promoted, or being researched. With no focus, favor the kind with the fewest places.
2. Recall agent/discover/lessons for what worked before in this region.
3. Search broadly, then read enough of a page for each lead to be confident it is real, public, open, and in range. Leads are cheap: why a family would go, the town, rough coordinates when a page gives them, and the pages you used. Deep research happens later, one lead at a time, after a person picks.
4. Propose the count asked for plus one or two extras, so the person has a real choice.
5. If you learn something about searching this region that would help next time (a good directory, a dead end), remember it under agent/discover/lessons with its source.`,
  },
  {
    name: "research",
    description: "Researches one lead until a family could decide from the draft alone; approving it makes it a live place.",
    model: MODEL,
    effort: "high",
    maxTurns: 40,
    tools: ["recall", "remember", "web_search", "read_page", "geocode", "parking_near", "route_from_home", "photos_near", "photo_search"],
    output: "submit_place_draft",
    recall: ["lead/{item.id}", "place/{item.id}", "agent/research/lessons"],
    input: [
      { name: "item", label: "Lead", type: "json", required: true, help: "The lead from discover: id, title, kinds, why, where, approxLocation, sources" },
      { name: "parent", label: "From", type: "json", help: "The discover run it came from (search area)" },
    ],
    instructions: `Research the lead in the input's item until a family could decide from your draft alone, then submit it with submit_place_draft.

Settle, with sources:
- Where the family parks: the lot or entrance for the part of the place worth visiting, not the park's center or the nearest town. Use geocode for a first guess, parking_near to find mapped lots, and a page (the park's map or page, Wikipedia, a government listing) to confirm. Put the spot in locationWhat and the confirming page in locationSource.
- The road in: surface all the way to parking (PAVED or PACKED GRAVEL), room to turn a full-size vehicle around, and any clay that turns slick after rain. route_from_home shows the mapped approach; pages settle what the map doesn't.
- Water: any ford or low-water crossing on the way in. Established, maintained crossings are acceptable only with a full assessment: kind, waterway, where on the route, typical depth, when it floods or closes, bypass, USGS gauge if one exists, risks, and sources.
- The visit: what the family does, how long (onSiteMinutes), seasons, hours, gates, and fees.
- Photos: call photos_near and list the best openly licensed options, with alt text that says what each photo shows. When it finds none, try photo_search with the place's name and keep only photos that clearly show this place.

Give every field evidence (field, source, note, confirmed or inferred). When the sources don't settle something, answer unknown and the family will decide. Recall lead/<id> and place/<id> first, and remember durable facts (the parking spot, a crossing, a seasonal gate) under place/<id> with their source, so later runs don't redo the work. Put anything that would change a family's plans in concerns.

If the lead turns out not to fit (private, closed, needs four-wheel drive, no turnaround), submit it anyway with the reason as a concern and acknowledgeFlags: true, so a person can reject it and later runs skip it.`,
  },
  {
    name: "locate",
    description: "Pins an existing place to where the family parks and routes the drive from home; approving updates its drive time.",
    model: MODEL,
    effort: "high",
    maxTurns: 24,
    tools: ["recall", "remember", "geocode", "web_search", "read_page", "parking_near", "route_from_home"],
    output: "submit_location",
    recall: ["place/{placeId}", "agent/locate/lessons"],
    input: [
      { name: "placeId", label: "Place id", type: "string", required: true },
      { name: "title", label: "Title", type: "string" },
      { name: "photoAlt", label: "Photo description", type: "text" },
      { name: "note", label: "Note", type: "text" },
    ],
    instructions: `Pin the existing place in the input to the exact spot the family parks, so its drive from home can be routed.

- The photo description and note say which part of the place the family visits (a beach, an overlook, a trailhead). Pin that spot's parking lot or entrance, not the center of the park or the nearest town.
- geocode gives a first guess and is often a centroid or a namesake elsewhere. parking_near lists mapped lots with coordinates around a point. Confirm the spot with a page you read.
- Submit a best guess with submit_location as soon as you have a plausible point, then refine if it's flagged. Say whether the spot is confirmed by a source or inferred.
- Remember the parking spot under place/<placeId> with its source.`,
  },
];
