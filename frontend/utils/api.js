export const DEFAULT_SETTINGS = {
  backendUrl: "http://localhost:8000",
  vtKey: "",
  alwaysScanVirusTotal: false,
  scanMode: "all",
  safeLinkMode: "full",
  theme: "auto",
  disabledDomains: []
};

export const DECISIONS = {
  ALLOW: "ALLOW",
  WARN: "WARN",
  BLOCK: "BLOCK"
};

const HISTORY_LIMIT = 20;

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Guardy request failed"));
        return;
      }

      resolve(response.data);
    });
  });
}

export function scanUrl(url, context = "clicked_link") {
  return sendMessage("SCAN_URL", { url, context });
}

export function scanVT(url, vtKey) {
  return sendMessage("SCAN_VT", { url, vtKey });
}

export function getHealth() {
  return sendMessage("GET_HEALTH");
}

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    disabledDomains: Array.isArray(settings.disabledDomains)
      ? settings.disabledDomains
      : DEFAULT_SETTINGS.disabledDomains
  };
}

export async function saveSettings(nextSettings) {
  const currentSettings = await getSettings();
  const settings = {
    ...currentSettings,
    ...nextSettings
  };

  await chrome.storage.local.set({ settings });
  return settings;
}

export async function getHistory() {
  const { history = [] } = await chrome.storage.local.get("history");
  return Array.isArray(history) ? history : [];
}

export async function saveToHistory(scanResult) {
  const history = await getHistory();
  const nextEntry = {
    ...scanResult,
    saved_at: new Date().toISOString()
  };
  const nextHistory = [nextEntry, ...history].slice(0, HISTORY_LIMIT);

  await chrome.storage.local.set({
    history: nextHistory,
    lastScan: nextEntry
  });

  return nextEntry;
}
