"use client";

import { Icon } from "@/remotion/icons";
import { FONTS } from "@/remotion/fonts";
import type { MediaItem } from "@/shared/media";
import { CARD_ICONS, type CardScene, type EditPlan, type Scene, type TransitionType } from "@/shared/plan";
import { STYLES, STYLE_IDS, type StyleId } from "@/shared/styles";
import { ArrowL, ArrowR, Copy, Trash } from "./icons";
import { AudioList, UploadButton, UploadList, type Upload } from "./MediaBin";
import { Field, Section, Slider, inputCls } from "./ui";

const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: "fade", label: "Cross-fade" },
  { id: "slide", label: "Slide" },
  { id: "wipe", label: "Wipe" },
  { id: "pushCut", label: "Punch + flash" },
  { id: "whip", label: "Whip (motion blur)" },
  { id: "clockWipe", label: "Clock / iris" },
  { id: "flip", label: "Flip" },
  { id: "none", label: "Hard cut" },
];

type Layout = NonNullable<CardScene["layout"]>;
const LAYOUTS: { id: Layout; label: string }[] = [
  { id: "statement", label: "Statement" },
  { id: "bullets", label: "Bullet list" },
  { id: "stat", label: "Big number" },
  { id: "quote", label: "Quote" },
  { id: "feature", label: "Feature + icon" },
  { id: "screenshot", label: "Screenshot in a device" },
];

/** The layout the renderer will use when none is set (mirrors its inference from the fields). */
export const layoutOf = (c: CardScene): Layout => c.layout ?? (c.stat ? "stat" : c.image ? "screenshot" : c.bullets?.length ? "bullets" : c.icon ? "feature" : "statement");

const r2 = (x: number) => Math.round(x * 100) / 100;

export type InspectorProps = {
  plan: EditPlan;
  selected: number | null;
  readOnly: boolean;
  media: MediaItem[];
  assetBase: string;
  uploads: Upload[];
  edit: (fn: (p: EditPlan) => EditPlan, mergeKey?: string) => void;
  updateScene: (i: number, patch: Partial<Scene>, mergeKey?: string) => void;
  move: (from: number, to: number) => void;
  duplicate: (i: number) => void;
  remove: (i: number) => void;
  setStyle: (s: StyleId) => void;
  seek: (f: number) => void;
  sceneStart: (id: string) => number;
  onDeselect: () => void;
  onUseAudio: (item: MediaItem | null) => void;
  onUpload: (kind: "audio" | "image", f: File) => void;
  onOpenMedia: () => void;
};

export function Inspector(props: InspectorProps) {
  const { plan, selected, readOnly } = props;
  const scene = selected !== null ? plan.scenes[selected] : undefined;
  const shot = scene && selected !== null;
  return (
    <div>
      {shot ? (
        <ShotHeader scene={scene} index={selected} media={props.media} onDeselect={props.onDeselect} />
      ) : (
        <div className="border-b border-white/[0.06] px-4 py-3">
          <p className="text-sm font-medium">Whole video</p>
          <p className="text-[11px] text-muted">{readOnly ? "Settings are shown read-only" : "Select a shot on the timeline to edit just that shot"}</p>
        </div>
      )}
      {/* A disabled fieldset turns every control inside read-only in one go. */}
      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
        {shot ? <ShotInspector {...props} scene={scene} index={selected} /> : <VideoInspector {...props} />}
      </fieldset>
    </div>
  );
}

function ShotHeader({ scene, index, media, onDeselect }: { scene: Scene; index: number; media: MediaItem[]; onDeselect: () => void }) {
  const kindLabel = scene.kind === "video" ? "Video clip" : scene.kind === "image" ? "Photo" : "Text card";
  const source = scene.kind !== "card" ? media.find((m) => m.src === scene.src) : undefined;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Shot {index + 1}</p>
        <p className="truncate text-[11px] text-muted">
          {kindLabel}
          {scene.kind !== "card" ? ` · ${source?.name ?? scene.src.split("/").pop()}` : ""}
        </p>
      </div>
      <button type="button" onClick={onDeselect} className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/10 hover:text-white">
        Whole video
      </button>
    </div>
  );
}

