import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import App from "./App";

function renderFallback(): React.ReactNode {
  return (
    <div role="alert">
      <h2>Something went wrong</h2>
      <p>Reload the add-in to try again.</p>
    </div>
  );
}

function bootstrap(): void {
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    document.body.innerHTML = '<div id="root"></div>';
    return bootstrap();
  }
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <ErrorBoundary fallbackRender={renderFallback}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
