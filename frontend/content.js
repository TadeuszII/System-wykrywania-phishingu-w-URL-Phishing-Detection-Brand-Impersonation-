let guardyApiPromise;
let activePopup;
let activeToast;

const ALLOW_CACHE_MS = 5 * 60 * 1000;
const safeAllowUrls = new Map();

const SKIPPED_PROTOCOLS = new Set([
  "mailto:",
  "tel:",
  "javascript:",
  "chrome:",
  "chrome-extension:",
  "edge:",
  "about:",
  "file:"
]);

const DECISION_META = {
  ALLOW: {
    className: "decision-allow",
    title: "ALLOW",
    icon: `
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
      <path d="m8.5 12.5 2.2 2.2 4.8-5.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
    `
  },
  WARN: {
    className: "decision-warn",
    title: "WARN",
    icon: `
      <path d="M12 3.2 21.2 19H2.8L12 3.2Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2"></path>
      <path d="M12 8.5v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"></path>
      <path d="M12 16.8h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>
    `
  },
  BLOCK: {
    className: "decision-block",
    title: "BLOCK",
    icon: `
      <circle cx="12" cy="12" r="9" fill="currentColor"></circle>
      <path d="m8.8 8.8 6.4 6.4m0-6.4-6.4 6.4" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="2"></path>
    `
  }
};

const ICONS = {
  arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>',
  back: '<path d="M9 7 4 12l5 5m-5-5h11a5 5 0 0 1 0 10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>',
  clock: '<path d="M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>',
  externalLink: '<path d="M14 4h6v6m0-6-8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>',
  settings: '<path d="M4 7h10m3 0h3M7 17h13M4 17h1m6-13v6m3 4v6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path>'
};

function loadApi() {
  if (!guardyApiPromise) {
    guardyApiPromise = import(chrome.runtime.getURL("utils/api.js"));
  }

  return guardyApiPromise;
}

function findClickedLink(event) {
  return event.target?.closest?.("a[href]");
}

