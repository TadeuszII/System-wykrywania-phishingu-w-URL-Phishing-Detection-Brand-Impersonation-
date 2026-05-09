const DEFAULT_BACKEND_URL = "http://localhost:8000";

const MESSAGE_TYPES = {
  SCAN_URL: "SCAN_URL",
  SCAN_VT: "SCAN_VT",
  GET_HEALTH: "GET_HEALTH"
};

async function getBackendUrl() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return normalizeBackendUrl(settings.backendUrl || DEFAULT_BACKEND_URL);
}

function normalizeBackendUrl(url) {
  return String(url || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.detail || payload?.message || `Backend returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function requestBackend(path, options = {}) {
  const backendUrl = await getBackendUrl();
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  return parseJsonResponse(response);
}

async function scanUrl(url, context = "clicked_link") {
  return requestBackend("/scan/url", {
    method: "POST",
    body: JSON.stringify({
      url,
      context
    })
  });
}

async function scanVirusTotal(url, vtKey) {
  return requestBackend("/scan/virustotal", {
    method: "POST",
    headers: {
      "X-VT-Key": vtKey
    },
    body: JSON.stringify({ url })
  });
}

async function getHealth() {
  return requestBackend("/health", {
    method: "GET"
  });
}

async function handleMessage(message) {
  if (!message || !message.type) {
    throw new Error("Missing message type");
  }

  switch (message.type) {
    case MESSAGE_TYPES.SCAN_URL:
      return scanUrl(message.url, message.context);
    case MESSAGE_TYPES.SCAN_VT:
      return scanVirusTotal(message.url, message.vtKey);
    case MESSAGE_TYPES.GET_HEALTH:
      return getHealth();
    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => {
      sendResponse({ ok: true, data });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message || "Unexpected background error"
      });
    });

  return true;
});
