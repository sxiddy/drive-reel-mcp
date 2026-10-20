/** Browser-side storage of a video's edit key (from the ?key= edit link Claude hands out). */

const storageKey = (id: string) => `drive-reel:key:${id}`;

export function readStoredKey(id: string): string | null {
  try {
    return localStorage.getItem(storageKey(id));
  } catch {
    return null;
  }
}

export function storeKey(id: string, key: string) {
  try {
    localStorage.setItem(storageKey(id), key);
  } catch {
    /* private mode: the key still works for this page view */
  }
}

export function forgetKey(id: string) {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {
    /* ignore */
  }
}

/** Asks the server whether `key` unlocks editing for this video. */
export async function checkEditKey(id: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/videos/${id}/auth`, { method: "POST", headers: { "x-edit-key": key }, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
