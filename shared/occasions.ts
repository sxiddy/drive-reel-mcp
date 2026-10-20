import type { StyleDef, StyleId } from "./styles";

/**
 * What the occasion implies for the edit. The user types the occasion freely ("Riya's 21st",
 * "VinHack 2026 aftermovie"); it's matched to a profile that steers which styles Claude should
 * build on, the tone of titles and captions, and how the generated soundtrack feels.
 */
export type OccasionProfile = {
  id: string;
  label: string;
  /** Best-fitting styles first. Claude is asked to build most themes on these. */
  styles: StyleId[];
  /** Styles that clash with the occasion (e.g. a glitchy neon reel for a memorial). */
  avoid: StyleId[];
  tone: string;
  captionIdeas: string;
  /** Adjustments to the generated soundtrack. */
  music?: { tempo?: number; maxDrums?: "none" | "soft" };
};

const PROFILES: (OccasionProfile & { match: RegExp })[] = [
  {
    id: "memorial",
    match: /memorial|tribute|in loving memory|remembrance|funeral|celebration of life/i,
    label: "a tribute",
    styles: ["elegant", "nostalgic", "cinematic"],
    avoid: ["hype", "neon", "playful"],
    tone: "Gentle and respectful; let shots breathe, no flashy text.",
    captionIdeas: "names, years, a short quote; nothing jokey",
    music: { tempo: 0.85, maxDrums: "none" },
  },
  {
    id: "wedding",
    match: /wedding|engagement|marriage|anniversary|shaadi|reception|sangeet|mehendi|haldi|bride|groom/i,
    label: "a wedding or anniversary",
    styles: ["elegant", "cinematic", "nostalgic"],
    avoid: ["neon", "hype"],
    tone: "Romantic and warm; vows, first looks, the families, the dance floor at the end.",
    captionIdeas: "the couple's names, the date and venue, a line from the vows",
    music: { tempo: 0.95, maxDrums: "soft" },
  },
  {
    id: "hackathon",
    match: /hack|ideathon|code|coding|dev ?fest|demo day|startup|buildathon|tech/i,
    label: "a hackathon or tech event",
    styles: ["hype", "neon", "cinematic", "clean"],
    avoid: ["elegant"],
    tone: "Energy and grind: arrival, late-night coding, mentors, pitches, the winners.",
    captionIdeas: "hour counters (Hour 1, Hour 24), team names, 'the final pitch', the prize",
  },
  {
    id: "birthday",
    match: /birthday|b'?day|turns \d+|\b\d{1,2}(st|nd|rd|th)\b|sweet sixteen/i,
    label: "a birthday",
    styles: ["playful", "nostalgic", "hype"],
    avoid: ["clean"],
    tone: "Fun and personal; the cake, the friends, the surprise.",
    captionIdeas: "the person's name and age, inside jokes, 'make a wish'",
  },
  {
    id: "graduation",
    match: /graduat|convocation|farewell|reunion|batch of|class of|alumni|college fest|fest\b/i,
    label: "a graduation, farewell or college fest",
    styles: ["nostalgic", "cinematic", "hype"],
    avoid: [],
    tone: "Bittersweet pride; friends, the stage moment, the last group photo.",
    captionIdeas: "the batch year, names, 'one last time'",
  },
  {
    id: "sports",
    match: /match|tournament|league|cup\b|marathon|race|sports|championship|final\b|game day/i,
    label: "a sports event",
    styles: ["hype", "cinematic", "neon"],
    avoid: ["elegant", "nostalgic"],
    tone: "Build tension to the decisive moment, then the celebration.",
    captionIdeas: "the score, team names, the clutch moment",
  },
  {
    id: "party",
    match: /party|concert|gig|festival|dj|rave|nightlife|new year|diwali|holi|christmas/i,
    label: "a party, festival or concert",
    styles: ["neon", "hype", "playful"],
    avoid: ["clean"],
    tone: "Lights, crowd and music; cut hard on the beat.",
    captionIdeas: "the artist or venue, the night's date, crowd chants",
  },
  {
    id: "travel",
    match: /trip|travel|vacation|holiday|tour\b|trek|hike|walk|beach|road ?trip|nature|national park|mountain/i,
    label: "a trip or the outdoors",
    styles: ["cinematic", "nostalgic", "elegant"],
    avoid: ["neon"],
    tone: "Sense of place: wide establishing shots, the journey, golden hour.",
    captionIdeas: "place names, day numbers, distances, coordinates",
    music: { maxDrums: "soft" },
  },
  {
    id: "corporate",
    match: /launch|product|conference|summit|company|offsite|corporate|promo|team building|townhall|expo/i,
    label: "a company or product event",
    styles: ["clean", "cinematic", "hype"],
    avoid: ["playful"],
    tone: "Polished and clear: who was there, what was announced, the takeaway.",
    captionIdeas: "the event name, speaker names, the key announcement",
  },
];

const GENERAL: OccasionProfile = {
  id: "general",
  label: "a general event",
  styles: ["cinematic", "hype", "nostalgic", "clean"],
  avoid: [],
  tone: "Tell the day in order: arrival, the main moment, the send-off.",
  captionIdeas: "the event name, the date, the place",
};

export function occasionProfile(occasion: string): OccasionProfile {
  const hit = PROFILES.find((p) => p.match.test(occasion));
  if (!hit) return GENERAL;
  const { match: _m, ...profile } = hit;
  return profile;
}

/** The style's soundtrack, adjusted for the occasion (a memorial reel gets no drums and a slower pulse). */
export function musicFor(style: StyleDef, occasion: string): StyleDef["music"] {
  const adj = occasionProfile(occasion).music;
  if (!adj) return style.music;
  const order = ["none", "soft", "halftime", "four"] as const;
  const drums = adj.maxDrums && order.indexOf(style.music.drums) > order.indexOf(adj.maxDrums) ? adj.maxDrums : style.music.drums;
  return { ...style.music, bpm: Math.round(style.music.bpm * (adj.tempo ?? 1)), drums };
}
