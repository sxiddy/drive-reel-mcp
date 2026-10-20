/**
 * media.json: everything the MCP server analysed for a video (not only what the first cut uses),
 * uploaded alongside it so the website editor can swap clips in, add photos and change the music.
 */
export type MediaItem = {
  /** Analysis id: v1…, p1…, a1… (or u1… for files uploaded in the editor). */
  id: string;
  kind: "video" | "image" | "audio";
  /** Relative path inside the video's folder, e.g. "assets/v3.mp4". */
  src: string;
  /** Original file name in Drive. */
  name: string;
  duration?: number;
  width?: number;
  height?: number;
  /** Contact sheet (4 columns × 2 rows, 4px padding between tiles) for videos. */
  sheet?: string;
  /** Source time of each contact-sheet tile, left-to-right, top-to-bottom. */
  sheetTimes?: number[];
  /** Best moments (start seconds) found by the analysis. */
  highlights?: number[];
  /** e.g. "Generated soundtrack · 128 BPM" for audio. */
  label?: string;
  bpm?: number;
};

export type MediaManifest = { version: 1; items: MediaItem[] };

export const SHEET_GRID = { cols: 4, rows: 2, padding: 4 } as const;
