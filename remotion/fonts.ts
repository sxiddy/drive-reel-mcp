import { loadFont as anton } from "@remotion/google-fonts/Anton";
import { loadFont as bebas } from "@remotion/google-fonts/BebasNeue";
import { loadFont as caveat } from "@remotion/google-fonts/Caveat";
import { loadFont as cormorant } from "@remotion/google-fonts/CormorantGaramond";
import { loadFont as fredoka } from "@remotion/google-fonts/Fredoka";
import { loadFont as inter } from "@remotion/google-fonts/Inter";
import { loadFont as montserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as orbitron } from "@remotion/google-fonts/Orbitron";
import { loadFont as playfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as spaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import type { FontKey } from "../shared/styles";

const opts = { subsets: ["latin"] as ["latin"] };

// Loaded once at module scope; Remotion waits for them before capturing frames.
export const FONTS: Record<FontKey, string> = {
  Anton: anton("normal", { ...opts, weights: ["400"] }).fontFamily,
  BebasNeue: bebas("normal", { ...opts, weights: ["400"] }).fontFamily,
  Caveat: caveat("normal", { ...opts, weights: ["500", "700"] }).fontFamily,
  CormorantGaramond: cormorant("normal", { ...opts, weights: ["400", "600"] }).fontFamily,
  Fredoka: fredoka("normal", { ...opts, weights: ["500", "700"] }).fontFamily,
  Inter: inter("normal", { ...opts, weights: ["400", "600", "800"] }).fontFamily,
  Montserrat: montserrat("normal", { ...opts, weights: ["400", "600"] }).fontFamily,
  Orbitron: orbitron("normal", { ...opts, weights: ["600", "800"] }).fontFamily,
  PlayfairDisplay: playfair("normal", { ...opts, weights: ["600", "800"] }).fontFamily,
  SpaceGrotesk: spaceGrotesk("normal", { ...opts, weights: ["400", "600"] }).fontFamily,
};
