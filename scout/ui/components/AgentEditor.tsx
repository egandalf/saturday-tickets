"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveAgentAction } from "../app/actions";
import type { AgentDefinition, InputField, ToolInfo } from "../lib/types";

const MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function AgentEditor({
  definition,
  version,
  tools,
  agents,
  isNew,
}: {
  definition: AgentDefinition;
  version: number;
  tools: ToolInfo[];
  agents: string[];
  isNew: boolean;
}) {
  const router = useRouter();
  const [def, setDef] = useState(definition);
  const [inputJson, setInputJson] = useState(JSON.stringify(definition.input, null, 2));
  const [recallText, setRecallText] = useState(definition.recall.join("\n"));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof AgentDefinition>(k: K, v: AgentDefinition[K]) => setDef((d) => ({ ...d, [k]: v }));

  const working = tools.filter((t) => t.effect !== "output");
  const outputs = tools.filter((t) => t.effect === "output");
  const output = outputs.find((t) => t.name === def.output);

  async function save() {
    let input: InputField[];
    try {
      input = JSON.parse(inputJson);
    } catch {
      setMessage({ ok: false, text: "Input fields aren't valid JSON." });
      return;
    }
    const next: AgentDefinition = {
      ...def,
      input,
      recall: recallText.split("\n").map((s) => s.trim()).filter(Boolean),
      handoff: output?.review === "select" ? def.handoff : undefined,
    };
    setBusy(true);
    const result = await saveAgentAction(next, note || (isNew ? "created in the UI" : ""));
    setBusy(false);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    setMessage({ ok: true, text: `Saved v${result.version}.` });
    setNote("");
    if (isNew) router.push(`/agents/${next.name}`);
    else router.refresh();
  }

  return (
    <section className="panel stack">
      <h2>{isNew ? "Definition" : `Edit (saves v${version + 1})`}</h2>
      <div className="row">
        <label>
          Name
          <input value={def.name} disabled={!isNew} onChange={(e) => set("name", e.target.value.toLowerCase())} placeholder="e.g. trail-check" />
        </label>
        <label className="grow">
          Description
          <input value={def.description} onChange={(e) => set("description", e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label>
          Model
          <select value={def.model} onChange={(e) => set("model", e.target.value)}>
            {MODELS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Effort
          <select value={def.effort} onChange={(e) => set("effort", e.target.value as AgentDefinition["effort"])}>
            {EFFORTS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Max turns
          <input type="number" min={1} max={100} value={def.maxTurns} onChange={(e) => set("maxTurns", Number(e.target.value))} style={{ width: 90 }} />
        </label>
      </div>
      <label>
        Instructions (plain English)
        <textarea rows={16} value={def.instructions} onChange={(e) => set("instructions", e.target.value)} />
      </label>

      <div className="stack">
        <p className="kicker">Tools from the library</p>
        <div className="row">
          {working.map((t) => (
            <button
              key={t.name}
              type="button"
              title={t.description}
              aria-pressed={def.tools.includes(t.name)}
              onClick={() => set("tools", def.tools.includes(t.name) ? def.tools.filter((x) => x !== t.name) : [...def.tools, t.name])}
            >
              {t.name} <span className="small">· {t.effect}</span>
            </button>
          ))}
        </div>
        <p className="small muted">Write tools always pause for a person before they run.</p>
      </div>

      <div className="row">
        <label>
          Finishes with (output and stop)
          <select value={def.output} onChange={(e) => set("output", e.target.value)}>
            {outputs.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.review}
                {t.onApprove ? ` → ${t.onApprove}` : ""})
              </option>
            ))}
          </select>
        </label>
        {output?.review === "select" ? (
          <label>
            Hand each chosen item to
            <select value={def.handoff ?? ""} onChange={(e) => set("handoff", e.target.value || undefined)}>
              <option value="">choose…</option>
              {agents.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {output ? <p className="small muted">{output.description}</p> : null}

      <div className="card">
        <label>
          Input fields (JSON: name, label, type string|text|number|json|place, required, default, help)
          <textarea className="mono small" rows={10} value={inputJson} onChange={(e) => setInputJson(e.target.value)} />
        </label>
        <label>
          Recall at start (one namespace per line; {"{path}"} reads the input, e.g. place/{"{placeId}"})
          <textarea className="mono small" rows={10} value={recallText} onChange={(e) => setRecallText(e.target.value)} />
        </label>
      </div>

      <div className="row">
        <label className="grow">
          What changed (saved with the version)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="primary" type="button" disabled={busy} onClick={save}>
          {isNew ? "Create agent" : "Save new version"}
        </button>
      </div>
      {message ? <p className={message.ok ? "status-done" : "error"}>{message.text}</p> : null}
    </section>
  );
}
