"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Reel } from "@/remotion/Reel";
import type { MediaItem, MediaManifest } from "@/shared/media";
import { DIMENSIONS, planDurationInFrames, type CardScene, type EditPlan, type ImageScene, type Scene, type VideoScene } from "@/shared/plan";
import { STYLES, type StyleId } from "@/shared/styles";
import { checkEditKey, forgetKey, readStoredKey, storeKey } from "@/src/lib/editKey";
import { Back, Expand, Film, Muted, Pause, Play, Redo, Sparkle, Undo, Volume } from "./icons";
import { Inspector } from "./Inspector";
import { MediaBin, TextPanel, type Upload } from "./MediaBin";
import { Timeline, layoutTimeline } from "./Timeline";
import { IconButton, Tabs, useLayoutMode } from "./ui";

export type RenderView = { status: "idle" | "queued" | "rendering" | "error"; progress: number; error?: string; errorDetails?: string; ahead?: number };
type Auth = "checking" | "edit" | "view";
type PanelTab = "edit" | "media" | "text";

const MAX_SCENES = 120;
const UPLOAD_LIMITS = { audio: { exts: ["mp3", "wav", "m4a", "aac", "ogg"], mb: 40 }, image: { exts: ["jpg", "jpeg", "png", "webp"], mb: 20 } } as const;