function isModifiedClick(event) {
  return event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function isLocalBackendUrl(url) {
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function isSamePageAnchor(url) {
  return (
    url.origin === window.location.origin &&
    url.pathname === window.location.pathname &&
    url.search === window.location.search &&
    Boolean(url.hash)
  );
}

function shouldSkipBeforeSettings(url) {
  if (SKIPPED_PROTOCOLS.has(url.protocol)) {
    return true;
  }

  return isLocalBackendUrl(url) || isSamePageAnchor(url);
}

function shouldSkipAfterSettings(url, settings) {
  if (settings.disabledDomains.includes(window.location.hostname)) {
    return true;
  }

  return settings.scanMode === "external" && url.hostname === window.location.hostname;
}

function followLink(link, url) {
  if (link.target && link.target !== "_self") {
    window.open(url.href, link.target, "noopener");
    return;
  }

  window.location.href = url.href;
}

function closePopup() {
  if (!activePopup) {
    return;
  }

  const popupToClose = activePopup;
  activePopup.popup.classList.remove("is-visible");
  window.setTimeout(() => {
    popupToClose.host.remove();
    if (activePopup === popupToClose) {
      activePopup = null;
    }
  }, 150);
}

function rememberAllowedUrl(url) {
  safeAllowUrls.set(url.href, Date.now());
}

function wasRecentlyAllowed(url) {
  const timestamp = safeAllowUrls.get(url.href);

  if (!timestamp) {
    return false;
  }

  if (Date.now() - timestamp > ALLOW_CACHE_MS) {
    safeAllowUrls.delete(url.href);
    return false;
  }

  safeAllowUrls.delete(url.href);
  return true;
}

function closeToast() {
  if (!activeToast) {
    return;
  }

  const toastToClose = activeToast;
  toastToClose.classList.remove("is-visible");
  window.setTimeout(() => {
    toastToClose.remove();
    if (activeToast === toastToClose) {
      activeToast = null;
    }
  }, 150);
}

function createPopupRoot(theme = "auto") {
  const host = document.createElement("div");
  host.id = "guardy-link-popup";
  if (theme !== "auto") {
    host.dataset.theme = theme;
  }
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light dark;
        --guardy-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Display", sans-serif;
        font-family: var(--guardy-font);
      }

      :host *,
      :host *::before,
      :host *::after {
        box-sizing: border-box;
        font-family: var(--guardy-font);
        letter-spacing: 0;
      }

      :host([data-theme="dark"]) {
        color-scheme: dark;
      }

      :host([data-theme="light"]) {
        color-scheme: light;
      }

      .guardy-popup {
        position: fixed;
        z-index: 2147483647;
        width: 280px;
        max-width: calc(100vw - 24px);
        padding: 16px;
        border: 1px solid rgba(210, 210, 215, 0.8);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        color: #1d1d1f;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 180ms ease, transform 180ms ease, border-color 180ms ease;
        backdrop-filter: blur(18px);
        box-sizing: border-box;
        overscroll-behavior: contain;
        scrollbar-width: thin;
      }

      .guardy-popup.has-vt {
        width: 560px;
      }

      .guardy-popup-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        padding-right: 0;
      }

      .guardy-brand-mark {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        color: #1d1d1f;
        font-size: 13px;
        font-weight: 700;
      }

      .guardy-brand-mark svg {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
        color: #0071e3;
      }

      .guardy-close {
        display: grid;
        width: 28px;
        height: 28px;
        flex: 0 0 auto;
        place-items: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #6e6e73;
        cursor: pointer;
        transition: background 150ms ease, color 150ms ease, transform 100ms ease;
      }

      .guardy-close:hover {
        background: rgba(0, 0, 0, 0.06);
        color: #1d1d1f;
      }

      .guardy-close:active {
        transform: scale(0.96);
      }

      .guardy-close svg {
        width: 16px;
        height: 16px;
      }

      .guardy-popup.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .guardy-result-grid {
        display: grid;
        gap: 16px;
      }

      .guardy-popup.has-vt .guardy-result-grid {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }

      .guardy-vt-panel {
        min-width: 0;
        padding-left: 16px;
        border-left: 1px solid rgba(210, 210, 215, 0.72);
      }

      .guardy-section-label {
        margin: 0 0 14px;
        color: #6e6e73;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .guardy-header,
      .guardy-row,
      .guardy-brand,
      .guardy-action {
        display: flex;
        align-items: center;
      }

      .guardy-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
      }

      .guardy-row {
        min-width: 0;
        gap: 10px;
      }

      .guardy-title {
        margin: 0;
        min-width: 0;
        overflow: hidden;
        font-size: 17px;
        font-weight: 650;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .guardy-score {
        color: #1d1d1f;
        font-size: 16px;
        font-weight: 650;
        white-space: nowrap;
      }

      .guardy-domain {
        margin: 12px 0 0;
        overflow: hidden;
        color: #6e6e73;
        font-size: 13px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .guardy-message,
      .guardy-reasons,
      .guardy-brand,
      .guardy-vt-copy {
        color: #6e6e73;
        font-size: 13px;
        line-height: 1.4;
      }

      .guardy-message {
        margin: 12px 0 0;
      }

      .guardy-divider {
        height: 1px;
        margin: 14px 0;
        background: rgba(210, 210, 215, 0.72);
      }

      .guardy-reasons {
        margin: 0;
        padding-left: 17px;
      }

      .guardy-reasons li + li {
        margin-top: 6px;
      }

      .guardy-brand {
        gap: 8px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(210, 210, 215, 0.72);
      }

      .guardy-vt-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
      }

      .guardy-vt-logo {
        display: grid;
        width: 28px;
        height: 28px;
        place-items: center;
        border-radius: 6px;
        background: #1d1d1f;
        color: #fff;
        font-size: 12px;
        font-weight: 800;
      }

      .guardy-vt-title {
        margin: 0;
        font-size: 17px;
        font-weight: 650;
        line-height: 1.2;
      }

      .guardy-vt-count {
        margin: 0 0 6px;
        color: #1d1d1f;
        font-size: 22px;
        font-weight: 700;
        line-height: 1.1;
      }

      .guardy-vt-copy {
        margin: 0 0 12px;
      }

      .guardy-vt-categories {
        margin: 0 0 14px;
      }

      .guardy-vt-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #1d1d1f;
        font-size: 13px;
        font-weight: 560;
        text-decoration: none;
      }

      .guardy-icon,
      .guardy-spinner,
      .guardy-brand-icon,
      .guardy-action-icon,
      .guardy-vt-link-icon {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
        color: #0071e3;
      }

      .guardy-spinner {
        animation: guardy-spin 900ms linear infinite;
      }

      .guardy-actions {
        display: grid;
        gap: 8px;
        margin-top: 16px;
      }

      .guardy-action {
        position: relative;
        min-height: 36px;
        justify-content: space-between;
        gap: 10px;
        overflow: hidden;
        padding: 8px 12px;
        border: 1px solid rgba(210, 210, 215, 0.9);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.78);
        color: #1d1d1f;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        font-weight: 560;
        line-height: 1.2;
        transition: opacity 150ms ease, transform 100ms ease, background 150ms ease;
      }

      .guardy-action:hover {
        opacity: 0.86;
      }

      .guardy-action:active {
        transform: scale(0.98);
      }

      .guardy-action:focus-visible {
        outline: 2px solid #0071e3;
        outline-offset: 2px;
      }

      .guardy-action.primary {
        border-color: #1d1d1f;
        background: #1d1d1f;
        color: #fff;
      }

      .guardy-action[disabled] {
        cursor: default;
        opacity: 0.62;
        transform: none;
      }

      .guardy-action-progress {
        position: absolute;
        inset: auto 0 0;
        width: 0%;
        height: 4px;
        background: currentColor;
        opacity: 0.32;
        transition: width 1s linear;
      }

      .decision-allow .guardy-icon,
      .decision-allow .guardy-score,
      .decision-allow .guardy-vt-title {
        color: #34c759;
      }

      .decision-warn .guardy-icon,
      .decision-warn .guardy-score,
      .decision-warn .guardy-vt-title {
        color: #ff9f0a;
      }

      .decision-block .guardy-icon,
      .decision-block .guardy-score,
      .decision-block .guardy-vt-title {
        color: #ff3b30;
      }

      .decision-block {
        border-color: rgba(255, 59, 48, 0.28);
      }

      .guardy-vt-note {
        margin: 12px 0 0;
        padding: 10px;
        border: 1px solid rgba(210, 210, 215, 0.78);
        border-radius: 8px;
        background: rgba(245, 245, 247, 0.86);
        color: #6e6e73;
        font-size: 13px;
        line-height: 1.35;
      }

      @keyframes guardy-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-color-scheme: dark) {
        .guardy-popup {
          border-color: rgba(56, 56, 58, 0.9);
          background: rgba(28, 28, 30, 0.94);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          color: #f5f5f7;
        }

        .guardy-score,
        .guardy-brand-mark,
        .guardy-action {
          color: #f5f5f7;
        }

        .guardy-domain,
        .guardy-message,
        .guardy-reasons,
        .guardy-brand,
        .guardy-vt-copy,
        .guardy-section-label {
          color: #98989d;
        }

        .guardy-divider,
        .guardy-brand,
        .guardy-vt-panel {
          border-color: rgba(56, 56, 58, 0.95);
        }

        .guardy-divider {
          background: rgba(56, 56, 58, 0.95);
        }

        .guardy-spinner,
        .guardy-icon,
        .guardy-brand-icon,
        .guardy-action-icon,
        .guardy-vt-link-icon {
          color: #0a84ff;
        }

        .guardy-vt-count,
        .guardy-vt-link {
          color: #f5f5f7;
        }

        .guardy-action {
          border-color: rgba(56, 56, 58, 0.95);
          background: rgba(44, 44, 46, 0.86);
        }

        .guardy-close {
          color: #98989d;
        }

        .guardy-close:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #f5f5f7;
        }

        .guardy-action.primary {
          border-color: #f5f5f7;
          background: #f5f5f7;
          color: #1d1d1f;
        }

        .decision-allow .guardy-icon,
        .decision-allow .guardy-score,
        .decision-allow .guardy-vt-title {
          color: #30d158;
        }

        .decision-block .guardy-icon,
        .decision-block .guardy-score,
        .decision-block .guardy-vt-title {
          color: #ff453a;
        }

        .guardy-vt-note {
          border-color: rgba(56, 56, 58, 0.95);
          background: rgba(44, 44, 46, 0.86);
          color: #98989d;
        }
      }

      :host([data-theme="dark"]) .guardy-popup {
        border-color: rgba(56, 56, 58, 0.9);
        background: rgba(28, 28, 30, 0.94);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        color: #f5f5f7;
      }

      :host([data-theme="dark"]) .guardy-score,
      :host([data-theme="dark"]) .guardy-brand-mark,
      :host([data-theme="dark"]) .guardy-action {
        color: #f5f5f7;
      }

      :host([data-theme="dark"]) .guardy-domain,
      :host([data-theme="dark"]) .guardy-message,
      :host([data-theme="dark"]) .guardy-reasons,
      :host([data-theme="dark"]) .guardy-brand,
      :host([data-theme="dark"]) .guardy-vt-copy,
      :host([data-theme="dark"]) .guardy-section-label {
        color: #98989d;
      }

      :host([data-theme="dark"]) .guardy-divider {
        background: rgba(56, 56, 58, 0.95);
      }

      :host([data-theme="dark"]) .guardy-brand,
      :host([data-theme="dark"]) .guardy-vt-panel,
      :host([data-theme="dark"]) .guardy-action {
        border-color: rgba(56, 56, 58, 0.95);
      }

      :host([data-theme="dark"]) .guardy-action {
        background: rgba(44, 44, 46, 0.86);
      }

      :host([data-theme="dark"]) .guardy-close {
        color: #98989d;
      }

      :host([data-theme="dark"]) .guardy-close:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #f5f5f7;
      }

      :host([data-theme="dark"]) .guardy-action.primary {
        border-color: #f5f5f7;
        background: #f5f5f7;
        color: #1d1d1f;
      }

      :host([data-theme="dark"]) .decision-allow .guardy-icon,
      :host([data-theme="dark"]) .decision-allow .guardy-score,
      :host([data-theme="dark"]) .decision-allow .guardy-vt-title {
        color: #30d158;
      }

      :host([data-theme="dark"]) .decision-block .guardy-icon,
      :host([data-theme="dark"]) .decision-block .guardy-score,
      :host([data-theme="dark"]) .decision-block .guardy-vt-title {
        color: #ff453a;
      }

      :host([data-theme="dark"]) .guardy-vt-note {
        border-color: rgba(56, 56, 58, 0.95);
        background: rgba(44, 44, 46, 0.86);
        color: #98989d;
      }

      :host([data-theme="light"]) .guardy-popup {
        border-color: rgba(210, 210, 215, 0.8);
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        color: #1d1d1f;
      }

      :host([data-theme="light"]) .guardy-score,
      :host([data-theme="light"]) .guardy-brand-mark,
      :host([data-theme="light"]) .guardy-action,
      :host([data-theme="light"]) .guardy-vt-count,
      :host([data-theme="light"]) .guardy-vt-link {
        color: #1d1d1f;
      }

      :host([data-theme="light"]) .guardy-domain,
      :host([data-theme="light"]) .guardy-message,
      :host([data-theme="light"]) .guardy-reasons,
      :host([data-theme="light"]) .guardy-brand,
      :host([data-theme="light"]) .guardy-vt-copy,
      :host([data-theme="light"]) .guardy-section-label {
        color: #6e6e73;
      }

      @media (max-width: 620px) {
        .guardy-popup.has-vt .guardy-result-grid {
          grid-template-columns: 1fr;
        }

        .guardy-vt-panel {
          padding-top: 16px;
          padding-left: 0;
          border-top: 1px solid rgba(210, 210, 215, 0.72);
          border-left: 0;
        }
      }
    </style>
    <section class="guardy-popup" role="dialog" aria-live="polite" aria-label="Guardy scan result">
      <div class="guardy-popup-top">
        <div class="guardy-brand-mark">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.2 19 6v5.6c0 4.4-2.9 7.5-7 9.2-4.1-1.7-7-4.8-7-9.2V6l7-2.8Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"></path>
          </svg>
          <span>Guardy</span>
        </div>
        <button class="guardy-close" type="button" aria-label="Zamknij">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m7 7 10 10m0-10L7 17" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path>
          </svg>
        </button>
      </div>
      <div class="guardy-result-grid">
        <div class="guardy-main-panel">
          <p class="guardy-section-label" hidden>Nasz wynik</p>
          <div class="guardy-header">
            <div class="guardy-row">
              <svg class="guardy-icon guardy-spinner" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity="0.25"></circle>
                <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"></path>
              </svg>
              <h2 class="guardy-title">Sprawdzam link...</h2>
            </div>
            <strong class="guardy-score"></strong>
          </div>
          <p class="guardy-domain"></p>
          <div class="guardy-divider"></div>
      <p class="guardy-message">Guardy wysyła URL do lokalnego backendu.</p>
          <ul class="guardy-reasons" hidden></ul>
          <div class="guardy-brand" hidden>
            <svg class="guardy-brand-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.8 12.7 12.7 4.8l6.5 6.5-7.9 7.9a2 2 0 0 1-2.8 0l-3.7-3.7a2 2 0 0 1 0-2.8Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"></path>
              <path d="M8.5 8.5h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>
            </svg>
            <span></span>
          </div>
        </div>
        <aside class="guardy-vt-panel" hidden></aside>
      </div>
      <div class="guardy-actions"></div>
    </section>
  `;

  document.documentElement.append(host);
  const popupApi = {
    host,
    shadow,
    popup: shadow.querySelector(".guardy-popup"),
    closeButton: shadow.querySelector(".guardy-close"),
    sectionLabel: shadow.querySelector(".guardy-section-label"),
    title: shadow.querySelector(".guardy-title"),
    score: shadow.querySelector(".guardy-score"),
    domain: shadow.querySelector(".guardy-domain"),
    message: shadow.querySelector(".guardy-message"),
    reasons: shadow.querySelector(".guardy-reasons"),
    brand: shadow.querySelector(".guardy-brand"),
    brandText: shadow.querySelector(".guardy-brand span"),
    vtPanel: shadow.querySelector(".guardy-vt-panel"),
    actions: shadow.querySelector(".guardy-actions"),
    icon: shadow.querySelector(".guardy-icon")
  };
  popupApi.closeButton.addEventListener("click", closePopup);
  return popupApi;
}

function positionPopup(popup, link) {
  const rect = link.getBoundingClientRect();
  const spacing = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(240, viewportWidth - (spacing * 2));
  const maxHeight = Math.max(180, viewportHeight - (spacing * 2));

  popup.style.maxWidth = `${maxWidth}px`;
  popup.style.maxHeight = `${maxHeight}px`;
  popup.style.overflowY = "auto";

  const measuredWidth = Math.min(popup.offsetWidth || 280, maxWidth);
  const measuredHeight = Math.min(popup.offsetHeight || 140, maxHeight);
  const preferredLeft = rect.left + (rect.width / 2) - (measuredWidth / 2);
  const left = Math.min(
    Math.max(preferredLeft, spacing),
    viewportWidth - measuredWidth - spacing
  );
  const belowTop = rect.bottom + spacing;
  const aboveTop = rect.top - measuredHeight - spacing;
  const hasRoomBelow = belowTop + measuredHeight <= viewportHeight - spacing;
  const hasRoomAbove = aboveTop >= spacing;
  let top;

  if (hasRoomBelow || !hasRoomAbove) {
    top = Math.min(belowTop, viewportHeight - measuredHeight - spacing);
  } else {
    top = aboveTop;
  }

  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(Math.max(spacing, top))}px`;
}

