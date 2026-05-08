import { R as ReactDOM, j as jsxRuntimeExports, E as ErrorBoundary, r as reactExports, S as SubscriptionPage } from "./ErrorBoundary-D2UEI6XA.js";
function SubscriptionApp() {
  const [planStatus, setPlanStatus] = reactExports.useState("active");
  const [subInfo, setSubInfo] = reactExports.useState(void 0);
  const [loading, setLoading] = reactExports.useState(true);
  const fetchStatus = async () => {
    try {
      const data = await window.api.getSubscriptionStatus();
      setPlanStatus(data.status === "trial" ? "active" : data.status);
      const expires = data.periodEnd ? new Date(data.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
      const daysLeft = data.daysLeft ?? 0;
      setSubInfo({
        plan: "Pro",
        price: data.price ?? "₩29,000 / mo",
        expires,
        daysLeft
      });
    } catch {
    }
    setLoading(false);
  };
  reactExports.useEffect(() => {
    fetchStatus();
    const unsub = window.api.onSubscriptionUpdated(fetchStatus);
    return unsub;
  }, []);
  if (loading) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "h-full w-full grid place-items-center bg-zinc-950", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-zinc-500 text-[13px]", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { className: "animate-spin w-4 h-4", viewBox: "0 0 24 24", fill: "none", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: "12", cy: "12", r: "9", stroke: "currentColor", strokeOpacity: "0.18", strokeWidth: "2.5" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M12 3a9 9 0 0 1 9 9", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round" })
      ] }),
      "Loading subscription…"
    ] }) });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    SubscriptionPage,
    {
      planStatus,
      onBack: () => window.api.navigateTo("main"),
      onRenew: () => window.api.openPaymentBot(),
      subscriptionInfo: subInfo
    }
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(ErrorBoundary, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(SubscriptionApp, {}) })
);
