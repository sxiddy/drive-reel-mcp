import React from "react";
import { AbsoluteFill } from "remotion";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";

type WhipProps = { direction: 1 | -1; width: number };

/**
 * Whip pan: the outgoing shot slides out and the incoming one slides in, both smeared sideways by a
 * horizontal-only blur that peaks mid-transition (an SVG Gaussian blur with a zero vertical deviation).
 */
const WhipView: React.FC<TransitionPresentationComponentProps<WhipProps>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const id = React.useId().replace(/:/g, "");
  const p = presentationProgress;
  const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const entering = presentationDirection === "entering";
  const d = passedProps.direction;
  // Outgoing: 0 → −35% of the width; incoming: +35% → 0. Most of the travel happens mid-blur.
  const shift = (entering ? (1 - ease) * 0.35 : -ease * 0.35) * d * 100;
  const blur = Math.sin(Math.PI * p) * passedProps.width * 0.03;
  const opacity = entering ? Math.min(1, p * 2.2) : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={`whip${id}`} x="-20%" y="0%" width="140%" height="100%">
          <feGaussianBlur stdDeviation={`${blur.toFixed(1)} 0`} />
        </filter>
      </svg>
      <AbsoluteFill style={{ transform: `translateX(${shift}%) scale(${1 + 0.06 * Math.sin(Math.PI * p)})`, filter: blur > 0.5 ? `url(#whip${id})` : undefined }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export function whip(props: WhipProps): TransitionPresentation<WhipProps> {
  return { component: WhipView, props };
}
