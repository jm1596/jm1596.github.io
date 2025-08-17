import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Clue, ShowMeta, ShowData } from "../types";
import { fnv1a, loadLibrary, saveLibrary, upsertShowMeta, loadShow, saveShow, computeStats, exportMarkedCSVAcrossShows } from "../lib/library";
import { parseCluesFromFile, extractMetadataFromCSVText } from "../lib/csv";

export default function Shows() {
  const [library, setLibrary] = useState<ShowMeta[]>([]);
  const [sortBy, setSortBy] = useState<
    "airDate" | "gameType" | "showId" | "uploadedAt" | "coryat" | "marked" | "total"
  >("uploadedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setLibrary(loadLibrary()), []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fileText = await f.text();
    const id = fnv1a(fileText);
    const title = f.name.replace(/\\.csv$/i, "");
    const metaCols = extractMetadataFromCSVText(fileText);
    // parse to get stats and total
    let clues: Clue[] = [];
    try { clues = await parseCluesFromFile(f); } catch { /* fallback or show error */ }
    const showData: ShowData = {
      id, fileText, annotations: {}, lastIndex: 0, settings: { shuffle: false, reviewOnly: false },
      meta: { show_id: metaCols.show_id, air_date: metaCols.air_date, game_type: metaCols.game_type }
    };
    saveShow(showData);
    const stats = computeStats(clues, showData.annotations);
    const meta: ShowMeta = {
      id, title, uploadedAt: Date.now(),
      showId: metaCols.show_id, airDate: metaCols.air_date, gameType: metaCols.game_type,
      stats
    };
    upsertShowMeta(meta);
    setLibrary(loadLibrary());
    e.target.value = ""; // reset for re-upload
  }

  function removeShow(id: string) {
    const list = loadLibrary().filter(s => s.id !== id);
    saveLibrary(list);
    localStorage.removeItem(`jr:show:${id}`);
    setLibrary(list);
  }

  function exportAllMarked() {
    const Papa = (window as any).Papa;
    const parseText = (text: string): Promise<Clue[]> => new Promise((resolve, reject) => {
      if (!Papa) {
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) return resolve([]);
        const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const idxTopic = header.indexOf("topic");
        const idxMoney = header.indexOf("money");
        const idxQuestion = header.indexOf("question");
        const idxAnswer = header.indexOf("answer");
        const clues: Clue[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",");
          clues.push({
            topic: cols[idxTopic] ?? "",
            money: cols[idxMoney] ?? "",
            question: cols[idxQuestion] ?? "",
            answer: cols[idxAnswer] ?? "",
          });
        }
        return resolve(clues);
      }
      Papa.parse(text, {
        header: true, skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase(),
        complete: (res: any) => {
          resolve((res.data || []).map((r: any) => ({
            topic: (r.topic ?? "").toString(),
            money: r.money === "" || r.money == null ? "" : r.money,
            question: (r.question ?? "").toString(),
            answer: (r.answer ?? "").toString(),
          })));
        },
        error: reject,
      });
    });

    Promise.all(library.map(async (meta) => {
      const data = loadShow(meta.id);
      if (!data) return null;
      const clues = await parseText(data.fileText);
      return { title: meta.title, clues, annotations: data.annotations };
    })).then((entries) => {
      const filtered = entries.filter((e): e is { title: string; clues: Clue[]; annotations: ShowData["annotations"] } => !!e);
      const csv = exportMarkedCSVAcrossShows(filtered);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `all_marked_${new Date().toISOString().slice(0,16).replace(/[:T]/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch((err) => alert("Export failed: " + err));
  }

  const sortedLibrary = useMemo(() => {
    const copy = library.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      const getNum = (v: any) => typeof v === "number" && isFinite(v) ? v : 0;
      const getStr = (v: any) => (v ?? "").toString().toLowerCase();
      switch (sortBy) {
        case "airDate": return getStr(a.airDate) > getStr(b.airDate) ? dir : -dir;
        case "gameType": return getStr(a.gameType) > getStr(b.gameType) ? dir : -dir;
        case "showId": return getStr(a.showId) > getStr(b.showId) ? dir : -dir;
        case "uploadedAt": return getNum(a.uploadedAt) > getNum(b.uploadedAt) ? dir : -dir;
        case "coryat": return getNum(a.stats?.coryat) > getNum(b.stats?.coryat) ? dir : -dir;
        case "marked": return getNum(a.stats?.marked) > getNum(b.stats?.marked) ? dir : -dir;
        case "total": return getNum(a.stats?.total) > getNum(b.stats?.total) ? dir : -dir;
      }
    });
    return copy;
  }, [library, sortBy, sortDir]);

  function setSort(key: typeof sortBy) {
    if (key === sortBy) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("desc"); }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Shows</h1>
        <div className="flex gap-3">
          <button onClick={() => fileRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Upload CSV</button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onUpload} />
          <button onClick={exportAllMarked} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg">Export Marked (All)</button>
        </div>
      </div>

      {library.length === 0 ? (
        <div className="text-slate-600">No shows yet. Upload a CSV to get started.</div>
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <Th label="Show ID" onClick={() => setSort("showId")} active={sortBy === "showId"} dir={sortDir} />
                <Th label="Air Date" onClick={() => setSort("airDate")} active={sortBy === "airDate"} dir={sortDir} />
                <Th label="Game Type" onClick={() => setSort("gameType")} active={sortBy === "gameType"} dir={sortDir} />
                <Th label="Coryat" onClick={() => setSort("coryat")} active={sortBy === "coryat"} dir={sortDir} right />
                <Th label="Marked" onClick={() => setSort("marked")} active={sortBy === "marked"} dir={sortDir} right />
                <Th label="Total" onClick={() => setSort("total")} active={sortBy === "total"} dir={sortDir} right />
                <Th label="Uploaded" onClick={() => setSort("uploadedAt")} active={sortBy === "uploadedAt"} dir={sortDir} />
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sortedLibrary.map(meta => (
                <tr key={meta.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{meta.showId || "-"}</td>
                  <td className="px-4 py-2">{meta.airDate || "-"}</td>
                  <td className="px-4 py-2">{meta.gameType || "-"}</td>
                  <td className="px-4 py-2 text-right">{typeof meta.stats?.coryat === 'number' ? `$${meta.stats.coryat.toLocaleString()}` : '-'}</td>
                  <td className="px-4 py-2 text-right">{meta.stats?.marked ?? '-'}</td>
                  <td className="px-4 py-2 text-right">{meta.stats?.total ?? '-'}</td>
                  <td className="px-4 py-2">{new Date(meta.uploadedAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <Link to={`/show/${meta.id}`} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs">Open</Link>
                      <button onClick={() => removeShow(meta.id)} className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ label, onClick, active, dir, right }: { label: string; onClick: () => void; active: boolean; dir: "asc" | "desc"; right?: boolean }) {
  return (
    <th className={`px-4 py-2 text-xs font-semibold tracking-wide cursor-pointer select-none ${right ? 'text-right' : 'text-left'}`} onClick={onClick}>
      <span className={`inline-flex items-center gap-1 ${active ? 'text-slate-900' : ''}`}>
        {label}
        {active && <span className="text-slate-400">{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
}