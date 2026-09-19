import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Home } from "./Home";
import { OfficeView } from "./OfficeView";
import { applyTheme } from "./shared";

applyTheme();

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

function App() {
  const route = useHashRoute();
  const m = /^\/office\/([^/]+)/.exec(route);
  return m ? <OfficeView key={m[1]} officeId={m[1]} /> : <Home />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
