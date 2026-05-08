import { R as ReactDOM, j as jsxRuntimeExports, E as ErrorBoundary, r as reactExports, D as DashboardPage } from "./ErrorBoundary-CIs8NLRM.js";
function parseLogLine(msg) {
  const time = (/* @__PURE__ */ new Date()).toTimeString().slice(0, 8);
  const match = msg.match(/^\[(INFO|DEBUG|WARN|SKIP|ACTION|SUCCESS|ERROR)\]\s*(.*)/);
  if (match) {
    const rawLevel = match[1];
    const level = rawLevel === "SKIP" || rawLevel === "ACTION" ? "INFO" : rawLevel;
    return { id: `log-${Date.now()}-${Math.random()}`, time, level, source: "engine", message: match[2] };
  }
  return { id: `log-${Date.now()}-${Math.random()}`, time, level: "INFO", source: "engine", message: msg };
}
function toEngineTasks(tasks) {
  return tasks.map((t) => ({
    keyword: t.keyword,
    target_name: t.product,
    filters: [],
    cost: t.min > 0 && t.max > 0 ? [t.min, t.max] : []
  }));
}
function fromSessionTasks(raw) {
  return raw.map((t, i) => ({
    id: `t${i + 1}`,
    keyword: t.keyword ?? "",
    product: t.target_name ?? "",
    min: t.cost?.[0] ?? 0,
    max: t.cost?.[1] ?? 0,
    status: "idle"
  }));
}
function DashboardApp() {
  const [botState, setBotState] = reactExports.useState("idle");
  const [version, setVersion] = reactExports.useState("");
  const [initialTasks, setInitialTasks] = reactExports.useState(void 0);
  const [ipcLogs, setIpcLogs] = reactExports.useState([]);
  const [updateStatus, setUpdateStatus] = reactExports.useState("");
  reactExports.useEffect(() => {
    Promise.all([
      window.api.loadSession().catch(() => null),
      window.api.getVersion().catch(() => "")
    ]).then(([session, ver]) => {
      if (Array.isArray(session) && session.length > 0) {
        setInitialTasks(fromSessionTasks(session));
      } else {
        setInitialTasks([]);
      }
      setVersion(ver);
    });
  }, []);
  reactExports.useEffect(() => {
    const unLog = window.api.onLog((msg) => {
      try {
        const parsed = parseLogLine(msg);
        setIpcLogs((prev) => prev.length >= 600 ? [...prev.slice(-599), parsed] : [...prev, parsed]);
      } catch {
      }
    });
    const unDone = window.api.onDone(() => setBotState("idle"));
    const unStatus = window.api.onUpdateStatus((text) => setUpdateStatus(text));
    const unError = window.api.onUpdateError((p) => {
      if (p.message) setUpdateStatus(`Update error: ${p.message}`);
    });
    return () => {
      unLog();
      unDone();
      unStatus();
      unError();
    };
  }, []);
  const handleStartBot = (tasks) => {
    window.api.saveSession(toEngineTasks(tasks));
    window.api.startBot(toEngineTasks(tasks));
  };
  const handleLogout = async () => {
    await window.api.logout();
    window.api.navigateTo("auth");
  };
  if (initialTasks === void 0) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "h-full w-full grid place-items-center bg-zinc-950", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-zinc-500 text-[13px]", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { className: "animate-spin w-4 h-4", viewBox: "0 0 24 24", fill: "none", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: "12", cy: "12", r: "9", stroke: "currentColor", strokeOpacity: "0.18", strokeWidth: "2.5" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M12 3a9 9 0 0 1 9 9", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round" })
      ] }),
      "Loading…"
    ] }) });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    DashboardPage,
    {
      botState,
      onBotStateChange: setBotState,
      onLogout: handleLogout,
      onOpenSubscription: () => window.api.navigateTo("subscription"),
      version,
      initialTasks,
      onStartBot: handleStartBot,
      extraLogs: ipcLogs,
      updateStatus
    }
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(ErrorBoundary, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(DashboardApp, {}) })
);
