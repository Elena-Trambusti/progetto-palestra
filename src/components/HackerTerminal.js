import React, { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import "./HackerTerminal.css";

export default function HackerTerminal({ lines }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section
      className="hacker-terminal glass-panel animate-in animate-in-delay-3"
      aria-label="Log sensori in tempo reale"
    >
      <div className="hacker-terminal__bar">
        <Terminal className="hacker-terminal__icon" aria-hidden />
        <span className="hacker-terminal__title mono">STREAM_SENSORI</span>
        <span className="hacker-terminal__meta mono">AES-256 · uplink</span>
      </div>
      <div
        ref={bodyRef}
        className="hacker-terminal__body mono"
        role="log"
      >
        {lines.map((entry) => (
          <div key={entry.id} className="hacker-terminal__line">
            {entry.text}
          </div>
        ))}
      </div>
    </section>
  );
}
