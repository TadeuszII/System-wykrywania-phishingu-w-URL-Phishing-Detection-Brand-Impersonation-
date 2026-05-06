let guardyApiPromise;
let activePopup;

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

function createPopupRoot() {
  const host = document.createElement("div");
  host.id = "guardy-link-popup";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .guardy-popup {
        position: fixed;
        z-index: 2147483647;
        width: 280px;
        padding: 14px;
        border: 1px solid rgba(210, 210, 215, 0.8);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        color: #1d1d1f;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 180ms ease, transform 180ms ease;
        backdrop-filter: blur(18px);
        box-sizing: border-box;
      }

      .guardy-popup.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .guardy-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .guardy-title {
        margin: 0;
        font-size: 15px;
        font-weight: 650;
        line-height: 1.25;
      }

      .guardy-domain {
        margin: 8px 0 0;
        overflow: hidden;
        color: #6e6e73;
        font-size: 13px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .guardy-message {
        margin: 10px 0 0;
        color: #6e6e73;
        font-size: 13px;
        line-height: 1.35;
      }

      .guardy-spinner {
        width: 18px;
        height: 18px;
        animation: guardy-spin 900ms linear infinite;
        color: #0071e3;
        flex: 0 0 auto;
      }

      .guardy-error .guardy-spinner,
      .guardy-done .guardy-spinner {
        animation: none;
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

        .guardy-domain,
        .guardy-message {
          color: #98989d;
        }

        .guardy-spinner {
          color: #0a84ff;
        }
      }
    </style>
    <section class="guardy-popup" role="status" aria-live="polite">
      <div class="guardy-row">
        <svg class="guardy-spinner" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity="0.25"></circle>
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"></path>
        </svg>
        <h2 class="guardy-title">Sprawdzam link...</h2>
      </div>
      <p class="guardy-domain"></p>
      <p class="guardy-message">Guardy wysyla URL do lokalnego backendu.</p>
    </section>
  `;

  document.documentElement.append(host);
  return {
    host,
    popup: shadow.querySelector(".guardy-popup"),
    title: shadow.querySelector(".guardy-title"),
    domain: shadow.querySelector(".guardy-domain"),
    message: shadow.querySelector(".guardy-message"),
    icon: shadow.querySelector(".guardy-spinner")
  };
}

function positionPopup(popup, link) {
  const rect = link.getBoundingClientRect();
  const spacing = 12;
  const left = Math.min(Math.max(rect.left, spacing), window.innerWidth - 292);
  const top = Math.min(rect.bottom + spacing, window.innerHeight - 140);

  popup.style.left = `${left}px`;
  popup.style.top = `${Math.max(spacing, top)}px`;
}

function showCheckingPopup(link, url) {
  activePopup?.host.remove();
  activePopup = createPopupRoot();
  activePopup.domain.textContent = url.hostname;
  positionPopup(activePopup.popup, link);
  requestAnimationFrame(() => activePopup.popup.classList.add("is-visible"));
  return activePopup;
}

function setPopupDone(popup, result) {
  popup.popup.classList.add("guardy-done");
  popup.title.textContent = `Wynik gotowy: ${result.decision}`;
  popup.message.textContent = `Score ${result.risk_score}/100. Pelne akcje pojawia sie w kolejnym kroku.`;
  popup.icon.innerHTML = `
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
    <path d="m8.5 12.5 2.2 2.2 4.8-5.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
  `;
}

function setPopupError(popup, error) {
  popup.popup.classList.add("guardy-error");
  popup.title.textContent = "Nie udalo sie sprawdzic linku";
  popup.message.textContent = error.message || "Backend nie zwrocil poprawnej odpowiedzi.";
  popup.icon.innerHTML = `
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
    <path d="m9 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"></path>
  `;
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

  event.preventDefault();
  event.stopPropagation();

  const api = await loadApi();
  const settings = await api.getSettings();

  if (shouldSkipAfterSettings(url, settings)) {
    followLink(link, url);
    return;
  }

  const popup = showCheckingPopup(link, url);

  try {
    const result = await api.scanUrl(url.href);
    await api.saveToHistory({
      ...result,
      url: url.href,
      source: "clicked_link"
    });
    setPopupDone(popup, result);
  } catch (error) {
    setPopupError(popup, error);
  }
}

document.addEventListener("click", (event) => {
  handleLinkClick(event);
}, true);
