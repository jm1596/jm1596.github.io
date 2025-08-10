import React, { useEffect, useMemo, useRef, useState } from "react";

// --- Types ---
type Clue = {
  topic: string;
  money: string | number | null;
  question: string;
  answer: string;
};

type Annotation = {
  review: boolean;
  category: string;
};

type SavedState = {
  annotations: Record<number, Annotation>;
  settings: {
    shuffle: boolean;
    reviewOnly: boolean;
  };
  lastIndex: number;
};

// --- Simple CSV parser ---
async function parseCSV(file: File): Promise<Clue[]> {
  const text = await file.text();
  // Try PapaParse if present
  const hasPapa = (window as any).Papa || null;
  if (hasPapa) {
    return new Promise((resolve, reject) => {
      (window as any).Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase(),
        complete: (res: any) => {
          const rows = (res.data || []) as any[];
          const clues: Clue[] = rows.map((r) => ({
            topic: (r.topic ?? "").toString(),
            money: r.money === "" || r.money == null ? "" : r.money,
            question: (r.question ?? "").toString(),
            answer: (r.answer ?? "").toString(),
          }));
          resolve(clues);
        },
        error: (err: any) => reject(err),
      });
    });
  }

  // Fallback parser
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
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
  return data;
}

function splitCSVLine(line: string): string[] {
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

function toCSV(rows: any[], headers: string[]): string {
  const esc = (val: any) => {
    const s = val == null ? "" : String(val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

// --- Helpers (top-level so they can be used by child components) ---
function moneyToNumber(m: string | number | null | undefined): number {
  if (typeof m === 'number') return Number.isFinite(m) ? m : 0;
  if (typeof m === 'string') {
    const digits = m.replace(/[^0-9]/g, '');
    const n = parseInt(digits || '0', 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

const CATEGORIES = [
  "Uncategorized",
  "Science", 
  "Literature",
  "Art",
  "History",
  "Geography",
  "Sports",
  "Pop Culture",
  "Misc",
];

export default function App() {
  const [fileText, setFileText] = useState<string>("");
  const [clues, setClues] = useState<Clue[]>([]);
  const [annotations, setAnnotations] = useState<Record<number, Annotation>>({});
  const [idx, setIdx] = useState<number>(0);
  const [revealed, setRevealed] = useState<boolean>(false);
  const [shuffle, setShuffle] = useState<boolean>(false);
  const [reviewOnly, setReviewOnly] = useState<boolean>(false);
  const [order, setOrder] = useState<number[]>([]);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const categories = CATEGORIES;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const storageKey = useMemo(() => {
    if (!fileText) return "jarchiveFlashcards:__none__";
    return `jarchiveFlashcards:${fnv1a(fileText)}`;
  }, [fileText]);

  // Build topics map and ordered list of unique topics based on first appearance
  const topicsData = useMemo(() => {
    const map: Record<string, number[]> = {};
    const list: string[] = [];
    for (let i = 0; i < clues.length; i++) {
      const t = clues[i]?.topic || "No Topic";
      if (!map[t]) {
        map[t] = [];
        list.push(t);
      }
      map[t].push(i);
    }
    return { map, list };
  }, [clues]);

  const activeIndices = useMemo(() => {
    const N = clues.length;
    const base = Array.from({ length: N }, (_, i) => i);
    let filtered = base;
    if (reviewOnly) {
      filtered = base.filter((i) => annotations[i]?.review === true);
    }
    if (shuffle) {
      return shuffleArray(filtered);
    }
    // Group by topic in original order
    const filteredSet = new Set(filtered);
    const grouped: number[] = [];
    for (const topic of topicsData.list) {
      const arr = topicsData.map[topic] || [];
      for (const i of arr) {
        if (filteredSet.has(i)) grouped.push(i);
      }
    }
    return grouped;
  }, [clues.length, annotations, reviewOnly, shuffle, topicsData]);

  useEffect(() => {
    setOrder(activeIndices);
    setIdx(0);
    setRevealed(false);
  }, [fileText, reviewOnly, shuffle, activeIndices.length]);

  const total = order.length;
  const currentIndex = order[idx] ?? 0;
  const currentAnn = annotations[currentIndex] || { review: false, category: categories[0] };

  useEffect(() => {
    if (!fileText) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved: SavedState = JSON.parse(raw);
        setAnnotations(saved.annotations || {});
        setShuffle(saved.settings?.shuffle ?? false);
        setReviewOnly(saved.settings?.reviewOnly ?? false);
        setIdx(Math.min(saved.lastIndex ?? 0, Math.max(0, (saved.annotations ? Object.keys(saved.annotations).length : 0))));
      }
    } catch { /* ignore */ }
  }, [storageKey, fileText]);

  useEffect(() => {
    if (!fileText) return;
    const state: SavedState = {
      annotations,
      settings: { shuffle, reviewOnly },
      lastIndex: idx,
    };
    // Note: localStorage not available in Claude artifacts environment
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch { /* ignore */ }
  }, [annotations, shuffle, reviewOnly, idx, storageKey, fileText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (total === 0) return;
      if (e.key === " ") {
        e.preventDefault();
        setRevealed((v) => !v);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        prev();
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        toggleReview();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, idx, order]);

  function shuffleArray(arr: number[]) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => setFileText(t));
    parseCSV(f)
      .then((rows) => {
        setClues(rows);
        setIdx(0);
        setRevealed(false);
        setAnnotations({});
        setShowSettings(false);
      })
      .catch((err) => {
        alert("Failed to parse CSV: " + err);
      });
  }

  function next() {
    if (idx < total - 1) {
      setIdx(idx + 1);
      setRevealed(false);
    }
  }

  function prev() {
    if (idx > 0) {
      setIdx(idx - 1);
      setRevealed(false);
    }
  }

  function setCategory(cat: string) {
    setAnnotations((a) => ({
      ...a,
      [currentIndex]: { ...(a[currentIndex] || { review: false, category: categories[0] }), category: cat },
    }));
  }

  function toggleReview() {
    setAnnotations((a) => ({
      ...a,
      [currentIndex]: { ...(a[currentIndex] || { review: false, category: categories[0] }), review: !a[currentIndex]?.review },
    }));
  }

  function exportCSV(onlyMarked: boolean) {
    const rows = (onlyMarked ? order.filter((i) => annotations[i]?.review) : order).map((i) => ({
      topic: clues[i]?.topic ?? "",
      money: clues[i]?.money ?? "",
      question: clues[i]?.question ?? "",
      answer: clues[i]?.answer ?? "",
      chosen_category: annotations[i]?.category ?? "",
      marked_for_review: annotations[i]?.review ? "true" : "false",
      original_index: i,
    }));
    const headers = ["topic", "money", "question", "answer", "chosen_category", "marked_for_review", "original_index"];
    const csv = toCSV(rows, headers);
    downloadText(csv, onlyMarked ? `jarchive_marked_${dateStamp()}.csv` : `jarchive_all_${dateStamp()}.csv`);
  }

  function downloadText(text: string, filename: string) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // (moved to top-level)

  function dateStamp() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"), "-", String(d.getHours()).padStart(2, "0"), String(d.getMinutes()).padStart(2, "0")].join("");
  }

  function resetAnnotations() {
    if (!confirm("Clear marks and categories for this file?")) return;
    setAnnotations({});
    setIdx(0);
    setRevealed(false);
  }

  const progressPct = total > 0 ? Math.round(((idx + 1) / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-slate-800">J-Archive Flashcards</h1>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFile}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
            >
              {clues.length ? "Load New" : "Load CSV"}
            </button>
            {clues.length > 0 && (
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Settings
              </button>
            )}
            {/* Topic selection removed per requirements */}
          </div>
        </div>
      </header>

      {/* Topic selection UI removed per requirements */}

      {/* Settings Panel */}
      {showSettings && clues.length > 0 && (
        <div className="bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 text-sm">
                  <input 
                    type="checkbox" 
                    className="accent-blue-600 w-4 h-4" 
                    checked={shuffle} 
                    onChange={(e) => setShuffle(e.target.checked)} 
                  />
                  <span className="font-medium text-slate-700">Shuffle Order</span>
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <input 
                    type="checkbox" 
                    className="accent-blue-600 w-4 h-4" 
                    checked={reviewOnly} 
                    onChange={(e) => setReviewOnly(e.target.checked)} 
                  />
                  <span className="font-medium text-slate-700">Review Only</span>
                </label>
              </div>
              <div>
                <button 
                  onClick={resetAnnotations} 
                  className="px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
                >
                  Clear All Marks
                </button>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => exportCSV(false)} 
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
                >
                  Export All
                </button>
                <button 
                  onClick={() => exportCSV(true)} 
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                >
                  Export Marked
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center py-8 px-6">
        {total === 0 ? (
          <div className="text-center max-w-md">
            <div className="text-8xl mb-6">📚</div>
            <h2 className="text-2xl font-bold text-slate-700 mb-3">No flashcards loaded</h2>
            <p className="text-slate-600 mb-8 text-lg">
              Upload a CSV file with columns: <br />
              <code className="bg-slate-100 px-3 py-1 rounded text-sm font-mono">topic, money, question, answer</code>
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-lg text-lg"
            >
              Choose CSV File
            </button>
          </div>
        ) : (
          <div className="w-full max-w-7xl mx-auto">
            {/* Progress */}
            <div className="mb-8">
              <div className="flex justify-between items-center mb-3">
                <span className="text-lg font-semibold text-slate-700">
                  Card {idx + 1} of {total}
                </span>
                <span className="text-lg font-semibold text-slate-700">{progressPct}%</span>
              </div>
              <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-200 ease-out rounded-full" 
                  style={{ width: `${progressPct}%` }} 
                />
              </div>
            </div>

            {/* Main Layout - Flashcard (80%) and Controls (20%) */}
            <div className="flex gap-8">
              {/* Left Side - Flashcard (80%) */}
              <div className="flex-1">
                {/* Modern Flashcard (Swipe Track) */}
                  <div className="relative mb-8 h-[450px] overflow-hidden">
                    <div
                      className="absolute inset-0 flex will-change-transform transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{ transform: `translateX(-${idx * 100}%)` }}
                    >
                      {order.map((cardIndex, slidePos) => {
                        const c = clues[cardIndex];
                        const ann = annotations[cardIndex] || { review: false, category: categories[0] };
                        const isActive = slidePos === idx;           // the visible slide in the strip
                        const isRevealed = isActive ? revealed : false;

                        return (
                          <div key={cardIndex} className="w-full shrink-0 px-0">
                            {/* Card with 3D flip kept intact */}
                            <div className="relative h-[450px]">
                              <div
                                className={`absolute inset-0 w-full h-full transition-transform duration-400 ${isRevealed ? 'rotate-y-180' : ''}`}
                                onClick={() => isActive && setRevealed(!revealed)}
                                style={{
                                  transformStyle: 'preserve-3d',
                                  transform: isRevealed ? 'rotateY(180deg)' : 'rotateY(0deg)',
                                }}
                              >
                                {/* Front (Question) */}
                                <div
                                  className="absolute inset-0 w-full h-full bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden"
                                  style={{ backfaceVisibility: 'hidden' }}
                                >
                                  <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-6">
                                    <div className="flex items-center justify-between">
                                      <h3 className="font-bold text-xl truncate">{c?.topic || "No Topic"}</h3>
                                      {c?.money && (
                                        <span className="bg-white/25 px-4 py-2 rounded-full text-sm font-bold backdrop-blur-sm">
                                          ${String(c.money).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex-1 flex items-center justify-center px-8 py-12">
                                    <p className="text-2xl text-slate-800 text-center leading-relaxed font-medium">
                                      {c?.question || "No question available"}
                                    </p>
                                  </div>

                                  <div className="px-8 py-6 border-t border-slate-100 bg-slate-50">
                                    <div className="text-center">
                                      <p className="text-slate-600 font-medium mb-2">Click to reveal answer</p>
                                      <p className="text-slate-500 text-sm">
                                        or press <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">Space</kbd>
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                {/* Back (Answer) */}
                                <div
                                  className="absolute inset-0 w-full h-full bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden"
                                  style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                                >
                                  <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white px-8 py-6">
                                    <div className="flex items-center justify-between">
                                      <h3 className="font-bold text-xl">Answer</h3>
                                      {ann.review && (
                                        <span className="bg-white/25 px-4 py-2 rounded-full text-sm font-bold backdrop-blur-sm">
                                          ★ Marked
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex-1 flex items-center justify-center px-8 py-12">
                                    <p className="text-2xl text-slate-800 text-center leading-relaxed font-semibold">
                                      {c?.answer || "No answer available"}
                                    </p>
                                  </div>

                                  <div className="px-8 py-6 border-t border-slate-100 bg-slate-50">
                                    <div className="text-center">
                                      <p className="text-slate-600 font-medium mb-2">Click to see question</p>
                                      <p className="text-slate-500 text-sm">
                                        or press <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">Space</kbd>
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                {/* Navigation Buttons */}
                <div className="flex justify-center gap-6 mb-8">
                  <button
                    onClick={prev}
                    disabled={idx === 0}
                    className="px-8 py-3 bg-white text-slate-700 rounded-xl shadow-lg border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-lg min-w-[140px]"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={next}
                    disabled={idx >= total - 1}
                    className="px-8 py-3 bg-white text-slate-700 rounded-xl shadow-lg border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-lg min-w-[140px]"
                  >
                    Next →
                  </button>
                </div>

                {/* End-of-deck summary */}
                {total > 0 && idx >= total - 1 && (
                  <div className="mb-8 p-4 bg-white border border-slate-200 rounded-xl shadow-sm text-center">
                    <div className="font-semibold text-slate-800 mb-2">All cards complete</div>
                    <DeckScoringSummary 
                      clues={clues} 
                      annotations={annotations} 
                      order={order}
                    />
                  </div>
                )}
              </div>

              {/* Right Side - Controls and Info (20%) */}
              <div className="w-80 flex-shrink-0">
                {/* Card Actions */}
                <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 mb-6">
                  <h3 className="text-lg font-semibold text-slate-800 mb-4">Card Actions</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-slate-600 font-semibold mb-2">Category:</label>
                      <select
                        value={currentAnn.category || categories[0]}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full text-sm bg-white border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium"
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={toggleReview}
                      className={`w-full px-6 py-2.5 rounded-lg font-semibold transition-colors ${
                        currentAnn.review 
                          ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border border-yellow-300" 
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300"
                      }`}
                      title="Press R to toggle"
                    >
                      {currentAnn.review ? "★ Marked for Review" : "☆ Mark for Review"}
                    </button>
                  </div>
                </div>

                {/* Keyboard shortcuts */}
                <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
                  <h3 className="text-lg font-semibold text-slate-800 mb-4">Keyboard Shortcuts</h3>
                  <div className="space-y-3 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 bg-slate-100 border border-slate-300 rounded text-xs font-mono">Space</kbd>
                      <span>flip card</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 bg-slate-100 border border-slate-300 rounded text-xs font-mono">←</kbd>
                      <kbd className="px-2 py-1 bg-slate-100 border border-slate-300 rounded text-xs font-mono">→</kbd>
                      <span>navigate</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 bg-slate-100 border border-slate-300 rounded text-xs font-mono">R</kbd>
                      <span>mark for review</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeckScoringSummary({ clues, annotations, order }: { clues: Clue[]; annotations: Record<number, Annotation>; order: number[] }) {
  const { totalCards, markedCount, totalCorrect, coryat } = useMemo(() => {
    let totalCardsLocal = 0;
    let marked = 0;
    let correct = 0;
    let score = 0;
    for (const i of order) {
      totalCardsLocal++;
      const isMarked = !!annotations[i]?.review;
      const value = moneyToNumber(clues[i]?.money);
      if (isMarked) {
        marked++;
        score -= value;
      } else {
        correct++;
        score += value;
      }
    }
    return { totalCards: totalCardsLocal, markedCount: marked, totalCorrect: correct, coryat: score };
  }, [order, annotations, clues]);

  return (
    <div className="text-sm text-slate-700 mb-2">
      <div className="flex flex-wrap gap-4 justify-center">
        <div><span className="font-semibold">Total:</span> {totalCards}</div>
        <div><span className="font-semibold">Marked (missed):</span> {markedCount}</div>
        <div><span className="font-semibold">Correct:</span> {totalCorrect}</div>
        <div><span className="font-semibold">Coryat:</span> {formatCurrency(coryat)}</div>
      </div>
    </div>
  );
}