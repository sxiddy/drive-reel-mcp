import type { EditPlan } from "../shared/plan";
import { STYLES } from "../shared/styles";

/** Footage-free plan so Remotion Studio and tests work with no assets. */
export const demoPlan: EditPlan = {
  version: 1,
  title: "Drive Reel",
  subtitle: "Footage in, finished video out",
  occasion: "Demo",
  themeName: "Clean demo",
  styleId: "clean",
  aspect: "16:9",
  fps: 30,
  palette: STYLES.clean.palette,
  assetBase: "",
  music: null,
  intro: { duration: 3 },
  outro: { text: "Made with Claude", duration: 2.5 },
  transition: { type: "wipe", duration: 0.5 },
  scenes: [
    { id: "c1", kind: "card", duration: 3, kicker: "Step 01", heading: "Share a Drive folder", body: "Clips, photos and music, in any order." },
    { id: "c2", kind: "card", duration: 3, kicker: "Step 02", heading: "Pick a theme", bullets: ["Cinematic", "Hype reel", "Nostalgic film"] },
    { id: "c3", kind: "card", duration: 3, kicker: "Step 03", heading: "Watch, edit, share", body: "Every video gets a link and an editor." },
  ],
};
