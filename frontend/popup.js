import { getHealth, getSettings, saveSettings } from "./utils/api.js";

const elements = {
  backendUrl: document.querySelector("#backendUrl"),
  currentDomain: document.querySelector("#currentDomain"),
  domainToggle: document.querySelector("#domainToggle"),
  healthDetails: document.querySelector("#healthDetails"),
  healthStatus: document.querySelector("#healthStatus"),
  lastDecision: document.querySelector("#lastDecision"),
  lastDecisionIcon: document.querySelector("#lastDecisionIcon"),
  lastScanCard: document.querySelector("#lastScanCard"),
  lastScanMeta: document.querySelector("#lastScanMeta"),
  lastScore: document.querySelector("#lastScore"),
  openSettings: document.querySelector("#openSettings"),
  settingsLink: document.querySelector("#settingsLink"),
  toggleHint: document.querySelector("#toggleHint")
};

let settings;
let currentDomain = "";

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "auto" ? "" : theme;
}

function getDecisionIcon(decision) {
  if (decision === "ALLOW") {
    return `
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
      <path d="m8.5 12.5 2.2 2.2 4.8-5.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>
    `;
  }

  if (decision === "WARN") {
    return `
      <path d="M12 3.2 21.2 19H2.8L12 3.2Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"></path>
      <path d="M12 8.5v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path>
      <path d="M12 16.7h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.8"></path>
    `;
  }

  if (decision === "BLOCK") {
    return `
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
      <path d="m8.8 8.8 6.4 6.4m0-6.4-6.4 6.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path>
    `;
  }

  return '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle>';
}

function formatTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getHostname(value) {
  try {
    return new URL(value).hostname;
  } catch (error) {
    return "";
  }
}

async function getActiveDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);

  if (!tab?.url) {
    return "";
  }

  try {
    const url = new URL(tab.url);
    return ["http:", "https:"].includes(url.protocol) ? url.hostname : "";
  } catch (error) {
    return "";
  }
}

function setHealthStatus(status, label) {
  elements.healthStatus.classList.remove("is-loading", "is-online", "is-offline");
  elements.healthStatus.classList.add(status);
  elements.healthStatus.querySelector("span:last-child").textContent = label;
}

async function renderHealth() {
  elements.backendUrl.textContent = `Backend: ${settings.backendUrl}`;

  try {
    const health = await getHealth();
    setHealthStatus("is-online", "Online");
    elements.healthDetails.textContent = `ML: ${health.ml_status || "unknown"}; marki: ${health.brands_count ?? 0}`;
  } catch (error) {
    setHealthStatus("is-offline", "Offline");
    elements.healthDetails.textContent = "Backend nie odpowiada. Sprawdź Docker i port 8000.";
  }
}

async function renderLastScan() {
  const { lastScan = null } = await chrome.storage.local.get("lastScan");

  elements.lastScanCard.classList.remove("decision-allow", "decision-warn", "decision-block");

  if (!lastScan) {
    elements.lastDecision.textContent = "Brak skanów";
    elements.lastScanMeta.textContent = "Kliknij link na stronie, aby zapisać wynik.";
    elements.lastScore.textContent = "--/100";
    elements.lastDecisionIcon.innerHTML = getDecisionIcon();
    return;
  }

  const decision = lastScan.decision || "WARN";
  elements.lastScanCard.classList.add(`decision-${decision.toLowerCase()}`);
  elements.lastDecision.textContent = decision;
  elements.lastScore.textContent = `${Number(lastScan.risk_score) || 0}/100`;
  elements.lastDecisionIcon.innerHTML = getDecisionIcon(decision);

  const domain = getHostname(lastScan.url) || "ostatni link";
  const time = formatTime(lastScan.saved_at || lastScan.timestamp);
  elements.lastScanMeta.textContent = time ? `${domain}; dziś, ${time}` : domain;
}

function renderDomainToggle() {
  if (!currentDomain) {
    elements.currentDomain.textContent = "Nie wykryto domeny";
    elements.domainToggle.disabled = true;
    elements.domainToggle.setAttribute("aria-checked", "false");
    elements.toggleHint.textContent = "Otwórz stronę http/https, aby ustawić domenę.";
    return;
  }

  const isDisabled = settings.disabledDomains.includes(currentDomain);
  elements.currentDomain.textContent = currentDomain;
  elements.domainToggle.disabled = false;
  elements.domainToggle.setAttribute("aria-checked", String(!isDisabled));
  elements.toggleHint.textContent = isDisabled ? "Skanowanie jest wyłączone." : "Skanowanie jest włączone.";
}

async function toggleCurrentDomain() {
  if (!currentDomain) {
    return;
  }

  const disabledDomains = new Set(settings.disabledDomains);

  if (disabledDomains.has(currentDomain)) {
    disabledDomains.delete(currentDomain);
  } else {
    disabledDomains.add(currentDomain);
  }

  settings = await saveSettings({
    disabledDomains: Array.from(disabledDomains)
  });
  renderDomainToggle();
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

async function initPopup() {
  settings = await getSettings();
  setTheme(settings.theme);
  currentDomain = await getActiveDomain();

  renderDomainToggle();
  await Promise.all([
    renderHealth(),
    renderLastScan()
  ]);
}

elements.domainToggle.addEventListener("click", toggleCurrentDomain);
elements.openSettings.addEventListener("click", openSettings);
elements.settingsLink.addEventListener("click", openSettings);

initPopup().catch(() => {
  setHealthStatus("is-offline", "Offline");
  elements.healthDetails.textContent = "Popup nie mógł pobrać danych rozszerzenia.";
});
