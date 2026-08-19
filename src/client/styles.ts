const STYLES = `
.tokensVersionUpdateRoot { width: 100%; min-width: 0; }
.tokensVersionUpdateButton {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
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
  width: 100%;
  padding: 0 10px;
  border-radius: 8px;
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
  line-height: 20px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tokensVersionUpdateTrack {
  position: absolute;
  right: 10px;
  bottom: 2px;
  left: 10px;
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
`

/** Install the small sidebar action stylesheet for this client plugin. */
export function installStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.pluginCss = '@tokens/dsh-version-updates/sidebar-action'
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}
