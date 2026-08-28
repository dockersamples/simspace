import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Deployment-level app config, fetched once from `config.json` next to the app
// (like labs.json). Optional: a 404 or parse error just means "no app config"
// and everything degrades to off. It carries the default `tracking` config so
// a whole deployment points every lab at one pulse backend from a single
// place (a lab opts out with `tracking: false`); see the package's
// labspace/tracking.js. It also carries an optional `title`, the deployment's
// site name shown on the landing page and browser tab in place of the
// "Labspace" default — see Catalog.jsx.
//
// The deploy pipeline writes this file (or removes it); in dev it's the
// committed default pointing at the compose pulse (http://localhost:8888).

const AppConfigContext = createContext({
  status: "loading",
  tracking: null,
  title: null,
});

export function AppConfigProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    const url = new URL("config.json", document.baseURI).toString();
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setConfig(data && typeof data === "object" ? data : null);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setConfig(null);
        setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      status,
      tracking: config?.tracking || null,
      title: config?.title || null,
    }),
    [status, config],
  );

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
}

export const useAppConfig = () => useContext(AppConfigContext);
