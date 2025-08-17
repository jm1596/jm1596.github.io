import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import App from "../App";
import type { ShowData } from "../types";
import { loadShow, saveShow, computeStats, upsertShowMeta, loadLibrary } from "../lib/library";
import { parseCluesFromText } from "../lib/csv";

export default function Review() {
  const { showId } = useParams<{ showId: string }>();
  const [show, setShow] = useState<ShowData | null>(null);

  useEffect(() => {
    if (!showId) return;
    const data = loadShow(showId) || null;
    setShow(data);
  }, [showId]);

  if (!showId) return <div className="p-6">Missing show id</div>;
  if (!show) return <div className="p-6">Show not found or not loaded</div>;

  return (
    <div>
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-3">
          <Link to="/" className="text-blue-600 hover:underline">← Back to Shows</Link>
        </div>
      </div>
      {/* Metadata panel */}
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm text-slate-700">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Meta label="Show ID" value={show.meta?.show_id || "-"} />
              <Meta label="Air Date" value={show.meta?.air_date || "-"} />
              <Meta label="Game Type" value={show.meta?.game_type || "-"} />
              <Meta label="Last Index" value={String(show.lastIndex)} />
              <Meta label="Shuffle" value={show.settings.shuffle ? "On" : "Off"} />
            </div>
          </div>
        </div>
      </div>
      <App
        initialFileText={show.fileText}
        initialAnnotations={show.annotations}
        initialSettings={show.settings}
        initialLastIndex={show.lastIndex}
        readOnlyHeader={true}
        onStateChange={(state) => {
          const updated: ShowData = {
            ...show,
            annotations: state.annotations,
            settings: state.settings,
            lastIndex: state.lastIndex,
          };
          saveShow(updated);
          setShow(updated);
          // Recompute stats for Shows table
          parseCluesFromText(updated.fileText).then((clues) => {
            const stats = computeStats(clues, updated.annotations);
            const lib = loadLibrary();
            const existing = lib.find((m) => m.id === updated.id);
            upsertShowMeta({
              id: updated.id,
              title: existing?.title || updated.id,
              uploadedAt: existing?.uploadedAt || Date.now(),
              showId: existing?.showId ?? updated.meta?.show_id,
              airDate: existing?.airDate ?? updated.meta?.air_date,
              gameType: existing?.gameType ?? updated.meta?.game_type,
              stats,
            });
          }).catch(() => {/* ignore */});
        }}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-800 font-medium">{value}</div>
    </div>
  );
}

// Title no longer needed per requirements