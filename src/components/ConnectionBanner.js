import React from "react";
import { WifiOff } from "lucide-react";
import "./ConnectionBanner.css";

export default function ConnectionBanner({ visible, title, detail }) {
  if (!visible) return null;

  return (
    <div
      className="connection-banner"
      role="alert"
      aria-live="assertive"
    >
      <WifiOff className="connection-banner__icon" aria-hidden />
      <div className="connection-banner__text">
        <strong className="connection-banner__title mono">{title}</strong>
        {detail ? (
          <p className="connection-banner__detail mono">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}
