window.__ModuleLoader__.load({
  id: "@tokens/dsh-version-updates",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/styles.ts
var STYLES = `
.tokensVersionUpdateRoot { width: 100%; min-width: 0; }
.tokensVersionUpdateButton {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.tokensVersionUpdateButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.tokensVersionUpdateButton:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.tokensVersionUpdateButton:disabled { cursor: default; opacity: 1; }
.tokensVersionUpdateWide .tokensVersionUpdateButton {
  gap: 3px;
  width: calc(100% + 8px);
  height: 34px;
  margin: 0 -4px;
  padding: 4px 2px 4px 5px;
  box-sizing: border-box;
  border-radius: 12px;
  overflow: hidden;
}
.tokensVersionUpdateIcon {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.tokensVersionUpdateButton[data-downloading] .tokensVersionUpdateIcon {
  background: conic-gradient(
    var(--dsw-alias-state-business-primary) var(--tokens-update-progress),
    var(--dsw-alias-border-l2) var(--tokens-update-progress)
  );
}
.tokensVersionUpdateButton[data-downloading] .tokensVersionUpdateIcon::before {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--dsw-specific-sidebar-fill);
}
.tokensVersionUpdateIcon > svg { position: relative; z-index: 1; }
.tokensVersionUpdateButton[data-downloading] .tokensVersionUpdateIcon > svg {
  color: var(--dsw-alias-state-business-primary);
}
.tokensVersionUpdateIndeterminate { animation: tokens-version-update-spin 900ms linear infinite; }
.tokensVersionUpdateLabel {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tokensVersionUpdateTrack {
  position: absolute;
  right: 2px;
  bottom: 0;
  left: 5px;
  height: 2px;
  overflow: hidden;
  border-radius: 1px;
  background: var(--dsw-alias-border-l2);
}
.tokensVersionUpdateTrack > span {
  display: block;
  height: 100%;
  background: var(--dsw-alias-state-business-primary);
  transition: width 180ms linear;
}
@keyframes tokens-version-update-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .tokensVersionUpdateIndeterminate { animation: none; }
  .tokensVersionUpdateTrack > span { transition: none; }
}
`;
function installStyles() {
  const style = document.createElement("style");
  style.dataset.pluginCss = "@tokens/dsh-version-updates/sidebar-action";
  style.textContent = STYLES;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}

// src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var UPDATE_RPC_CHANNEL = "/tokens-version-updates";
var IDLE_POLL_MS = 2e3;
var ACTIVE_POLL_MS = 250;
function percentage(status) {
  if (status.totalBytes <= 0) return void 0;
  return Math.max(0, Math.min(100, Math.floor(status.downloadedBytes / status.totalBytes * 100)));
}
function chineseUI() {
  const language = document.documentElement.lang || navigator.language;
  return language.toLowerCase().startsWith("zh");
}
function UpdateAction({ wide, readStatus, download }) {
  const [status, setStatus] = (0, import_react.useState)(null);
  const [starting, setStarting] = (0, import_react.useState)(false);
  const refresh = (0, import_react.useCallback)(async () => {
    try {
      const next = await readStatus();
      setStatus(next);
      return next;
    } catch {
      setStatus(null);
      return null;
    }
  }, [readStatus]);
  (0, import_react.useEffect)(() => {
    let live = true;
    let timer;
    const poll = async () => {
      const next = await refresh();
      if (!live) return;
      timer = window.setTimeout(
        () => {
          void poll();
        },
        next?.phase === "downloading" ? ACTIVE_POLL_MS : IDLE_POLL_MS
      );
    };
    void poll();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [refresh]);
  if (status === null || status.phase === "idle" || status.phase === "checking") return null;
  const zh = chineseUI();
  const downloading = status.phase === "downloading";
  const progress = downloading ? percentage(status) : void 0;
  const availableLabel = zh ? `\u4E0B\u8F7D ${status.version}` : `Download ${status.version}`;
  const progressLabel = zh ? `\u6B63\u5728\u4E0B\u8F7D ${progress === void 0 ? "" : `${progress}%`}`.trim() : `Downloading ${progress === void 0 ? "" : `${progress}%`}`.trim();
  const label = downloading ? progressLabel : availableLabel;
  const tooltip = `${label} \xB7 ${status.productName}`;
  const ringStyle = {
    "--tokens-update-progress": `${progress ?? 0}%`
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `tokensVersionUpdateRoot${wide ? " tokensVersionUpdateWide" : ""}`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: tooltip, side: "right", delayMs: 400, disabled: wide, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: "tokensVersionUpdateButton",
      "aria-label": tooltip,
      "aria-live": "polite",
      disabled: downloading || starting,
      "data-downloading": downloading || void 0,
      onClick: () => {
        if (downloading || starting) return;
        setStarting(true);
        void download().catch(() => false).finally(() => {
          setStarting(false);
          void refresh();
        });
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            className: `tokensVersionUpdateIcon${progress === void 0 && downloading ? " tokensVersionUpdateIndeterminate" : ""}`,
            style: ringStyle,
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconDownloadOutline16, { size: wide ? 16 : 18 })
          }
        ),
        wide && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tokensVersionUpdateLabel", children: starting && !downloading ? progressLabel : label }),
        wide && downloading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tokensVersionUpdateTrack", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: `${progress ?? 12}%` } }) })
      ]
    }
  ) }) });
}
var inject = ["slots", "connection"];
function apply(ctx) {
  ctx.effect(installStyles, "tokens-version-updates: sidebar styles");
  const connection = ctx.get("connection");
  const call = async (endpoint) => {
    const result = await connection.rpc.call(UPDATE_RPC_CHANNEL, endpoint, {});
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "tokens-version-updates",
    order: 10,
    inject: () => ({
      readStatus: () => call("status"),
      download: async () => (await call("download")).started
    })
  }, UpdateAction));
}

    return module.exports;
  }
});
