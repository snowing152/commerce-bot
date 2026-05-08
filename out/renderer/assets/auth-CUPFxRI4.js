import { R as ReactDOM, j as jsxRuntimeExports, E as ErrorBoundary, r as reactExports, A as AuthPage } from "./ErrorBoundary-CIs8NLRM.js";
function AuthApp() {
  const [status, setStatus] = reactExports.useState("idle");
  const [token, setToken] = reactExports.useState("");
  const handleLoginClick = async () => {
    setStatus("waiting");
    try {
      const tok = await window.api.startTelegramAuth();
      setToken(tok);
    } catch {
      setStatus("error");
    }
  };
  reactExports.useEffect(() => {
    if (status !== "waiting" || !token) return;
    const id = setInterval(async () => {
      try {
        const result = await window.api.checkAuthToken(token);
        if (result.success) {
          clearInterval(id);
          setStatus("confirmed");
          window.api.navigateTo("main");
        }
      } catch {
      }
    }, 3e3);
    return () => clearInterval(id);
  }, [status, token]);
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    AuthPage,
    {
      status,
      onStatusChange: setStatus,
      onAuthenticated: () => window.api.navigateTo("main"),
      onLoginClick: handleLoginClick
    }
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(ErrorBoundary, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(AuthApp, {}) })
);