function ShotInspector({ plan, scene, index, media, updateScene, move, duplicate, remove, seek, sceneStart, onOpenMedia }: InspectorProps & { scene: Scene; index: number }) {
  return (
    <div>
      <Section title="Arrange">
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: "Earlier", icon: <ArrowL className="size-4" />, run: () => move(index, index - 1), off: index === 0 },
            { label: "Later", icon: <ArrowR className="size-4" />, run: () => move(index, index + 1), off: index === plan.scenes.length - 1 },
            { label: "Duplicate", icon: <Copy className="size-4" />, run: () => duplicate(index), off: plan.scenes.length >= 120 },
            { label: "Delete", icon: <Trash className="size-4" />, run: () => remove(index), off: plan.scenes.length <= 1 },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.run}
              disabled={b.off}
              title={b.label === "Delete" ? "Delete (Del)" : b.label}
              className={`flex flex-col items-center gap-1 rounded-lg border border-white/10 py-2 text-[11px] transition hover:bg-white/10 disabled:opacity-30 ${b.label === "Delete" ? "text-red-300" : "text-white/80"}`}
            >
              {b.icon}
              {b.label}
            </button>
          ))}
        </div>
        {scene.kind !== "card" ? (
          <button type="button" onClick={onOpenMedia} className="w-full rounded-lg border border-white/10 py-2 text-xs text-white/80 transition hover:bg-white/10">
            Replace {scene.kind === "video" ? "clip" : "photo"} from media…
          </button>
        ) : null}
      </Section>

      {scene.kind === "card" ? <CardFields scene={scene} index={index} plan={plan} media={media} updateScene={updateScene} /> : null}

      <Section title="Cut into this shot">
        <Field label="Transition" hint={plan.transition.type === "none" ? "turn on transitions for the video first" : "same length, so the beat grid stays"}>
          <select
            className={inputCls}
            disabled={plan.transition.type === "none"}
            value={scene.transitionIn ?? ""}
            onChange={(e) => updateScene(index, { transitionIn: (e.target.value || undefined) as TransitionType | undefined })}
          >
            <option value="">Video default ({TRANSITIONS.find((t) => t.id === plan.transition.type)?.label ?? plan.transition.type})</option>
            {TRANSITIONS.filter((t) => t.id !== "none").map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="none">Hard cut</option>
          </select>
        </Field>
      </Section>

      <Section title="Caption">
        <Field label="Caption on this shot">
          <input className={inputCls} placeholder="No caption" value={scene.caption ?? ""} maxLength={140} onChange={(e) => updateScene(index, { caption: e.target.value || undefined }, `cap${scene.id}`)} />
        </Field>
      </Section>

      <Section title="Timing">
        <Field label="Length on screen" hint={`${scene.duration.toFixed(2)}s`}>
          <Slider
            label="Shot length"
            min={0.6}
            max={scene.kind === "video" ? Math.max(0.6, r2((scene.sourceDuration - scene.trimStart) / scene.speed)) : 12}
            step={0.05}
            value={scene.duration}
            onChange={(v) => updateScene(index, { duration: v }, `dur${scene.id}`)}
          />
        </Field>
        {scene.kind === "video" ? (
          <>
            <Field label="Start point in the clip" hint={`${scene.trimStart.toFixed(2)}s / ${scene.sourceDuration.toFixed(1)}s`}>
              <Slider
                label="Trim start"
                min={0}
                max={Math.max(0, r2(scene.sourceDuration - scene.duration * scene.speed - 0.05))}
                step={0.05}
                value={scene.trimStart}
                onChange={(v) => {
                  updateScene(index, { trimStart: v }, `trim${scene.id}`);
                  seek(sceneStart(scene.id) + 3);
                }}
              />
            </Field>
            <Field label="Speed">
              <div className="grid grid-cols-6 gap-1">
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => updateScene(index, { speed: v, duration: Math.max(0.4, Math.min(scene.duration, r2((scene.sourceDuration - scene.trimStart) / v))) })}
                    className={`rounded-md py-1.5 text-xs tabular-nums transition ${scene.speed === v ? "bg-brand font-semibold text-ink" : "bg-white/[0.05] text-white/70 hover:bg-white/10"}`}
                  >
                    {v}×
                  </button>
                ))}
              </div>
            </Field>
          </>
        ) : null}
        {scene.kind === "image" ? (
          <Field label="Camera move">
            <select className={inputCls} value={scene.motion} onChange={(e) => updateScene(index, { motion: e.target.value as "zoomIn" })}>
              <option value="zoomIn">Slow zoom in</option>
              <option value="zoomOut">Slow zoom out</option>
              <option value="panLeft">Pan left</option>
              <option value="panRight">Pan right</option>
            </select>
          </Field>
        ) : null}
      </Section>

      {scene.kind !== "card" ? <LookFields scene={scene} index={index} updateScene={updateScene} /> : null}

      {scene.kind === "video" ? (
        <Section title="Sound">
          <Field label="Clip audio" hint={`${Math.round(scene.volume * 100)}%`}>
            <Slider label="Clip volume" min={0} max={1} step={0.01} value={scene.volume} onChange={(v) => updateScene(index, { volume: v }, `vol${scene.id}`)} />
          </Field>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Per-shot look: the time chip, where the frame is cropped to (the focus point), and colour. The colour
 * sliders edit the shot's grade (which starts as the automatic phone-to-phone colour match).
 */
function LookFields({ scene, index, updateScene }: { scene: Extract<Scene, { kind: "video" | "image" }>; index: number; updateScene: InspectorProps["updateScene"] }) {
  const g = scene.grade ?? { gain: [1, 1, 1] as [number, number, number], gamma: 1, saturation: 1 };
  const warmth = r2((g.gain[0] - g.gain[2]) / 0.3);
  const level = (g.gain[0] + g.gain[2]) / 2;
  const setGrade = (patch: Partial<typeof g>, key: string) => updateScene(index, { grade: { ...g, ...patch } }, `${key}${scene.id}`);
  const [fx, fy] = scene.focus ?? [0.5, 0.5];
  return (
    <Section title="Look">
      <Field label="Time chip" hint={`${(scene.chip ?? "").length}/16`}>
        <input className={inputCls} placeholder="None (e.g. 10:49 PM, Hour 24)" value={scene.chip ?? ""} maxLength={16} onChange={(e) => updateScene(index, { chip: e.target.value || undefined }, `chip${scene.id}`)} />
      </Field>
      <Field label="Framing, left ↔ right" hint={`${Math.round(fx * 100)}%`}>
        <Slider label="Crop horizontal position" min={0} max={1} step={0.01} value={fx} onChange={(v) => updateScene(index, { focus: [v, fy] }, `fx${scene.id}`)} />
      </Field>
      <Field label="Framing, top ↕ bottom" hint={`${Math.round(fy * 100)}%`}>
        <Slider label="Crop vertical position" min={0} max={1} step={0.01} value={fy} onChange={(v) => updateScene(index, { focus: [fx, v] }, `fy${scene.id}`)} />
      </Field>
      <Field label="Brightness" hint={g.gamma < 1 ? "brighter" : g.gamma > 1 ? "darker" : "as shot"}>
        {/* gamma below 1 lifts the midtones, so the slider runs from dark (2) to bright (0.5) */}
        <Slider label="Brightness" min={-1} max={1} step={0.02} value={r2(-Math.log2(g.gamma))} onChange={(v) => setGrade({ gamma: r2(2 ** -v) }, "gam")} />
      </Field>
      <Field label="Saturation" hint={`${Math.round(g.saturation * 100)}%`}>
        <Slider label="Saturation" min={0.5} max={1.5} step={0.01} value={g.saturation} onChange={(v) => setGrade({ saturation: v }, "sat")} />
      </Field>
      <Field label="Warmth" hint={warmth > 0 ? "warmer" : warmth < 0 ? "cooler" : "neutral"}>
        <Slider label="Warmth" min={-1} max={1} step={0.02} value={Math.max(-1, Math.min(1, warmth))} onChange={(v) => setGrade({ gain: [r2(level + 0.15 * v), g.gain[1], r2(level - 0.15 * v)] }, "warm")} />
      </Field>
      <button type="button" className="text-xs text-white/60 underline hover:text-white" onClick={() => updateScene(index, { grade: undefined, focus: undefined })}>
        Reset framing and colour
      </button>
    </Section>
  );
}

function CardFields({ scene, index, plan, media, updateScene }: { scene: CardScene; index: number; plan: EditPlan; media: MediaItem[]; updateScene: InspectorProps["updateScene"] }) {
  const layout = layoutOf(scene);
  const images = media.filter((m) => m.kind === "image");
  const set = (patch: Partial<CardScene>, key?: string) => updateScene(index, patch, key ? `${key}${scene.id}` : undefined);

  const changeLayout = (l: Layout) => {
    const patch: Partial<CardScene> = { layout: l };
    // Give each layout the fields it needs, so the preview shows it straight away.
    if (l === "stat" && !scene.stat) patch.stat = { value: 100, suffix: "+", label: "Label" };
    if (l === "feature" && !scene.icon) patch.icon = "spark";
    if (l === "bullets" && !scene.bullets?.length) patch.bullets = ["First point", "Second point"];
    if (l === "screenshot" && !scene.image && images[0]) patch.image = images[0].src;
    if (l === "screenshot" && !scene.device) patch.device = "laptop";
    set(patch);
  };

  return (
    <Section title="Text card">
      <Field label="Layout">
        <select className={inputCls} value={layout} onChange={(e) => changeLayout(e.target.value as Layout)}>
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id} disabled={l.id === "screenshot" && !images.length && !scene.image}>
              {l.label}
              {l.id === "screenshot" && !images.length && !scene.image ? " (upload a photo first)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Label above" hint={`${(scene.kicker ?? "").length}/24`}>
        <input className={inputCls} placeholder='e.g. "01" or "NEW"' value={scene.kicker ?? ""} maxLength={24} onChange={(e) => set({ kicker: e.target.value || undefined }, "k")} />
      </Field>
      <Field label={layout === "quote" ? "Quote" : "Heading"} hint={`${scene.heading.length}/80`}>
        <input className={inputCls} value={scene.heading} maxLength={80} onChange={(e) => set({ heading: e.target.value }, "h")} />
      </Field>
      <Field label={layout === "quote" ? "Who said it" : "Body"} hint={`${(scene.body ?? "").length}/220`}>
        <textarea className={`${inputCls} resize-none`} rows={layout === "quote" ? 1 : 3} placeholder="Optional" value={scene.body ?? ""} maxLength={220} onChange={(e) => set({ body: e.target.value || undefined }, "b")} />
      </Field>

      {layout === "stat" ? (
        <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
          <Field label="Prefix">
            <input className={inputCls} placeholder="$" value={scene.stat?.prefix ?? ""} maxLength={4} onChange={(e) => set({ stat: { value: 0, label: "", ...scene.stat, prefix: e.target.value || undefined } }, "sp")} />
          </Field>
          <Field label="Value">
            <input
              className={`${inputCls} tabular-nums`}
              type="number"
              inputMode="decimal"
              value={scene.stat?.value ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) set({ stat: { label: "", ...scene.stat, value: v } }, "sv");
              }}
            />
          </Field>
          <Field label="Suffix">
            <input className={inputCls} placeholder="+" value={scene.stat?.suffix ?? ""} maxLength={6} onChange={(e) => set({ stat: { value: 0, label: "", ...scene.stat, suffix: e.target.value || undefined } }, "ss")} />
          </Field>
          <div className="col-span-3">
            <Field label="Stat label" hint={`${(scene.stat?.label ?? "").length}/40`}>
              <input className={inputCls} placeholder="e.g. notes shared" value={scene.stat?.label ?? ""} maxLength={40} onChange={(e) => set({ stat: { value: 0, ...scene.stat, label: e.target.value } }, "sl")} />
            </Field>
          </div>
        </div>
      ) : null}

      {layout === "bullets" ? (
        <Field label="Points (up to 4)">
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                className={inputCls}
                placeholder={`Point ${i + 1}`}
                maxLength={60}
                value={scene.bullets?.[i] ?? ""}
                onChange={(e) => {
                  const next = [0, 1, 2, 3].map((j) => (j === i ? e.target.value : (scene.bullets?.[j] ?? "")));
                  const cleaned = next.filter((b) => b.trim() !== "");
                  set({ bullets: cleaned.length ? next.slice(0, Math.max(...next.map((b, j) => (b.trim() ? j + 1 : 0)))) : undefined }, "bl");
                }}
              />
            ))}
          </div>
        </Field>
      ) : null}

      {layout === "feature" ? (
        <Field label="Icon">
          <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label="Icon">
            {CARD_ICONS.map((ic) => {
              const on = (scene.icon ?? "spark") === ic;
              return (
                <button
                  key={ic}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={ic}
                  aria-label={ic}
                  onClick={() => set({ icon: ic })}
                  className={`grid aspect-square place-items-center rounded-md transition ${on ? "bg-brand text-ink" : "bg-white/[0.05] text-white/75 hover:bg-white/10 hover:text-white"}`}
                >
                  <Icon name={ic} size={18} color="currentColor" progress={1} strokeWidth={1.8} />
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}

      {layout === "screenshot" ? (
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <Field label="Screenshot">
            <select className={inputCls} value={scene.image ?? ""} onChange={(e) => set({ image: e.target.value || undefined })}>
              {!scene.image ? <option value="">Choose a photo</option> : null}
              {images.map((m) => (
                <option key={m.src} value={m.src}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Device">
            <select className={inputCls} value={scene.device ?? "laptop"} onChange={(e) => set({ device: e.target.value as "laptop" })}>
              <option value="laptop">Laptop</option>
              <option value="phone">Phone</option>
            </select>
          </Field>
        </div>
      ) : null}
      <p className="text-[11px] text-muted">
        Shown in the {STYLES[plan.styleId].name} style&apos;s fonts and colours.
      </p>
    </Section>
  );
}

function VideoInspector({ plan, edit, setStyle, media, assetBase, uploads, onUseAudio, onUpload, readOnly }: InspectorProps) {
  const firstVideo = plan.scenes.find((s) => s.kind === "video");
  const songs = media.filter((m) => m.kind === "audio");
  return (
    <div>
      <Section title="Text">
        <Field label="Title">
          <input className={inputCls} value={plan.title} maxLength={80} onChange={(e) => edit((p) => ({ ...p, title: e.target.value }), "title")} />
        </Field>
        <Field label="Subtitle (place)" hint="also on the end card">
          <input className={inputCls} placeholder="None" value={plan.subtitle ?? ""} maxLength={120} onChange={(e) => edit((p) => ({ ...p, subtitle: e.target.value || undefined }), "subtitle")} />
        </Field>
        <Field label="End card date" hint={`${(plan.dateLine ?? "").length}/60`}>
          <input className={inputCls} placeholder="e.g. 18–19 September 2026" value={plan.dateLine ?? ""} maxLength={60} onChange={(e) => edit((p) => ({ ...p, dateLine: e.target.value || undefined }), "dateline")} />
        </Field>
        <Field label="Closing line">
          <input className={inputCls} value={plan.outro.text} maxLength={80} onChange={(e) => edit((p) => ({ ...p, outro: { ...p.outro, text: e.target.value } }), "outro")} />
        </Field>
      </Section>

      <Section title="Style">
        <div className="grid grid-cols-2 gap-2">
          {STYLE_IDS.map((sid) => {
            const s = STYLES[sid];
            const on = plan.styleId === sid;
            return (
              <button
                key={sid}
                type="button"
                onClick={() => setStyle(sid)}
                className={`group relative h-[68px] overflow-hidden rounded-lg text-left ring-1 transition ${on ? "ring-2 ring-brand" : "ring-white/10 hover:ring-white/30"}`}
                style={{ background: s.palette.bg }}
              >
                <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: s.palette.accent }} />
                <span className="absolute left-2.5 top-2 text-[15px] leading-none" style={{ fontFamily: FONTS[s.headingFont], color: s.palette.fg, textTransform: s.headingCase === "upper" ? "uppercase" : "none" }}>
                  {s.name}
                </span>
                <span className="absolute bottom-2.5 left-2.5 text-[10px]" style={{ color: s.palette.fg, opacity: 0.6 }}>
                  {s.music.bpm} BPM · {s.shotLength}s shots
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Field label="Accent colour">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
              <input type="color" value={plan.palette.accent} onChange={(e) => edit((p) => ({ ...p, palette: { ...p.palette, accent: e.target.value } }), "accent")} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" />
              <span className="font-mono text-xs text-white/70">{plan.palette.accent}</span>
            </div>
          </Field>
          <Field label="Frame">
            <div className="grid grid-cols-3 gap-1">
              {(["16:9", "9:16", "1:1"] as const).map((a) => (
                <button key={a} type="button" onClick={() => edit((p) => ({ ...p, aspect: a }))} className={`rounded-md py-2 text-xs transition ${plan.aspect === a ? "bg-brand font-semibold text-ink" : "bg-white/[0.05] text-white/70 hover:bg-white/10"}`}>
                  {a}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Transitions">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={plan.transition.type} onChange={(e) => edit((p) => ({ ...p, transition: { ...p.transition, type: e.target.value as TransitionType } }))}>
              {TRANSITIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Length" hint={`${plan.transition.duration.toFixed(2)}s`}>
            <div className="pt-2.5">
              <Slider label="Transition length" min={0.1} max={1.5} step={0.05} disabled={plan.transition.type === "none"} value={plan.transition.duration} onChange={(v) => edit((p) => ({ ...p, transition: { ...p.transition, duration: v } }), "tdur")} />
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title card" hint={`${plan.intro.duration.toFixed(1)}s`}>
            <Slider label="Intro length" min={0} max={8} step={0.1} value={plan.intro.duration} onChange={(v) => edit((p) => ({ ...p, intro: { duration: v } }), "intro")} />
          </Field>
          <Field label="Outro" hint={`${plan.outro.duration.toFixed(1)}s`}>
            <Slider label="Outro length" min={0} max={8} step={0.1} value={plan.outro.duration} onChange={(v) => edit((p) => ({ ...p, outro: { ...p.outro, duration: v } }), "outrod")} />
          </Field>
        </div>
      </Section>

      <Section title="Audio" action={<UploadButton kind="audio" label="Upload song" disabled={readOnly} onUpload={(f) => onUpload("audio", f)} />}>
        <div className="space-y-2">
          <p className="text-xs text-white/70">Soundtrack</p>
          <UploadList uploads={uploads.filter((u) => u.kind === "audio")} />
          <AudioList items={songs} assetBase={assetBase} musicSrc={plan.music?.src ?? null} readOnly={readOnly} onUse={onUseAudio} showNone />
        </div>
        {plan.music?.duration && plan.music.duration > 4 ? (
          <Field label="Song starts at" hint={`${Math.floor((plan.music.start ?? 0) / 60)}:${String(Math.floor((plan.music.start ?? 0) % 60)).padStart(2, "0")} of ${Math.floor(plan.music.duration / 60)}:${String(Math.floor(plan.music.duration % 60)).padStart(2, "0")}`}>
            {/* Whole beats only, so every cut still lands on the beat. */}
            <Slider
              label="Song start"
              min={0}
              max={Math.max(0, plan.music.duration - 4)}
              step={60 / plan.music.bpm}
              value={plan.music.start ?? 0}
              onChange={(v) => edit((p) => ({ ...p, music: p.music && { ...p.music, start: r2(Math.round(v / (60 / p.music.bpm)) * (60 / p.music.bpm)) || undefined } }), "mstart")}
            />
          </Field>
        ) : null}
        {plan.music ? (
          <Field label="Music volume" hint={`${Math.round(plan.music.volume * 100)}%`}>
            <Slider label="Music volume" min={0} max={1} step={0.01} value={plan.music.volume} onChange={(v) => edit((p) => ({ ...p, music: p.music && { ...p.music, volume: v } }), "music")} />
          </Field>
        ) : null}
        {firstVideo?.kind === "video" ? (
          <Field label="Clip audio, all shots" hint={`${Math.round(firstVideo.volume * 100)}%`}>
            <Slider
              label="All clips volume"
              min={0}
              max={1}
              step={0.01}
              value={firstVideo.volume}
              onChange={(v) =>
                edit((p) => {
                  p.scenes = p.scenes.map((s) => (s.kind === "video" ? { ...s, volume: v } : s));
                  return p;
                }, "clipvol")
              }
            />
          </Field>
        ) : null}
      </Section>
    </div>
  );
}
