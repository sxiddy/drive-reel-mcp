/** This browser's own jobs, so "Your videos" can list them without a public gallery. */

export type MyMake = { id: string; occasion: string; createdAt: string; videoId?: string };

const KEY = "drive-reel:makes";

export function readMakes(): MyMake[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function rememberMake(m: MyMake) {
  try {
    const rest = readMakes().filter((x) => x.id !== m.id);
    localStorage.setItem(KEY, JSON.stringify([m, ...rest].slice(0, 50)));
  } catch {
    /* private mode: the job still runs, it just isn't listed later */
  }
}

export function forgetMake(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(readMakes().filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
}
