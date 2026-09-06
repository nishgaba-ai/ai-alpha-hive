"use client";

// Talk to the company. Browser speech in and out by default (Web Speech
// API); when the company configures a voice provider the server endpoints
// take over transcription and synthesis. The board assistant answers and
// acts only on explicit instructions; every action is shown in the log.

import { useEffect, useRef, useState } from "react";

type Turn = { who: "you" | "company"; text: string; actions?: string[] };

type SR = { start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: unknown) => void) | null; lang: string; interimResults: boolean; continuous: boolean };

export function VoiceConsole({ slug, serverTts, serverStt }: { slug: string; serverTts: boolean; serverStt: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [text, setText] = useState("");
  const [supported, setSupported] = useState(true);
  const rec = useRef<SR | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor && !serverStt) setSupported(false);
    if (Ctor) {
      const r = new Ctor();
      r.lang = "en-IN";
      r.interimResults = false;
      r.continuous = false;
      r.onresult = (e) => {
        const t = Array.from(e.results).map((x) => x[0].transcript).join(" ");
        setListening(false);
        void ask(t);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      rec.current = r;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function say(t: string) {
    if (!speak) return;
    if (serverTts) {
      try {
        const r = await fetch(`/api/hive/companies/${slug}/voice/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
        if (r.ok) {
          const url = URL.createObjectURL(await r.blob());
          audio.current ??= new Audio();
          audio.current.src = url;
          await audio.current.play();
          return;
        }
      } catch {
        /* fall through to browser */
      }
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.rate = 1.02;
      const v = window.speechSynthesis.getVoices().find((x) => /en-IN|en-GB|Google UK English Female|Samantha/i.test(x.name + x.lang));
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    }
  }

  async function ask(q: string) {
    if (!q.trim()) return;
    setTurns((t) => [...t, { who: "you", text: q }]);
    setBusy(true);
    try {
      const r = await fetch(`/api/hive/companies/${slug}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, by: "voice", history: history.current.slice(-8) }) });
      const b = (await r.json()) as { text?: string; actions?: string[]; error?: string };
      const answer = b.text ?? b.error ?? "No answer.";
      history.current.push({ role: "user", content: q }, { role: "assistant", content: answer });
      setTurns((t) => [...t, { who: "company", text: answer, actions: b.actions }]);
      await say(answer);
    } catch (e) {
      setTurns((t) => [...t, { who: "company", text: `Could not reach the company: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (!rec.current) return;
    if (listening) {
      rec.current.stop();
      setListening(false);
    } else {
      window.speechSynthesis?.cancel();
      setListening(true);
      rec.current.start();
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="card flex min-h-[520px] flex-col p-5">
        <div className="flex-1 space-y-3 overflow-y-auto">
          {turns.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Try: “What is waiting for me?” · “Approve the LinkedIn post.” · “Start a mission: get twenty demo calls booked.” · “How much did we spend this month?”</p>
          ) : null}
          {turns.map((t, i) => (
            <div key={i} className={`rise max-w-[85%] ${t.who === "you" ? "ml-auto" : ""}`}>
              <p className="label mb-1">{t.who === "you" ? "you" : "company"}</p>
              <div className={`rounded-[var(--r-2)] px-4 py-3 text-sm leading-relaxed ${t.who === "you" ? "bg-[rgba(108,92,231,0.12)] text-[var(--ink)]" : "raised"}`}>{t.text}</div>
              {t.actions?.length ? <p className="mt-1 font-mono text-[11px] text-[var(--brass)]">acted: {t.actions.join(" · ")}</p> : null}
            </div>
          ))}
          {busy ? <p className="text-sm text-[var(--muted)] breathe">the company is thinking…</p> : null}
        </div>
        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = text;
            setText("");
            void ask(q);
          }}
        >
          <button type="button" onClick={toggleMic} disabled={!rec.current} className={`btn ${listening ? "btn-primary" : "btn-glass"} h-11 w-11 justify-center rounded-full p-0`} aria-label={listening ? "stop listening" : "start listening"} title={rec.current ? "" : "Speech recognition not available in this browser"}>
            <span className={`h-3 w-3 rounded-full ${listening ? "bg-[#ffffff] breathe" : "bg-[var(--brass)]"}`} />
          </button>
          <input value={text} onChange={(e) => setText(e.target.value)} className="field flex-1" placeholder={listening ? "listening…" : "or type"} />
          <button type="submit" className="btn btn-primary" disabled={busy}>Send</button>
        </form>
      </div>
      <aside className="space-y-4">
        <div className="card p-4 text-sm">
          <p className="label mb-2">Voice</p>
          <label className="flex items-center justify-between py-1"><span>Speak replies</span><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /></label>
          <p className="mt-2 text-xs text-[var(--muted)]">Recognition: {rec.current ? "browser" : serverStt ? "server" : "unavailable"} · Synthesis: {serverTts ? "server voice" : "browser voice"}</p>
          {!supported ? <p className="mt-2 text-xs text-[var(--failed)]">This browser has no speech recognition; type instead, or configure a server STT provider.</p> : null}
        </div>
        <div className="card p-4 text-sm">
          <p className="label mb-2">Talk from Claude</p>
          <p className="text-xs text-[var(--ink-2)]">The company is also an MCP server, so Claude Desktop, Claude Code and the Claude mobile app (voice mode) can run it:</p>
          <pre className="mt-2 overflow-x-auto rounded-[var(--r-1)] bg-[var(--surface-0)] p-2 font-mono text-[11px] text-[var(--ink-2)]">{`claude mcp add hive-company -- node runtime/dist/src/mcp.js --company ${slug}`}</pre>
        </div>
        <div className="card p-4 text-sm">
          <p className="label mb-2">What it can do</p>
          <ul className="space-y-1 text-xs text-[var(--ink-2)]">
            <li>Read status, tasks, spend, events</li>
            <li>List and decide approvals — only when you say so</li>
            <li>Start missions</li>
            <li>Read the monthly statement</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
