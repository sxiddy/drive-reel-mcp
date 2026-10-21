/**
 * When each clip and photo was taken, so the edit can follow the night in capture order, show
 * time-of-day chips and write the date line on the end card.
 *
 * `takenAt` is an ISO 8601 string. With a zone ("…Z" or "…+05:30") it is an absolute instant; without one
 * ("2026-09-18T22:49:00") it is the camera's wall-clock time (EXIF, most phone file names). `captureClock`
 * puts both on one local wall-clock scale.
 */

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function iso(y: number, mo: number, d: number, h: number, mi: number, s: number, zone = ""): string | undefined {
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined;
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (t.getUTCDate() !== d) return undefined; // 31 February
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${zone}`;
}

/**
 * Capture time from a file name. Pixel's PXL_ names are UTC; other phone patterns (IMG_/VID_/plain
 * YYYYMMDD_HHMMSS, "WhatsApp Image 2026-09-18 at 22.10.05", GPS-camera "19-09-202610:54:39AM") are local.
 */
export function timeFromName(name: string): string | undefined {
  const base = name.replace(/\.[^.]+$/, "");
  const dmy = base.match(/(?:^|\D)(\d{2})[-.](\d{2})[-.](20\d{2})[ _T-]?(\d{1,2})[:.\-](\d{2})[:.\-](\d{2}) ?([AP]M)?/i);
  if (dmy) {
    let h = Number(dmy[4]);
    const ap = dmy[7]?.toUpperCase();
    if (ap) {
      if (h < 1 || h > 12) return undefined;
      h = (h % 12) + (ap === "PM" ? 12 : 0);
    }
    return iso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]), h, Number(dmy[5]), Number(dmy[6]));
  }
  const ymd = base.match(/(?:^|\D)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ _T-]|[ _]at[ _])?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})(?!\d{3,}\d)/i);
  if (!ymd) return undefined;
  const utc = /^PXL_/i.test(base);
  return iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), Number(ymd[4]), Number(ymd[5]), Number(ymd[6]), utc ? "Z" : "");
}

/** "2026:09:18 21:49:38" (+ optional "+05:30") from EXIF to ISO. */
export function exifDateToIso(dt: string, offset?: string): string | undefined {
  const m = dt.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const z = offset?.match(/^[+-]\d{2}:\d{2}$/) ? offset : "";
  return iso(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], z);
}

/** Container tags (ffprobe format/stream tags): Apple's creationdate carries the local offset; creation_time is UTC. */
export function timeFromTags(tags: Record<string, string | undefined>): string | undefined {
  const apple = tags["com.apple.quicktime.creationdate"];
  const am = apple?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-])(\d{2}):?(\d{2})$/);
  if (am) {
    const r = iso(+am[1], +am[2], +am[3], +am[4], +am[5], +am[6], `${am[7]}${am[8]}:${am[9]}`);
    if (r) return r;
  }
  const ct = tags.creation_time;
  const m = ct?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  return iso(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], /Z$|[+-]00:?00$/.test(ct!) || !/[+-]\d{2}:?\d{2}$/.test(ct!) ? "Z" : "");
}

/**
 * EXIF DateTimeOriginal (+ OffsetTimeOriginal) anywhere in a buffer: finds the "Exif\0\0" TIFF block, so it
 * works for JPEG APP1 and for HEIC (whose Exif item sits near the start of the file).
 */
export function exifTakenAt(buf: Buffer): string | undefined {
  let at = buf.indexOf("Exif\0\0", 0, "latin1");
  while (at >= 0) {
    const r = readTiffDate(buf, at + 6);
    if (r) return r;
    at = buf.indexOf("Exif\0\0", at + 6, "latin1");
  }
  return undefined;
}

function readTiffDate(buf: Buffer, t: number): string | undefined {
  if (t + 8 > buf.length) return undefined;
  const order = buf.toString("latin1", t, t + 2);
  if (order !== "II" && order !== "MM") return undefined;
  const le = order === "II";
  const u16 = (o: number) => (o + 2 <= buf.length ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : 0);
  const u32 = (o: number) => (o + 4 <= buf.length ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : 0);
  const ascii = (e: number) => {
    const n = u32(e + 4);
    const off = n <= 4 ? e + 8 : t + u32(e + 8);
    return off + n <= buf.length ? buf.toString("latin1", off, off + n).replace(/\0+$/, "") : undefined;
  };
  const entries = (ifd: number) => {
    const out = new Map<number, number>();
    const n = u16(ifd);
    for (let k = 0; k < n && k < 400; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > buf.length) break;
      out.set(u16(e), e);
    }
    return out;
  };
  const ifd0 = entries(t + u32(t + 4));
  const exifPtr = ifd0.get(0x8769);
  const sub = exifPtr !== undefined ? entries(t + u32(exifPtr + 8)) : new Map<number, number>();
  const dto = sub.get(0x9003) ?? sub.get(0x9004);
  const dt = dto !== undefined ? ascii(dto) : ifd0.get(0x0132) !== undefined ? ascii(ifd0.get(0x0132)!) : undefined;
  if (!dt) return undefined;
  const off = sub.get(0x9011) ?? sub.get(0x9010);
  return exifDateToIso(dt, off !== undefined ? ascii(off) : undefined);
}

const ZONE = /(Z|[+-]\d{2}:\d{2})$/;
const zoneMinutes = (s: string) => {
  const z = s.match(ZONE)?.[1];
  if (!z) return undefined;
  if (z === "Z") return 0;
  return (z[0] === "-" ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(4, 6)));
};
/** Wall-clock milliseconds of an ISO string, ignoring its zone. */
const wallMs = (s: string) => Date.parse(s.replace(ZONE, "") + "Z");

/**
 * Every item's capture time on one local wall-clock scale (ms, as if UTC), or undefined.
 * The event's UTC offset is the commonest explicit non-zero offset (iPhone clips, EXIF OffsetTime); with
 * none, the offset (in half hours) that packs UTC-stamped and wall-clock items closest together; with only
 * UTC items, `fallbackOffsetMin`.
 */
export function captureClock(taken: (string | undefined)[], fallbackOffsetMin = -new Date().getTimezoneOffset()): (number | undefined)[] {
  const offs = taken.map((s) => (s ? zoneMinutes(s) : undefined));
  const explicit = taken.map((s, i) => (s && offs[i] !== undefined && !s.endsWith("Z") ? offs[i]! : undefined)).filter((x): x is number => x !== undefined);
  let offset: number;
  if (explicit.length) {
    const count = new Map<number, number>();
    for (const o of explicit) count.set(o, (count.get(o) ?? 0) + 1);
    offset = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } else {
    const utc = taken.filter((s, i) => s && offs[i] === 0).map((s) => wallMs(s!));
    const local = taken.filter((s, i) => s && offs[i] === undefined).map((s) => wallMs(s!));
    offset = fallbackOffsetMin;
    if (utc.length && local.length) {
      // Sum of each UTC item's distance to its nearest wall-clock item.
      const cost = (o: number) => utc.reduce((n, u) => n + Math.min(...local.map((l) => Math.abs(u + o * 60_000 - l))), 0);
      let best = { o: 0, c: cost(0) };
      for (let o = -720; o <= 840; o += 30) {
        const c = cost(o);
        if (c < best.c - 60_000) best = { o, c };
      }
      offset = best.o;
    }
  }
  const out = taken.map((s, i) => {
    if (!s) return undefined;
    const ms = wallMs(s);
    if (!Number.isFinite(ms)) return undefined;
    return offs[i] === undefined ? ms : ms - offs[i]! * 60_000 + offset * 60_000;
  });
  // A camera whose clock was never set says 1 January 2025: anything over 3 days from the median is dropped.
  const known = out.filter((x): x is number => x !== undefined).sort((a, b) => a - b);
  const mid = known[known.length >> 1];
  return out.map((x) => (x !== undefined && Math.abs(x - mid) <= 3 * 86400_000 ? x : undefined));
}

/** Share of items with a capture time needed before the edit follows capture order. */
export const TIME_ORDER_MIN = 0.6;

/**
 * Story order of items by capture time (indices into `clock`), when at least 60% have one; otherwise null
 * (keep the folder order). Items without a time stay right after the timed item that preceded them.
 */
export function timeOrder(clock: (number | undefined)[]): number[] | null {
  const timed = clock.filter((x) => x !== undefined).length;
  if (!clock.length || timed / clock.length < TIME_ORDER_MIN) return null;
  const firstTimed = clock.find((x) => x !== undefined)!;
  let last = firstTimed;
  const keys = clock.map((x, i) => {
    if (x !== undefined) last = x;
    return { i, k: x ?? last, sub: x === undefined ? 1 : 0 };
  });
  return keys.sort((a, b) => a.k - b.k || a.sub - b.sub || a.i - b.i).map((x) => x.i);
}

/** "10:49 PM" from a wall-clock ms. */
export function clockLabel(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${pad(d.getUTCMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** Chips need the footage to span at least this long, … */
export const CHIP_SPAN_MS = 3 * 3600_000;
/** …at most one chip per this many seconds of video, … */
export const CHIP_GAP_S = 4;
/** …and the clock must have moved on at least this much since the last chip. */
export const CHIP_STEP_MS = 40 * 60_000;

/**
 * Which shots get a time-of-day chip. `shots` are in timeline order: start second on the timeline and the
 * shot's wall-clock capture time. The first timed shot always gets one; later ones only when the clock
 * moved forward by CHIP_STEP_MS and the previous chip is CHIP_GAP_S behind.
 */
export function timeChips(shots: { at: number; ms?: number }[]): (string | undefined)[] {
  const times = shots.map((s) => s.ms).filter((x): x is number => x !== undefined);
  if (times.length < 2 || Math.max(...times) - Math.min(...times) < CHIP_SPAN_MS) return shots.map(() => undefined);
  let lastAt = -Infinity;
  let lastMs = -Infinity;
  return shots.map((s) => {
    if (s.ms === undefined || s.at - lastAt < CHIP_GAP_S || s.ms - lastMs < CHIP_STEP_MS) return undefined;
    lastAt = s.at;
    lastMs = s.ms;
    return clockLabel(s.ms);
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * End-card date line from capture times: "18 September 2026", "18–19 September 2026",
 * "30 September – 1 October 2026" or "31 December 2026 – 1 January 2027". Undefined when no times, or when
 * they span more than two weeks (a folder of mixed old footage, not one event).
 */
export function dateRangeLabel(ms: (number | undefined)[]): string | undefined {
  const ts = ms.filter((x): x is number => x !== undefined && Number.isFinite(x));
  if (!ts.length) return undefined;
  const a = new Date(Math.min(...ts));
  const b = new Date(Math.max(...ts));
  if (b.getTime() - a.getTime() > 14 * 86400_000) return undefined;
  const [da, ma, ya] = [a.getUTCDate(), a.getUTCMonth(), a.getUTCFullYear()];
  const [db, mb, yb] = [b.getUTCDate(), b.getUTCMonth(), b.getUTCFullYear()];
  if (ya !== yb) return `${da} ${MONTHS[ma]} ${ya} – ${db} ${MONTHS[mb]} ${yb}`;
  if (ma !== mb) return `${da} ${MONTHS[ma]} – ${db} ${MONTHS[mb]} ${yb}`;
  if (da !== db) return `${da}–${db} ${MONTHS[mb]} ${yb}`;
  return `${da} ${MONTHS[ma]} ${ya}`;
}