const fmt = (frames: number, fps: number) => {
  const s = frames / fps;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 10))}`;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/** A scene id not used by any shot yet. */
const newSceneId = (plan: EditPlan) => {
  const used = new Set(plan.scenes.map((s) => s.id));
  let id = "";
  do id = `s${Math.random().toString(36).slice(2, 8)}`;
  while (used.has(id));
  return id;
};

/** Length of a media item's source, falling back to what the plan already knows about it. */
const sourceLength = (item: MediaItem, plan: EditPlan) =>
  item.duration ?? plan.scenes.find((s): s is VideoScene => s.kind === "video" && s.src === item.src)?.sourceDuration ?? 3;

/**
 * A new shot for a media item. For a replacement, `keep` is the shot being swapped out: its id,
 * length, caption (and speed/volume/motion where they still apply) carry over.
 */
function sceneFromItem(item: MediaItem, plan: EditPlan, id: string, keep?: Scene): VideoScene | ImageScene {
  const caption = keep?.caption;
  if (item.kind === "image") {
    return { id, kind: "image", src: item.src, duration: keep?.duration ?? 3, motion: keep?.kind === "image" ? keep.motion : "zoomIn", ...(caption ? { caption } : {}) };
  }
  const src = sourceLength(item, plan);
  const speed = keep?.kind === "video" ? keep.speed : 1;
  const duration = Math.max(0.4, r2(Math.min(keep?.duration ?? 3, src / speed)));
  const trimStart = Math.max(0, r2(Math.min(item.highlights?.[0] ?? 0, src - duration * speed)));
  return {
    id,
    kind: "video",
    src: item.src,
    trimStart,
    duration,
    sourceDuration: src,
    speed,
    volume: keep?.kind === "video" ? keep.volume : 0.15,
    ...(item.width && item.height ? { srcWidth: item.width, srcHeight: item.height } : {}),
    ...(caption ? { caption } : {}),
  };
}

export function Editor({
  id,
  initialPlan,
  initialVersions,
  initialRender,
  initialMedia,
}: {
  id: string;
  initialPlan: EditPlan;
  initialVersions: number;
  initialRender: RenderView;
  initialMedia: MediaManifest;
}) {
  const [history, setHistory] = useState<{ stack: EditPlan[]; at: number }>({ stack: [initialPlan], at: 0 });
  const plan = history.stack[history.at];
  const [saved, setSaved] = useState<EditPlan>(initialPlan);
  const [selected, setSelected] = useState<number | null>(null);
  const [render, setRender] = useState<RenderView>(initialRender);
  const [versions, setVersions] = useState(initialVersions);
  const [justRendered, setJustRendered] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hideRenderError, setHideRenderError] = useState(false);
  // Open on the fully revealed title card rather than a blank first frame.
  const [initialFrame] = useState(() => Math.max(0, Math.round(initialPlan.intro.duration * initialPlan.fps) - 20));
  const [frame, setFrame] = useState(initialFrame);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [zoom, setZoom] = useState(46);
  const [media, setMedia] = useState<MediaItem[]>(initialMedia.items);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [freshSrc, setFreshSrc] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [auth, setAuth] = useState<Auth>("checking");
  const [key, setKey] = useState<string | null>(null);
  const [libraryTab, setLibraryTab] = useState<"media" | "text">("media");
  const [panelTab, setPanelTab] = useState<PanelTab>("edit");
  const mode = useLayoutMode();
  const player = useRef<PlayerRef>(null);
  const lastMerge = useRef<string | null>(null);

  const readOnly = auth !== "edit";
  const dirty = JSON.stringify(plan) !== JSON.stringify(saved);
  const durationInFrames = planDurationInFrames(plan);
  const { width, height } = DIMENSIONS[plan.aspect];
  const assetBase = `/media/${id}`;
  const inputProps = useMemo(() => ({ plan: { ...plan, assetBase } }), [plan, assetBase]);
  const mediaBySrc = useMemo(() => new Map(media.map((m) => [m.src, m])), [media]);
  const validSelected = selected !== null && selected < plan.scenes.length ? selected : null;
  const insertAt = validSelected !== null ? validSelected + 1 : plan.scenes.length;
  const selectedLabel = validSelected !== null ? `Shot ${validSelected + 1}` : null;

  // ---- Edit key: from ?key= (then hidden from the URL) or this browser's storage, checked with the server.
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("key");
    if (fromUrl) {
      storeKey(id, fromUrl);
      url.searchParams.delete("key");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    const k = fromUrl ?? readStoredKey(id);
    if (!k) {
      setAuth("view");
      return;
    }
    let live = true;
    checkEditKey(id, k).then((ok) => {
      if (!live) return;
      if (ok) {
        setKey(k);
        setAuth("edit");
      } else {
        forgetKey(id);
        setAuth("view");
      }
    });
    return () => {
      live = false;
    };
  }, [id]);

  /** fetch() for writes: sends the edit key and drops to view-only if the server refuses it. */
  const authed = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), "x-edit-key": key ?? "" } });
      if (res.status === 401 || res.status === 403) {
        forgetKey(id);
        setAuth("view");
        throw new Error("This edit link is no longer valid. Open the edit link Claude gave you to make changes.");
      }
      return res;
    },
    [id, key],
  );

  // ---- History. The merge decision is made outside the state updater: React runs updaters twice in
  // StrictMode, and a ref mutated inside one would make the second run merge into the previous step.
  const edit = useCallback((fn: (p: EditPlan) => EditPlan, mergeKey?: string) => {
    const merge = !!mergeKey && lastMerge.current === mergeKey;
    lastMerge.current = mergeKey ?? null;
    setHistory((h) => {
      const next = fn(structuredClone(h.stack[h.at]));
      const m = merge && h.at > 0;
      const stack = [...h.stack.slice(0, m ? h.at : h.at + 1), next].slice(-100);
      return { stack, at: stack.length - 1 };
    });
  }, []);
  const undo = useCallback(() => {
    lastMerge.current = null;
    setHistory((h) => ({ ...h, at: Math.max(0, h.at - 1) }));
  }, []);
  const redo = useCallback(() => {
    lastMerge.current = null;
    setHistory((h) => ({ ...h, at: Math.min(h.stack.length - 1, h.at + 1) }));
  }, []);

  const seek = useCallback((f: number) => {
    player.current?.seekTo(f);
    setFrame(f);
  }, []);

  // After inserting or replacing a shot: select it and jump the playhead to it.
  useEffect(() => {
    if (!focusId) return;
    const i = plan.scenes.findIndex((s) => s.id === focusId);
    if (i >= 0) {
      setSelected(i);
      const b = layoutTimeline(plan).find((x) => x.key === focusId);
      if (b) seek(b.start + Math.min(8, Math.floor(b.frames / 2)));
    }
    setFocusId(null);
  }, [focusId, plan, seek]);

  // Player events → transport state.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, []);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty && !readOnly) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty, readOnly]);

  // Poll while a render is queued or running.
  useEffect(() => {
    if (render.status !== "rendering" && render.status !== "queued") return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/videos/${id}/render`, { cache: "no-store" }).then((x) => x.json());
        setRender(r.render);
        if (r.render.status !== "rendering" && r.render.status !== "queued") {
          if (r.versions.length > versions) setJustRendered(r.versions.at(-1).n);
          setVersions(r.versions.length);
        }
      } catch {
        /* try again on the next tick */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [render.status, id, versions]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- Shot operations (all through edit(), so they undo/redo).
  const updateScene = (i: number, patch: Partial<Scene>, mergeKey?: string) =>
    edit((p) => {
      p.scenes[i] = { ...p.scenes[i], ...patch } as Scene;
      return p;
    }, mergeKey);

  const move = (from: number, to: number) => {
    if (readOnly || to < 0 || to >= plan.scenes.length || from === to) return;
    edit((p) => {
      const [s] = p.scenes.splice(from, 1);
      p.scenes.splice(to, 0, s);
      return p;
    });
    setSelected(to);
  };

  const remove = (i: number) => {
    if (readOnly || plan.scenes.length <= 1 || i < 0 || i >= plan.scenes.length) return;
    edit((p) => {
      p.scenes.splice(i, 1);
      return p;
    });
    setSelected(null);
  };

  const insert = (scene: Scene, at = insertAt) => {
    if (readOnly) return;
    if (plan.scenes.length >= MAX_SCENES) {
      setNotice(`A video can have at most ${MAX_SCENES} shots.`);
      return;
    }
    edit((p) => {
      p.scenes.splice(Math.min(at, p.scenes.length), 0, scene);
      return p;
    });
    setFocusId(scene.id);
  };

  const duplicate = (i: number) => insert({ ...structuredClone(plan.scenes[i]), id: newSceneId(plan) }, i + 1);

  const setMusic = (item: MediaItem | null) => {
    if (readOnly) return;
    edit((p) => {
      if (!item) return { ...p, music: null };
      const prev = p.music;
      const bpm = Math.min(200, Math.max(40, item.bpm ?? prev?.bpm ?? STYLES[p.styleId].music.bpm));
      return {
        ...p,
        music: { src: item.src, volume: prev?.volume ?? 0.7, bpm, credit: item.label && !item.label.startsWith("Uploaded") ? item.label : item.name, ...(item.duration ? { duration: item.duration } : {}) },
      };
    });
    setNotice(item ? `Soundtrack: ${item.name}` : "Music removed");
  };

  const addItem = (item: MediaItem) => {
    if (item.kind === "audio") return setMusic(item);
    insert(sceneFromItem(item, plan, newSceneId(plan)));
  };

  const replaceWith = (item: MediaItem) => {
    if (readOnly || validSelected === null || item.kind === "audio") return;
    const old = plan.scenes[validSelected];
    const next = sceneFromItem(item, plan, old.id, old);
    edit((p) => {
      p.scenes[validSelected] = next;
      return p;
    });
    setFocusId(old.id);
    setNotice(`Shot ${validSelected + 1} replaced`);
  };

  const addCard = (card: Omit<CardScene, "id">) => {
    insert({ ...structuredClone(card), id: newSceneId(plan) } as CardScene);
    if (mode !== "wide") setPanelTab("edit");
  };

  const setStyle = (styleId: StyleId) =>
    edit((p) => {
      const s = STYLES[styleId];
      p.styleId = styleId;
      p.palette = { ...s.palette };
      p.transition = { type: s.transition.type, duration: s.transition.duration };
      return p;
    });

  const sceneStart = (sceneId: string) => layoutTimeline(plan).find((b) => b.key === sceneId)?.start ?? 0;

  // ---- Keyboard: space = play/pause, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y = undo/redo, Delete/Backspace = remove shot.
  const keys = useRef({ remove, selected: validSelected, readOnly, undo, redo });
  keys.current = { remove, selected: validSelected, readOnly, undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const k = keys.current;
      if (e.code === "Space") {
        e.preventDefault();
        player.current?.toggle();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (k.readOnly) return;
        if (e.shiftKey) k.redo();
        else k.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (!k.readOnly) k.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (k.selected === null || k.readOnly) return;
        e.preventDefault();
        k.remove(k.selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Server writes.
  const save = async () => {
    if (readOnly) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await authed(`/api/videos/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan) });
      if (!res.ok) throw new Error(await res.text());
      setSaved(plan);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const renderNew = async () => {
    if (readOnly) return;
    if (dirty && !(await save())) return;
    setJustRendered(null);
    setError(null);
    setHideRenderError(false);
    try {
      const res = await authed(`/api/videos/${id}/render`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      setRender(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reset = async () => {
    if (readOnly || !confirm("Discard all edits and go back to Claude's original cut?")) return;
    try {
      const res = await authed(`/api/videos/${id}?reset=1`, { method: "PUT" });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      lastMerge.current = null;
      setHistory({ stack: [body.plan], at: 0 });
      setSaved(body.plan);
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Uploads a song or photo with progress (XHR, since fetch can't report upload progress). */
  const upload = (kind: "audio" | "image", file: File) => {
    if (readOnly || !key) return;
    const rule = UPLOAD_LIMITS[kind];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const tag = `${Date.now()}${Math.random()}`;
    const fail = (msg: string) => setUploads((u) => [...u.filter((x) => x.key !== tag), { key: tag, name: file.name, kind, progress: 0, error: msg }]);
    const clearLater = () => setTimeout(() => setUploads((u) => u.filter((x) => x.key !== tag)), 6000);
    if (!(rule.exts as readonly string[]).includes(ext)) {
      fail(kind === "audio" ? "Use an mp3, wav, m4a, aac or ogg file." : "Use a jpg, png or webp image.");
      clearLater();
      return;
    }
    if (file.size > rule.mb * 1024 * 1024) {
      fail(`That file is over ${rule.mb} MB.`);
      clearLater();
      return;
    }
    setUploads((u) => [...u, { key: tag, name: file.name, kind, progress: 0 }]);
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/videos/${id}/assets`);
    xhr.setRequestHeader("x-edit-key", key);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploads((u) => u.map((x) => (x.key === tag ? { ...x, progress: e.loaded / e.total } : x)));
    };
    xhr.onload = () => {
      if (xhr.status === 401 || xhr.status === 403) {
        forgetKey(id);
        setAuth("view");
      }
      if (xhr.status !== 200) {
        fail(xhr.responseText || `Upload failed (${xhr.status})`);
        clearLater();
        return;
      }
      const item = JSON.parse(xhr.responseText) as MediaItem;
      setUploads((u) => u.filter((x) => x.key !== tag));
      setMedia((m) => [...m, item]);
      setFreshSrc(item.src);
      if (item.kind === "audio") setMusic(item);
      else setNotice(`${item.name} added to Media`);
    };
    xhr.onerror = () => {
      fail("Network error. Try again.");
      clearLater();
    };
    xhr.send(form);
  };

  const portrait = plan.aspect === "9:16";
  const exportLabel =
    render.status === "rendering"
      ? `Rendering ${Math.round(render.progress * 100)}%`
      : render.status === "queued"
        ? `Queued · ${render.ahead ?? 0} ahead`
        : mode === "narrow"
          ? "Export"
          : "Export new version";

  const inspector = (
    <Inspector
      plan={plan}
      selected={validSelected}
      readOnly={readOnly}
      media={media}
      assetBase={assetBase}
      uploads={uploads}
      edit={edit}
      updateScene={updateScene}
      move={move}
      duplicate={duplicate}
      remove={remove}
      setStyle={setStyle}
      seek={seek}
      sceneStart={sceneStart}
      onDeselect={() => setSelected(null)}
      onUseAudio={setMusic}
      onUpload={upload}
      onOpenMedia={() => (mode === "wide" ? setLibraryTab("media") : setPanelTab("media"))}
    />
  );
  const mediaBin = (
    <MediaBin
      items={media}
      assetBase={assetBase}
      plan={plan}
      selectedLabel={selectedLabel}
      readOnly={readOnly}
      uploads={uploads}
      freshSrc={freshSrc}
      onAdd={addItem}
      onReplace={replaceWith}
      onUseAudio={setMusic}
      onUpload={upload}
    />
  );
  const textPanel = <TextPanel plan={plan} readOnly={readOnly} selectedLabel={selectedLabel} onAdd={addCard} />;
  const panelTabs = [
    { id: "edit" as const, label: validSelected !== null ? `Shot ${validSelected + 1}` : "Edit" },
    { id: "media" as const, label: "Media" },
    { id: "text" as const, label: "Text" },
  ];

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#0c0d10] text-white">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-white/[0.06] bg-[#111216] px-2 sm:gap-2 sm:px-3">
        <Link href={`/v/${id}`} aria-label="Back to the video" className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white">
          <Back className="size-4" />
          <span className="hidden sm:inline">Back</span>
        </Link>
        <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
        <div className="min-w-0 flex-1 sm:flex-none">
          <p className="truncate text-sm font-medium">{plan.title}</p>
          <p className="flex items-center gap-1.5 truncate text-[11px] text-muted">
            {readOnly ? (
              <>
                <span className="size-1.5 shrink-0 rounded-full bg-white/30" />
                {auth === "checking" ? "Checking access…" : "View only"}
              </>
            ) : (
              <>
                <span className={`size-1.5 shrink-0 rounded-full ${dirty ? "bg-amber-400" : "bg-emerald-400"}`} />
                <span className="truncate">
                  {dirty ? "Unsaved changes" : "All changes saved"}
                  <span className="hidden sm:inline"> · {plan.themeName}</span>
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:mx-auto">
          <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={readOnly || history.at === 0}>
            <Undo className="size-[18px]" />
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={readOnly || history.at === history.stack.length - 1}>
            <Redo className="size-[18px]" />
          </IconButton>
        </div>

        <button onClick={reset} disabled={readOnly} className="hidden shrink-0 rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent lg:block">
          Reset to original
        </button>
        <button onClick={save} disabled={readOnly || !dirty || busy} className="shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-sm hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent sm:px-3">
          Save
        </button>
        <button
          onClick={renderNew}
          disabled={readOnly || render.status === "rendering" || render.status === "queued" || busy}
          title={readOnly ? "Open the edit link Claude gave you to export" : undefined}
          className={`relative flex shrink-0 items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-sm font-semibold transition sm:px-4 ${
            readOnly ? "cursor-not-allowed bg-white/10 text-white/40" : "bg-brand text-ink hover:brightness-110 disabled:cursor-wait"
          }`}
        >
          {render.status === "rendering" ? <span className="absolute inset-y-0 left-0 bg-white/40 transition-all" style={{ width: `${render.progress * 100}%` }} /> : null}
          {render.status === "queued" ? <span className="absolute inset-0 animate-pulse bg-white/25" /> : null}
          <Sparkle className="relative size-4 shrink-0" />
          <span className="relative whitespace-nowrap">{exportLabel}</span>
        </button>
      </header>

      {auth === "view" ? (
        <div role="status" className="flex shrink-0 items-center justify-center gap-2 border-b border-sky-400/20 bg-sky-400/10 px-4 py-2 text-center text-[13px] text-sky-100">
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span>
            <strong className="font-semibold">View only:</strong> open the edit link Claude gave you to make changes.
          </span>
        </div>
      ) : null}
      {justRendered ? (
        <div className="flex shrink-0 items-center justify-center gap-3 bg-emerald-500/15 py-2 text-sm text-emerald-200">
          Version {justRendered} is ready.
          <Link href={`/v/${id}?v=${justRendered}`} className="font-semibold underline underline-offset-2">
            Watch it
          </Link>
        </div>
      ) : null}
      {render.status === "error" && !hideRenderError ? (
        <ErrorBanner
          title="Export failed"
          message={render.error ?? "The renderer stopped unexpectedly."}
          details={render.errorDetails}
          onRetry={readOnly ? undefined : renderNew}
          onDismiss={() => setHideRenderError(true)}
        />
      ) : null}
      {error ? <ErrorBanner title="Couldn't save" message={error} onDismiss={() => setError(null)} /> : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {/* Library (wide screens): media bin and text cards, CapCut-style on the left. */}
          {mode === "wide" ? (
            <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/[0.06] bg-[#111216]">
              <Tabs
                value={libraryTab}
                onChange={setLibraryTab}
                tabs={[
                  { id: "media", label: "Media", icon: <Film className="size-3.5" /> },
                  { id: "text", label: "Text", icon: <span className="text-[13px] font-bold leading-none">T</span> },
                ]}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">{libraryTab === "media" ? mediaBin : textPanel}</div>
            </aside>
          ) : null}

          {/* Stage */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-[160px] flex-1 items-center justify-center bg-[radial-gradient(ellipse_at_center,#16181d_0%,#0c0d10_70%)] p-3 sm:p-6">
              <div className="relative h-full max-h-full w-full" style={{ maxWidth: portrait ? 420 : undefined }}>
                {/* A size container, so the frame can "contain" itself in any stage shape (cq units below). */}
                <div className="absolute inset-0 flex items-center justify-center" style={{ containerType: "size" }}>
                  <div
                    className="overflow-hidden rounded-lg shadow-2xl shadow-black/60 ring-1 ring-white/10"
                    style={{ width: `min(100cqw, calc(100cqh * ${width / height}))`, height: `min(100cqh, calc(100cqw * ${height / width}))` }}
                  >
                    <Player
                      ref={player}
                      component={Reel}
                      inputProps={inputProps}
                      durationInFrames={durationInFrames}
                      compositionWidth={width}
                      compositionHeight={height}
                      fps={plan.fps}
                      initialFrame={initialFrame}
                      clickToPlay
                      doubleClickToFullscreen
                      loop
                      acknowledgeRemotionLicense
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Transport */}
            <div className="flex h-12 shrink-0 items-center gap-3 border-t border-white/[0.06] bg-[#111216] px-3 sm:px-4">
              <button onClick={() => player.current?.toggle()} aria-label={playing ? "Pause" : "Play"} className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-ink transition hover:scale-105">
                {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
              </button>
              <span className="font-mono text-xs tabular-nums text-white/80">
                {fmt(frame, plan.fps)} <span className="text-muted">/ {fmt(durationInFrames, plan.fps)}</span>
              </span>
              <div className="ml-auto flex items-center gap-1">
                <IconButton
                  label={muted ? "Unmute" : "Mute"}
                  onClick={() => {
                    if (muted) player.current?.unmute();
                    else player.current?.mute();
                    setMuted(!muted);
                  }}
                >
                  {muted ? <Muted className="size-[18px]" /> : <Volume className="size-[18px]" />}
                </IconButton>
                <IconButton label="Full screen" onClick={() => player.current?.requestFullscreen()}>
                  <Expand className="size-[18px]" />
                </IconButton>
              </div>
            </div>
          </div>

          {/* Inspector (wide) or tabbed side panel (tablet) */}
          {mode !== "narrow" ? (
            <aside className="flex w-[320px] shrink-0 flex-col border-l border-white/[0.06] bg-[#111216] xl:w-[340px]">
              {mode === "mid" ? <Tabs value={panelTab} onChange={setPanelTab} tabs={panelTabs} /> : null}
              <div className="min-h-0 flex-1 overflow-y-auto">{mode === "wide" || panelTab === "edit" ? inspector : panelTab === "media" ? mediaBin : textPanel}</div>
            </aside>
          ) : null}
        </div>

        {/* Timeline */}
        <div className={`${mode === "narrow" ? "h-[160px]" : "h-[196px]"} shrink-0 border-t border-white/[0.06] bg-[#111216]`}>
          <Timeline
            plan={plan}
            assetBase={assetBase}
            frame={frame}
            durationInFrames={durationInFrames}
            selected={validSelected}
            zoom={zoom}
            onZoom={setZoom}
            onSeek={seek}
            onSelect={(i, f) => {
              setSelected(i);
              seek(f);
              if (i !== null && mode !== "wide") setPanelTab("edit");
            }}
            onMove={move}
            playing={playing}
            media={mediaBySrc}
            readOnly={readOnly}
          />
        </div>

        {/* Phone: the panels become a bottom sheet under the timeline. */}
        {mode === "narrow" ? (
          <div className="flex h-[38dvh] min-h-[220px] shrink-0 flex-col border-t border-white/[0.08] bg-[#111216]">
            <Tabs value={panelTab} onChange={setPanelTab} tabs={panelTabs} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panelTab === "edit" ? inspector : panelTab === "media" ? mediaBin : textPanel}</div>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <span className="rounded-full bg-white px-4 py-2 text-sm font-medium text-ink shadow-xl shadow-black/40">{notice}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Compact, friendly error strip: one-line message, the rest behind "Details", optional Retry, dismiss. */
function ErrorBanner({ title, message, details, onRetry, onDismiss }: { title: string; message: string; details?: string; onRetry?: () => void; onDismiss: () => void }) {
  const [first, ...rest] = message.trim().split(/\r?\n/);
  const more = [rest.join("\n").trim(), details?.trim()].filter(Boolean).join("\n\n");
  return (
    <div role="alert" className="shrink-0 border-b border-red-400/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-100 sm:px-4">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-red-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5M12 16.2v.3" />
        </svg>
        <p className="line-clamp-2 min-w-0 flex-1 break-words" title={first}>
          <span className="font-semibold">{title}:</span> <span className="text-red-100/85">{first}</span>
        </p>
        {onRetry ? (
          <button onClick={onRetry} className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-white/20">
            Retry
          </button>
        ) : null}
        <button onClick={onDismiss} aria-label="Dismiss" className="grid size-6 shrink-0 place-items-center rounded-md text-red-100/70 transition hover:bg-white/10 hover:text-white">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {more ? (
        <details className="group mt-1 pl-6">
          <summary className="w-fit cursor-pointer list-none text-xs text-red-200/70 hover:text-red-100 [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition group-open:rotate-90">›</span> Details
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-red-100/70">{more}</pre>
        </details>
      ) : null}
    </div>
  );
}
