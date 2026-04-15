import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // Keep a trace in console to simplify production debugging.
    // eslint-disable-next-line no-console
    console.error("[ui] unexpected render error", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          background: "#0b1020",
          color: "#e4e4e7",
          fontFamily: "Roboto Mono, monospace",
        }}
      >
        <section style={{ maxWidth: 560, textAlign: "center", lineHeight: 1.6 }}>
          <h1 style={{ marginBottom: "0.75rem", fontSize: "1.2rem" }}>
            Errore inatteso della dashboard
          </h1>
          <p style={{ opacity: 0.9, marginBottom: "1rem" }}>
            L&apos;interfaccia ha incontrato un problema. Ricarica la pagina; se il problema
            persiste, controlla i log del browser.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: "1px solid #7c3aed",
              background: "#1e1b4b",
              color: "#e4e4e7",
              padding: "0.55rem 1rem",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Ricarica pagina
          </button>
        </section>
      </main>
    );
  }
}
