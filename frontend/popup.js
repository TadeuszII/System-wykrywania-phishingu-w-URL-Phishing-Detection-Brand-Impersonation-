import { getHealth, getSettings, saveSettings, saveToHistory, scanUrl, scanVT } from "./utils/api.js";

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
  manualDecision: document.querySelector("#manualDecision"),
  manualDecisionIcon: document.querySelector("#manualDecisionIcon"),
  manualResult: document.querySelector("#manualResult"),
  manualResultMeta: document.querySelector("#manualResultMeta"),
  manualScanButton: document.querySelector("#manualScanButton"),
  manualScanForm: document.querySelector("#manualScanForm"),
  manualScanMessage: document.querySelector("#manualScanMessage"),
  manualScore: document.querySelector("#manualScore"),
  manualUrl: document.querySelector("#manualUrl"),
  manualVtButton: document.querySelector("#manualVtButton"),
  manualVtCategories: document.querySelector("#manualVtCategories"),
  manualVtDecision: document.querySelector("#manualVtDecision"),
  manualVtLink: document.querySelector("#manualVtLink"),
  manualVtMessage: document.querySelector("#manualVtMessage"),
  manualVtResult: document.querySelector("#manualVtResult"),
  manualVtStats: document.querySelector("#manualVtStats"),
  openSettings: document.querySelector("#openSettings"),
  settingsLink: document.querySelector("#settingsLink"),
  toggleHint: document.querySelector("#toggleHint")
};

let settings;
let currentDomain = "";
let lastManualUrl = "";

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

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
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

function normalizeManualUrl(value) {
  const rawValue = value.trim();

  if (!rawValue) {
    throw new Error("Wpisz URL do sprawdzenia.");
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawValue)
    ? rawValue
    : `https://${rawValue}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Podaj URL http albo https.");
  }

  return url.href;
}

function renderManualResult(result, url) {
  const decision = result.decision || "WARN";
  lastManualUrl = url;
  elements.manualResult.hidden = false;
  elements.manualResult.classList.remove("decision-allow", "decision-warn", "decision-block");
  elements.manualResult.classList.add(`decision-${decision.toLowerCase()}`);
  elements.manualDecision.textContent = decision;
  elements.manualScore.textContent = `${Number(result.risk_score) || 0}/100`;
  elements.manualDecisionIcon.innerHTML = getDecisionIcon(decision);
  elements.manualResultMeta.textContent = getHostname(url) || url;
  resetManualVt();
}

function resetManualVt() {
  elements.manualVtResult.hidden = true;
  elements.manualVtResult.classList.remove("decision-allow", "decision-warn", "decision-block");
  elements.manualVtDecision.textContent = "VirusTotal";
  elements.manualVtStats.textContent = "";
  elements.manualVtCategories.textContent = "";
  elements.manualVtLink.hidden = true;
  elements.manualVtLink.removeAttribute("href");
  elements.manualVtMessage.textContent = "";
  elements.manualVtButton.disabled = false;
  elements.manualVtButton.textContent = "Porównaj z VirusTotal";
}

function getVirusTotalLabel(decision) {
  if (decision === "ALLOW") {
    return "VT nie wykrywa zagrożenia";
  }

  if (decision === "BLOCK") {
    return "VT wykrywa ryzyko";
  }

  if (decision === "WARN") {
    return "VT wymaga uwagi";
  }

  return "Wynik VirusTotal";
}

function renderManualVtResult(result) {
  const decision = result.vt_decision || "WARN";
  const flagged = Number(result.engines_flagged) || 0;
  const total = Number(result.engines_total) || 0;
  const categories = Array.isArray(result.vt_categories) && result.vt_categories.length > 0
    ? result.vt_categories.join(", ")
    : "brak kategorii";

  elements.manualVtResult.hidden = false;
  elements.manualVtResult.classList.remove("decision-allow", "decision-warn", "decision-block");
  elements.manualVtResult.classList.add(`decision-${decision.toLowerCase()}`);
  elements.manualVtDecision.textContent = getVirusTotalLabel(decision);
  elements.manualVtStats.textContent = `${flagged}/${total} silników zgłosiło zagrożenie`;
  elements.manualVtCategories.textContent = `Kategorie: ${categories}`;

  const permalink = safeExternalUrl(result.vt_permalink);
  if (permalink) {
    elements.manualVtLink.href = permalink;
    elements.manualVtLink.hidden = false;
  } else {
    elements.manualVtLink.hidden = true;
    elements.manualVtLink.removeAttribute("href");
  }
}

async function handleManualVtCompare() {
  if (!lastManualUrl) {
    elements.manualVtMessage.textContent = "Najpierw wykonaj skan URL.";
    return;
  }

  if (!settings.vtKey) {
    elements.manualVtResult.hidden = true;
    elements.manualVtMessage.textContent = "Dodaj klucz VirusTotal w ustawieniach.";
    return;
  }

  elements.manualVtButton.disabled = true;
  elements.manualVtButton.textContent = "Sprawdzam VT";
  elements.manualVtMessage.textContent = "Porównuję wynik.";

  try {
    const vtResult = await scanVT(lastManualUrl, settings.vtKey);
    renderManualVtResult(vtResult);
    elements.manualVtMessage.textContent = "Porównanie gotowe.";
  } catch (error) {
    elements.manualVtResult.hidden = true;
    elements.manualVtMessage.textContent = error.message || "Nie udało się pobrać wyniku VT.";
  } finally {
    elements.manualVtButton.disabled = false;
    elements.manualVtButton.textContent = "Porównaj z VirusTotal";
  }
}

async function handleManualScan(event) {
  event.preventDefault();

  let url;
  try {
    url = normalizeManualUrl(elements.manualUrl.value);
  } catch (error) {
    elements.manualScanMessage.textContent = error.message;
    elements.manualResult.hidden = true;
    lastManualUrl = "";
    return;
  }

  elements.manualScanButton.disabled = true;
  elements.manualScanButton.textContent = "Skanuję";
  elements.manualScanMessage.textContent = "Guardy wysyła URL do backendu.";

  try {
    const result = await scanUrl(url);
    await saveToHistory({
      ...result,
      url,
      source: "manual_popup"
    });
    renderManualResult(result, url);
    await renderLastScan();
    if (settings.alwaysScanVirusTotal) {
      await handleManualVtCompare();
    }
    elements.manualScanMessage.textContent = "Skan zakończony.";
  } catch (error) {
    elements.manualResult.hidden = true;
    lastManualUrl = "";
    elements.manualScanMessage.textContent = error.message || "Backend offline albo brak odpowiedzi.";
  } finally {
    elements.manualScanButton.disabled = false;
    elements.manualScanButton.textContent = "Skanuj";
  }
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
elements.manualScanForm.addEventListener("submit", handleManualScan);
elements.manualVtButton.addEventListener("click", handleManualVtCompare);
elements.openSettings.addEventListener("click", openSettings);
elements.settingsLink.addEventListener("click", openSettings);

initPopup().catch(() => {
  setHealthStatus("is-offline", "Offline");
  elements.healthDetails.textContent = "Popup nie mógł pobrać danych rozszerzenia.";
});
