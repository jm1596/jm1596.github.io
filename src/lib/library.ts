import type { ShowMeta, ShowData, Clue } from "../types";

const LIB_KEY = "jr:library";               // list of ShowMeta
const SHOW_KEY = (id: string) => `jr:show:${id}`;

// same hash you already use
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

export function loadLibrary(): ShowMeta[] {
  try { return JSON.parse(localStorage.getItem(LIB_KEY) || "[]"); } catch { return []; }
}
export function saveLibrary(list: ShowMeta[]) {
  localStorage.setItem(LIB_KEY, JSON.stringify(list));
}

export function loadShow(id: string): ShowData | null {
  try { return JSON.parse(localStorage.getItem(SHOW_KEY(id)) || "null"); } catch { return null; }
}
export function saveShow(show: ShowData) {
  localStorage.setItem(SHOW_KEY(show.id), JSON.stringify(show));
}

export function upsertShowMeta(meta: ShowMeta) {
  const list = loadLibrary();
  const i = list.findIndex(s => s.id === meta.id);
  if (i >= 0) list[i] = meta; else list.unshift(meta);
  saveLibrary(list);
}

export function computeStats(clues: Clue[], annotations: Record<number, { review: boolean }>) {
  const moneyToNumber = (m: string | number | null | undefined) =>
    typeof m === "number" ? (Number.isFinite(m) ? m : 0)
      : typeof m === "string" ? parseInt((m.replace(/[^0-9]/g, "")) || "0", 10) || 0
      : 0;

  let total = clues.length, marked = 0, correct = 0, coryat = 0;
  for (let i = 0; i < clues.length; i++) {
    const value = moneyToNumber(clues[i]?.money);
    const missed = !!annotations[i]?.review;
    if (missed) { marked++; coryat -= value; } else { correct++; coryat += value; }
  }
  return { total, marked, correct, coryat };
}

export function exportMarkedCSVAcrossShows(showEntries: Array<{ title: string; clues: Clue[]; annotations: ShowData["annotations"] }>) {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[\",\\n]/.test(s) ? `"${s.replace(/\"/g, '\"\"')}"` : s;
  };
  const rows = [["show_title","topic","money","question","answer","original_index"]];
  for (const { title, clues, annotations } of showEntries) {
    for (let i = 0; i < clues.length; i++) {
      if (annotations[i]?.review) {
        const c = clues[i];
        rows.push([title, c.topic ?? "", String(c.money ?? ""), c.question ?? "", c.answer ?? "", String(i)]);
      }
    }
  }
  return rows.map(r => r.map(esc).join(",")).join("\n");
}