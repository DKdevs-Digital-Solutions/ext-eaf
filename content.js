const API_URL = "https://extension.services.dkdevs.com.br";
let hookInjected = false;

function getDeskSubdomain() {
  const hostname = location.hostname.toLowerCase();
  if (!hostname.endsWith(".desk.blip.ai")) return null;
  return hostname.split(".")[0];
}

async function validateTenant(subdomain) {
  try {
    const r = await fetch(`${API_URL}/extension/tenants/${encodeURIComponent(subdomain)}`, {
      headers: { "Accept": "application/json" }
    });
    const data = await r.json();
    if (!data || data.active !== true) return null;

    // Retorna mesmo sem features — tagFilter é sempre injetado
    return data;
  } catch {
    return null;
  }
}

function normalizeSettingsForHook(settings) {
  const s = settings || {};
  const features = s.features && typeof s.features === "object" ? { ...s.features } : {};

  // Suporte legado: mode
  if (s.mode) return { ...s, features };

  const mp = features.messagePrefix;
  if (mp && mp.enabled) {
    return { ...s, features, mode: mp.mode || "bold_name_two_breaks" };
  }
  return { ...s, features };
}

function injectHookViaBackground(callback) {
  if (hookInjected) return callback?.(true);

  try {
    chrome.runtime.sendMessage({ type: "INJECT_HOOK" }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) return callback?.(false);
      if (!response?.ok) return callback?.(false);
      hookInjected = true;
      callback?.(true);
    });
  } catch {
    callback?.(false);
  }
}

function sendEnableToHook(enabled, subdomain, settings = {}) {
  window.postMessage({ __blipExt: true, type: "ENABLE", enabled, subdomain, settings }, "*");
}

function monitorUrlChanges(subdomain) {
  let lastUrl = location.href;
  setInterval(async () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const t = await validateTenant(subdomain);
      if (t?.settings) sendEnableToHook(true, subdomain, normalizeSettingsForHook(t.settings));
    }
  }, 1000);
}

(async function main() {
  const subdomain = getDeskSubdomain();
  if (!subdomain) return;

  const tenantData = await validateTenant(subdomain);
  if (!tenantData) return;

  injectHookViaBackground((success) => {
    if (!success) return;
    const normalized = normalizeSettingsForHook(tenantData.settings);
    setTimeout(() => sendEnableToHook(true, subdomain, normalized), 250);
    setTimeout(() => sendEnableToHook(true, subdomain, normalized), 1200);
  });

  monitorUrlChanges(subdomain);

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      const t = await validateTenant(subdomain);
      if (t?.settings) sendEnableToHook(true, subdomain, normalizeSettingsForHook(t.settings));
    }
  });

  window.addEventListener("focus", async () => {
    const t = await validateTenant(subdomain);
    if (t?.settings) sendEnableToHook(true, subdomain, normalizeSettingsForHook(t.settings));
  });
})();


window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || data.__dkSidebar !== true || data.type !== "API_FETCH") return;

  const { requestId, url, options } = data;
  if (!requestId || !url) return;

  try {
    const response = await fetch(url, options || {});
    const contentType = response.headers.get("content-type") || "";
    let body;

    if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    window.postMessage({
      __dkSidebar: true,
      type: "API_FETCH_RESULT",
      requestId,
      ok: response.ok,
      status: response.status,
      body
    }, "*");
  } catch (error) {
    window.postMessage({
      __dkSidebar: true,
      type: "API_FETCH_RESULT",
      requestId,
      ok: false,
      status: 0,
      error: String(error?.message || error)
    }, "*");
  }
});
