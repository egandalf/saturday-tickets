"use client";

import { useState } from "react";
import type { Decision } from "../../lib/types";

export function ToolApprovePanel({
  calls,
  busy,
  onDecide,
}: {
  calls: { id: string; name: string; input: unknown }[];
  busy: boolean;
  onDecide: (d: Decision) => void;
}) {
  const [approved, setApproved] = useState<Set<string>>(new Set());
  return (
    <div className="stack">
      <h2>The agent wants to change live data</h2>
      {calls.map((c) => (
        <div key={c.id} className="panel stack">
          <div className="row">
            <button
              type="button"
              aria-pressed={approved.has(c.id)}
              onClick={() =>
                setApproved((s) => {
                  const next = new Set(s);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
            >
              {approved.has(c.id) ? "Allowed" : "Allow"}
            </button>
            <strong>{c.name}</strong>
          </div>
          <pre className="mono small diff">{JSON.stringify(c.input, null, 2)}</pre>
        </div>
      ))}
      <button className="primary" type="button" disabled={busy} onClick={() => onDecide({ kind: "approve_tool", approved: [...approved] })}>
        Continue ({approved.size} allowed, {calls.length - approved.size} declined)
      </button>
    </div>
  );
}