function showCheckingPopup(link, url, theme) {
  activePopup?.host.remove();
  activePopup = createPopupRoot(theme);
  activePopup.domain.textContent = url.hostname;
  requestAnimationFrame(() => {
    positionPopup(activePopup.popup, link);
    activePopup.popup.classList.add("is-visible");
  });
  return activePopup;
}

function showAllowToast(url, theme = "auto", message = "Link wygląda bezpiecznie") {
  closeToast();

  const toast = document.createElement("div");
  toast.id = "guardy-allow-toast";
  if (theme !== "auto") {
    toast.dataset.theme = theme;
  }
  toast.innerHTML = `
    <style>
      #guardy-allow-toast {
        all: initial;
        --guardy-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Display", sans-serif;
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: min(320px, calc(100vw - 36px));
        padding: 12px 14px;
        border: 1px solid rgba(52, 199, 89, 0.25);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
        color: #1d1d1f;
        font-family: var(--guardy-font);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 180ms ease, transform 180ms ease;
        backdrop-filter: blur(18px);
      }

      #guardy-allow-toast,
      #guardy-allow-toast * {
        box-sizing: border-box;
        font-family: var(--guardy-font);
        letter-spacing: 0;
      }

      #guardy-allow-toast.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      #guardy-allow-toast svg {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
        color: #34c759;
      }

      #guardy-allow-toast strong {
        display: block;
        margin: 0;
        font-size: 13px;
        line-height: 1.25;
      }

      #guardy-allow-toast span {
        display: block;
        overflow: hidden;
        color: #6e6e73;
        font-size: 12px;
        line-height: 1.3;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (prefers-color-scheme: dark) {
        #guardy-allow-toast {
          border-color: rgba(48, 209, 88, 0.35);
          background: rgba(28, 28, 30, 0.94);
          color: #f5f5f7;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
        }

        #guardy-allow-toast svg {
          color: #30d158;
        }

        #guardy-allow-toast span {
          color: #98989d;
        }
      }

      #guardy-allow-toast[data-theme="light"] {
        border-color: rgba(52, 199, 89, 0.25);
        background: rgba(255, 255, 255, 0.94);
        color: #1d1d1f;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
      }

      #guardy-allow-toast[data-theme="dark"] {
        border-color: rgba(48, 209, 88, 0.35);
        background: rgba(28, 28, 30, 0.94);
        color: #f5f5f7;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
      }
    </style>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
      <path d="m8.5 12.5 2.2 2.2 4.8-5.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>
    </svg>
    <div>
      <strong></strong>
      <span></span>
    </div>
  `;
  toast.querySelector("strong").textContent = message;
  toast.querySelector("span").textContent = url.hostname;

  document.documentElement.append(toast);
  activeToast = toast;
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  window.setTimeout(closeToast, 2600);
}

