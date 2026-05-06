import { DEFAULT_SETTINGS, getHistory, getSettings, saveSettings } from "./utils/api.js";

const VT_KEY_PATTERN = /^[a-fA-F0-9]{64}$/;

const elements = {
  aboutButton: document.querySelector("#aboutButton"),
  aboutModal: document.querySelector("#aboutModal"),
  backendUrl: document.querySelector("#backendUrl"),
  clearData: document.querySelector("#clearData"),
  clearHistory: document.querySelector("#clearHistory"),
  closeAbout: document.querySelector("#closeAbout"),
  exportHistory: document.querySelector("#exportHistory"),
  form: document.querySelector("#settingsForm"),
  historyList: document.querySelector("#historyList"),
  saveStatus: document.querySelector("#saveStatus"),
  toggleVtKey: document.querySelector("#toggleVtKey"),
  vtKey: document.querySelector("#vtKey"),
  vtKeyHint: document.querySelector("#vtKeyHint")
};

let settings = DEFAULT_SETTINGS;
let history = [];

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "auto" ? "" : theme;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch (error) {
    return value || "Nieznany URL";
  }
}

function decisionIcon(decision) {
  if (decision === "ALLOW") {
    return '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="m8.5 12.5 2.2 2.2 4.8-5.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>';
  }

  if (decision === "BLOCK") {
    return '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="m8.8 8.8 6.4 6.4m0-6.4-6.4 6.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path>';
  }

  return '<path d="M12 3.2 21.2 19H2.8L12 3.2Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"></path><path d="M12 8.5v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path><path d="M12 16.7h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.8"></path>';
}

function validateVtKey() {
  const value = elements.vtKey.value.trim();
  elements.vtKeyHint.classList.remove("is-valid", "is-invalid");

  if (!value) {
    elements.vtKeyHint.textContent = "Klucz jest opcjonalny, ale potrzebny do porównania z VirusTotal.";
    return true;
  }

  if (VT_KEY_PATTERN.test(value)) {
    elements.vtKeyHint.textContent = "Format poprawny.";
    elements.vtKeyHint.classList.add("is-valid");
    return true;
  }

  elements.vtKeyHint.textContent = "Klucz musi mieć dokładnie 64 znaki hex.";
  elements.vtKeyHint.classList.add("is-invalid");
  return false;
}

function renderForm() {
  elements.backendUrl.value = settings.backendUrl;
  elements.vtKey.value = settings.vtKey;
  elements.form.scanMode.value = settings.scanMode;
  elements.form.theme.value = settings.theme;
  setTheme(settings.theme);
  validateVtKey();
}

function renderHistory() {
  elements.historyList.replaceChildren();

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "Historia skanów jest pusta.";
    elements.historyList.append(empty);
    return;
  }

  history.slice(0, 20).forEach((entry) => {
    const decision = entry.decision || "WARN";
    const item = document.createElement("article");
    item.className = `history-item decision-${decision.toLowerCase()}`;
    item.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">${decisionIcon(decision)}</svg>
      <div>
        <div class="history-url"></div>
        <div class="history-meta"></div>
      </div>
      <strong class="history-score">${Number(entry.risk_score) || 0}/100</strong>
      <time class="history-time"></time>
    `;
    item.querySelector(".history-url").textContent = hostnameFromUrl(entry.url);
    item.querySelector(".history-meta").textContent = decision;
    item.querySelector("time").textContent = formatDate(entry.saved_at || entry.timestamp);
    elements.historyList.append(item);
  });
}

function showStatus(message) {
  elements.saveStatus.textContent = message;
  window.clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = window.setTimeout(() => {
    elements.saveStatus.textContent = "";
  }, 2400);
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!validateVtKey()) {
    showStatus("Popraw klucz VirusTotal.");
    return;
  }

  try {
    new URL(elements.backendUrl.value.trim());
  } catch (error) {
    showStatus("Podaj poprawny backend URL.");
    return;
  }

  settings = await saveSettings({
    backendUrl: elements.backendUrl.value.trim().replace(/\/+$/, ""),
    vtKey: elements.vtKey.value.trim(),
    scanMode: elements.form.scanMode.value,
    theme: elements.form.theme.value
  });

  setTheme(settings.theme);
  showStatus("Zapisano zmiany.");
}

async function clearHistoryOnly() {
  await chrome.storage.local.set({ history: [], lastScan: null });
  history = [];
  renderHistory();
  showStatus("Historia wyczyszczona.");
}

async function clearAllData() {
  await chrome.storage.local.set({
    settings: {
      ...DEFAULT_SETTINGS
    },
    history: [],
    lastScan: null
  });
  settings = await getSettings();
  history = [];
  renderForm();
  renderHistory();
  showStatus("Dane wyczyszczone.");
}

function exportHistory() {
  const payload = JSON.stringify(history.slice(0, 20), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "guardy-history.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function openAbout() {
  elements.aboutModal.hidden = false;
}

function closeAbout() {
  elements.aboutModal.hidden = true;
}

async function initSettings() {
  settings = await getSettings();
  history = await getHistory();
  renderForm();
  renderHistory();
}

elements.form.addEventListener("submit", handleSubmit);
elements.vtKey.addEventListener("input", validateVtKey);
elements.toggleVtKey.addEventListener("click", () => {
  elements.vtKey.type = elements.vtKey.type === "password" ? "text" : "password";
});
elements.clearHistory.addEventListener("click", clearHistoryOnly);
elements.clearData.addEventListener("click", clearAllData);
elements.exportHistory.addEventListener("click", exportHistory);
elements.aboutButton.addEventListener("click", openAbout);
elements.closeAbout.addEventListener("click", closeAbout);
elements.aboutModal.addEventListener("click", (event) => {
  if (event.target === elements.aboutModal) {
    closeAbout();
  }
});
elements.form.theme.forEach((input) => {
  input.addEventListener("change", () => setTheme(input.value));
});

initSettings().catch(() => {
  showStatus("Nie udało się wczytać ustawień.");
});
