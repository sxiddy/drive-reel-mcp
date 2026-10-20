import React from "react";
import { Composition } from "remotion";
import { DIMENSIONS, EditPlan, planDurationInFrames } from "../shared/plan";
import { demoPlan } from "./demo-plan";
import { Reel } from "./Reel";

export const Root: React.FC = () => (
  <Composition
    id="Reel"
    component={Reel}
    defaultProps={{ plan: demoPlan }}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={300}
    calculateMetadata={({ props }) => {
      const plan = EditPlan.parse(props.plan);
      const { width, height } = DIMENSIONS[plan.aspect];
      return { durationInFrames: planDurationInFrames(plan), width, height, fps: plan.fps, props: { plan } };
    }}
  />
);