function clearActions(popup) {
  popup.actions.replaceChildren();
}

function createAction(label, iconPath, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `guardy-action${options.primary ? " primary" : ""}`;
  button.innerHTML = `
    <span></span>
    <svg class="guardy-action-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPath}</svg>
  `;
  button.querySelector("span").textContent = label;

  if (options.disabled) {
    button.disabled = true;
  }

  if (options.onClick) {
    button.addEventListener("click", options.onClick);
  }

  return button;
}

function renderReasons(popup, reasons) {
  popup.reasons.replaceChildren();
  const visibleReasons = Array.isArray(reasons) && reasons.length > 0
    ? reasons.slice(0, 4)
    : ["Brak dodatkowych powodów w odpowiedzi backendu"];

  visibleReasons.forEach((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    popup.reasons.append(item);
  });

  popup.reasons.hidden = false;
  popup.message.hidden = true;
}

function renderBrand(popup, matchedBrand) {
  if (!matchedBrand) {
    popup.brand.hidden = true;
    return;
  }

  popup.brandText.textContent = `Podobieństwo do: ${matchedBrand}`;
  popup.brand.hidden = false;
}

function openSettingsPage() {
  window.open(chrome.runtime.getURL("settings.html"), "_blank", "noopener");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function showVirusTotalPanel(popup, state, vtResult = null) {
  popup.popup.classList.add("has-vt");
  popup.sectionLabel.hidden = false;
  popup.vtPanel.hidden = false;

  if (state === "missing-key") {
    popup.vtPanel.innerHTML = `
      <p class="guardy-section-label">VirusTotal</p>
      <div class="guardy-vt-header">
        <span class="guardy-vt-logo">VT</span>
        <h3 class="guardy-vt-title">Brak klucza API</h3>
      </div>
      <p class="guardy-vt-copy">Dodaj 64-znakowy klucz VirusTotal w ustawieniach, żeby porównać wynik.</p>
      <button type="button" class="guardy-action">
        <span>Otwórz ustawienia</span>
        <svg class="guardy-action-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS.settings}</svg>
      </button>
    `;
    popup.vtPanel.querySelector("button").addEventListener("click", openSettingsPage);
    return;
  }

  if (state === "loading") {
    popup.vtPanel.innerHTML = `
      <p class="guardy-section-label">VirusTotal</p>
      <div class="guardy-vt-header">
        <svg class="guardy-icon guardy-spinner" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity="0.25"></circle>
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"></path>
        </svg>
        <h3 class="guardy-vt-title">Sprawdzam VT...</h3>
      </div>
      <p class="guardy-vt-copy">Wynik VirusTotal jest informacyjny i nie zmienia decyzji Guardy.</p>
    `;
    return;
  }

  if (state === "error") {
    popup.vtPanel.innerHTML = `
      <p class="guardy-section-label">VirusTotal</p>
      <div class="guardy-vt-header">
        <span class="guardy-vt-logo">VT</span>
        <h3 class="guardy-vt-title">Blad porownania</h3>
      </div>
      <p class="guardy-vt-copy">Nie udało się pobrać wyniku VirusTotal. Sprawdź klucz API i backend.</p>
    `;
    return;
  }

  const decision = DECISION_META[vtResult.vt_decision] || DECISION_META.WARN;
  const categories = Array.isArray(vtResult.vt_categories) && vtResult.vt_categories.length > 0
    ? vtResult.vt_categories.map(escapeHtml).join(", ")
    : "brak";
  const permalink = safeExternalUrl(vtResult.vt_permalink);

  popup.vtPanel.innerHTML = `
    <p class="guardy-section-label">VirusTotal</p>
    <div class="guardy-vt-header ${decision.className}">
      <span class="guardy-vt-logo">VT</span>
      <h3 class="guardy-vt-title">${decision.title}</h3>
    </div>
    <p class="guardy-vt-count">${Number(vtResult.engines_flagged) || 0} / ${Number(vtResult.engines_total) || 0}</p>
    <p class="guardy-vt-copy">silników zgłosiło zagrożenie</p>
    <p class="guardy-vt-copy guardy-vt-categories">Kategorie: ${categories}</p>
    ${permalink ? `
      <a class="guardy-vt-link" href="${permalink}" target="_blank" rel="noopener noreferrer">
        <span>Link do raportu</span>
        <svg class="guardy-vt-link-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS.externalLink}</svg>
      </a>
    ` : ""}
    <p class="guardy-vt-note">Porównanie z VT nie zmienia wyniku Guardy.</p>
  `;
}

function schedulePopupPosition(popup, link) {
  requestAnimationFrame(() => {
    positionPopup(popup.popup, link);
    requestAnimationFrame(() => positionPopup(popup.popup, link));
  });
}

function createVirusTotalAction(popup, url, link) {
  return createAction("Porównaj z VirusTotal", ICONS.externalLink, {
    onClick: async () => {
      const api = await loadApi();
      const settings = await api.getSettings();
      await runVirusTotalForPopup(api, popup, url, link, settings);
    }
  });
}

async function runVirusTotalForPopup(api, popup, url, link, settings) {
  popup.popup.classList.add("has-vt");
  schedulePopupPosition(popup, link);

  if (!settings.vtKey) {
    showVirusTotalPanel(popup, "missing-key");
    schedulePopupPosition(popup, link);
    return;
  }

  showVirusTotalPanel(popup, "loading");
  schedulePopupPosition(popup, link);

  try {
    const vtResult = await api.scanVT(url.href, settings.vtKey);
    showVirusTotalPanel(popup, "result", vtResult);
  } catch (error) {
    showVirusTotalPanel(popup, "error");
  }

  schedulePopupPosition(popup, link);
}

async function runVirusTotalForToast(api, url, settings) {
  if (!settings.alwaysScanVirusTotal || !settings.vtKey) {
    return;
  }

  try {
    const vtResult = await api.scanVT(url.href, settings.vtKey);
    showAllowToast(url, settings.theme, `Guardy: ALLOW, VT: ${vtResult.vt_decision || "OK"}`);
  } catch (error) {
    showAllowToast(url, settings.theme, "Link wygląda bezpiecznie");
  }
}

function renderAllowActions(popup, link, url) {
  popup.actions.append(
    createAction("Otwórz link", ICONS.arrowRight, {
      primary: true,
      onClick: () => followLink(link, url)
    }),
    createAction("Wróć", ICONS.back, {
      onClick: closePopup
    }),
    createVirusTotalAction(popup, url, link)
  );
}

function renderWarnActions(popup, link, url) {
  popup.actions.append(
    createAction("Przejdź mimo to", ICONS.arrowRight, {
      primary: true,
      onClick: () => followLink(link, url)
    }),
    createAction("Wróć", ICONS.back, {
      onClick: closePopup
    }),
    createVirusTotalAction(popup, url, link)
  );
}

function renderBlockActions(popup, link, url) {
  const riskyButton = createAction("Rozumiem ryzyko (3s)", ICONS.clock, {
    disabled: true,
    onClick: () => followLink(link, url)
  });
  const progress = document.createElement("span");
  progress.className = "guardy-action-progress";
  riskyButton.append(progress);

  popup.actions.append(
    riskyButton,
    createAction("Wróć", ICONS.back, {
      onClick: closePopup
    }),
    createVirusTotalAction(popup, url, link)
  );

  let secondsLeft = 3;
  const label = riskyButton.querySelector("span");
  const timer = window.setInterval(() => {
    secondsLeft -= 1;
    label.textContent = secondsLeft > 0 ? `Rozumiem ryzyko (${secondsLeft}s)` : "Rozumiem ryzyko";
    progress.style.width = `${((3 - secondsLeft) / 3) * 100}%`;

    if (secondsLeft <= 0) {
      window.clearInterval(timer);
      riskyButton.disabled = false;
      riskyButton.classList.add("primary");
    }
  }, 1000);

  requestAnimationFrame(() => {
    progress.style.width = "33%";
  });
}

function setPopupDone(popup, result, link, url) {
  const decision = DECISION_META[result.decision] || DECISION_META.WARN;

  popup.popup.classList.remove("decision-allow", "decision-warn", "decision-block");
  popup.popup.classList.add(decision.className);
  popup.icon.classList.remove("guardy-spinner");
  popup.icon.innerHTML = decision.icon;
  popup.title.textContent = decision.title;
  popup.score.textContent = `${Number(result.risk_score) || 0}/100`;

  renderReasons(popup, result.reasons);
  renderBrand(popup, result.matched_brand);
  clearActions(popup);

  if (result.decision === "ALLOW") {
    renderAllowActions(popup, link, url);
  } else if (result.decision === "BLOCK") {
    renderBlockActions(popup, link, url);
  } else {
    renderWarnActions(popup, link, url);
  }
}

function setPopupError(popup, error) {
  popup.popup.classList.add("decision-block");
  popup.icon.classList.remove("guardy-spinner");
  popup.icon.innerHTML = DECISION_META.BLOCK.icon;
  popup.title.textContent = "Błąd skanowania";
  popup.score.textContent = "";
  popup.message.hidden = false;
  popup.message.textContent = error.message || "Backend nie zwrócił poprawnej odpowiedzi.";
  popup.reasons.hidden = true;
  popup.brand.hidden = true;
  clearActions(popup);
  popup.actions.append(
    createAction("Wróć", ICONS.back, {
      onClick: closePopup
    })
  );
}

async function handleLinkClick(event) {
  if (isModifiedClick(event)) {
    return;
  }

  const link = findClickedLink(event);
  if (!link) {
    return;
  }

  const url = new URL(link.href, window.location.href);
  if (shouldSkipBeforeSettings(url)) {
    return;
  }

  if (wasRecentlyAllowed(url)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const api = await loadApi();
  const settings = await api.getSettings();

  if (shouldSkipAfterSettings(url, settings)) {
    followLink(link, url);
    return;
  }

  try {
    const result = await api.scanUrl(url.href);
    await api.saveToHistory({
      ...result,
      url: url.href,
      source: "clicked_link"
    });

    if (result.decision === "ALLOW") {
      rememberAllowedUrl(url);
      showAllowToast(url, settings.theme);
      runVirusTotalForToast(api, url, settings);
      return;
    }

    const popup = showCheckingPopup(link, url, settings.theme);
    setPopupDone(popup, result, link, url);
    if (settings.alwaysScanVirusTotal) {
      runVirusTotalForPopup(api, popup, url, link, settings);
    }
  } catch (error) {
    followLink(link, url);
  }
}

document.addEventListener("click", (event) => {
  handleLinkClick(event);
}, true);

document.addEventListener("pointerdown", (event) => {
  if (!activePopup || activePopup.host.contains(event.target)) {
    return;
  }

  closePopup();
}, true);
