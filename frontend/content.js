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
      }

      .guardy-popup.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .guardy-header,
      .guardy-row,
      .guardy-brand,
      .guardy-action {
        display: flex;
        align-items: center;
      }

      .guardy-header {
        justify-content: space-between;
        gap: 12px;
      }

      .guardy-row {
        min-width: 0;
        gap: 10px;
      }

      .guardy-title {
        margin: 0;
        font-size: 17px;
        font-weight: 650;
        line-height: 1.2;
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
      .guardy-brand {
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

      .guardy-icon,
      .guardy-spinner,
      .guardy-brand-icon,
      .guardy-action-icon {
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
      .decision-allow .guardy-score {
        color: #34c759;
      }

      .decision-warn .guardy-icon,
      .decision-warn .guardy-score {
        color: #ff9f0a;
      }

      .decision-block .guardy-icon,
      .decision-block .guardy-score {
        color: #ff3b30;
      }

      .decision-block {
        border-color: rgba(255, 59, 48, 0.28);
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
        .guardy-action {
          color: #f5f5f7;
        }

        .guardy-domain,
        .guardy-message,
        .guardy-reasons,
        .guardy-brand {
          color: #98989d;
        }

        .guardy-divider,
        .guardy-brand {
          border-color: rgba(56, 56, 58, 0.95);
        }

        .guardy-divider {
          background: rgba(56, 56, 58, 0.95);
        }

        .guardy-spinner,
        .guardy-icon,
        .guardy-brand-icon,
        .guardy-action-icon {
          color: #0a84ff;
        }

        .guardy-action {
          border-color: rgba(56, 56, 58, 0.95);
          background: rgba(44, 44, 46, 0.86);
        }

        .guardy-action.primary {
          border-color: #f5f5f7;
          background: #f5f5f7;
          color: #1d1d1f;
        }

        .decision-allow .guardy-icon,
        .decision-allow .guardy-score {
          color: #30d158;
        }

        .decision-block .guardy-icon,
        .decision-block .guardy-score {
          color: #ff453a;
        }
      }
    </style>
    <section class="guardy-popup" role="dialog" aria-live="polite" aria-label="Guardy scan result">
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
      <p class="guardy-message">Guardy wysyla URL do lokalnego backendu.</p>
      <ul class="guardy-reasons" hidden></ul>
      <div class="guardy-brand" hidden>
        <svg class="guardy-brand-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.8 12.7 12.7 4.8l6.5 6.5-7.9 7.9a2 2 0 0 1-2.8 0l-3.7-3.7a2 2 0 0 1 0-2.8Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"></path>
          <path d="M8.5 8.5h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>
        </svg>
        <span></span>
      </div>
      <div class="guardy-actions"></div>
    </section>
  `;

  document.documentElement.append(host);
  return {
    host,
    shadow,
    popup: shadow.querySelector(".guardy-popup"),
    title: shadow.querySelector(".guardy-title"),
    score: shadow.querySelector(".guardy-score"),
    domain: shadow.querySelector(".guardy-domain"),
    message: shadow.querySelector(".guardy-message"),
    reasons: shadow.querySelector(".guardy-reasons"),
    brand: shadow.querySelector(".guardy-brand"),
    brandText: shadow.querySelector(".guardy-brand span"),
    actions: shadow.querySelector(".guardy-actions"),
    icon: shadow.querySelector(".guardy-icon")
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
    : ["Brak dodatkowych powodow w odpowiedzi backendu"];

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

  popup.brandText.textContent = `Podobienstwo do: ${matchedBrand}`;
  popup.brand.hidden = false;
}

function renderAllowActions(popup, link, url) {
  popup.actions.append(
    createAction("Otwórz link", '<path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>', {
      primary: true,
      onClick: () => followLink(link, url)
    }),
    createAction("Wróć", '<path d="M9 7 4 12l5 5m-5-5h11a5 5 0 0 1 0 10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>', {
      onClick: closePopup
    })
  );
}

function renderWarnActions(popup, link, url) {
  popup.actions.append(
    createAction("Przejdź mimo to", '<path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>', {
      primary: true,
      onClick: () => followLink(link, url)
    }),
    createAction("Wróć", '<path d="M9 7 4 12l5 5m-5-5h11a5 5 0 0 1 0 10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>', {
      onClick: closePopup
    })
  );
}

function renderBlockActions(popup, link, url) {
  const riskyButton = createAction("Rozumiem ryzyko (3s)", '<path d="M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>', {
    disabled: true,
    onClick: () => followLink(link, url)
  });
  const progress = document.createElement("span");
  progress.className = "guardy-action-progress";
  riskyButton.append(progress);

  popup.actions.append(
    riskyButton,
    createAction("Wróć", '<path d="M9 7 4 12l5 5m-5-5h11a5 5 0 0 1 0 10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>', {
      onClick: closePopup
    })
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
  popup.title.textContent = "Blad skanowania";
  popup.score.textContent = "";
  popup.message.hidden = false;
  popup.message.textContent = error.message || "Backend nie zwrocil poprawnej odpowiedzi.";
  popup.reasons.hidden = true;
  popup.brand.hidden = true;
  clearActions(popup);
  popup.actions.append(
    createAction("Wróć", '<path d="M9 7 4 12l5 5m-5-5h11a5 5 0 0 1 0 10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>', {
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
    setPopupDone(popup, result, link, url);
  } catch (error) {
    setPopupError(popup, error);
  }
}

document.addEventListener("click", (event) => {
  handleLinkClick(event);
}, true);
