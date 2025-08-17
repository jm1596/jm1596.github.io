import type { Clue } from "../types";

export function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

export async function parseCluesFromFile(file: File): Promise<Clue[]> {
  const text = await file.text();
  return parseCluesFromText(text);
}

export function parseCluesFromText(text: string): Promise<Clue[]> {
  const Papa = (window as any).Papa;
  if (Papa) {
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase(),
        complete: (res: any) => {
          try {
            const rows = (res.data || []) as any[];
            const clues: Clue[] = rows.map((r) => ({
              topic: (r.topic ?? "").toString(),
              money: r.money === "" || r.money == null ? "" : r.money,
              question: (r.question ?? "").toString(),
              answer: (r.answer ?? "").toString(),
            }));
            resolve(clues);
          } catch (e) {
            reject(e);
          }
        },
        error: (err: any) => reject(err),
      });
    });
  }
  // Fallback parser
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return Promise.resolve([]);
  const header = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idxTopic = header.indexOf("topic");
  const idxMoney = header.indexOf("money");
  const idxQuestion = header.indexOf("question");
  const idxAnswer = header.indexOf("answer");
  const data: Clue[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    data.push({
      topic: cols[idxTopic] ?? "",
      money: cols[idxMoney] ?? "",
      question: cols[idxQuestion] ?? "",
      answer: cols[idxAnswer] ?? "",
    });
  }
  return Promise.resolve(data);
}

export function extractMetadataFromCSVText(text: string): { show_id?: string; air_date?: string; game_type?: string } {
  const Papa = (window as any).Papa;
  try {
    if (Papa) {
      const res = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim().toLowerCase() });
      const first = (res.data && res.data[0]) || null;
      if (first && typeof first === "object") {
        return {
          show_id: (first["show_id"] ?? "")?.toString?.() || undefined,
          air_date: (first["air_date"] ?? "")?.toString?.() || undefined,
          game_type: (first["game_type"] ?? "")?.toString?.() || undefined,
        };
      }
      return {};
    }
  } catch {
    // fall through
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return {};
  const header = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const cols = splitCSVLine(lines[1]);
  const idxShow = header.indexOf("show_id");
  const idxAir = header.indexOf("air_date");
  const idxType = header.indexOf("game_type");
  return {
    show_id: idxShow >= 0 ? cols[idxShow] : undefined,
    air_date: idxAir >= 0 ? cols[idxAir] : undefined,
    game_type: idxType >= 0 ? cols[idxType] : undefined,
  };
}


