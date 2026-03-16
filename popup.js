const API = "https://extension.services.dkdevs.com.br";
const TENANT_PATH = "/extension/tenants";

function getTenant(url) {
  try {
    const h = new URL(url).hostname;
    if (h.endsWith(".desk.blip.ai")) return h.split(".")[0];
  } catch {}
  return null;
}

function normalizeFeatures(settings) {
  const featureMeta = {
    messagePrefix: { title: "Prefixo do atendente", serviceName: "desk.productivity" },
    ticketTagging: { title: "Etiquetas e filtros", serviceName: "desk.tagging" },
    deskSidebar: { title: "CRM lateral", serviceName: "desk.crmSidebar" }
  };

  if (settings?.features && typeof settings.features === "object") {
    const normalized = { ...settings.features };
    Object.entries(normalized).forEach(([key, cfg]) => {
      normalized[key] = { ...featureMeta[key], ...(cfg || {}) };
    });
    return normalized;
  }

  // Legado: settings.mode
  if (settings?.mode) {
    return {
      messagePrefix: {
        enabled: true,
        mode: settings.mode,
        title: "Prefixo do atendente",
        serviceName: "desk.productivity"
      }
    };
  }
  return {};
}

function setStatus(ok) {
  document.getElementById("statusDot").classList.toggle("ok", !!ok);
}

function fmtExpiry(expiresAt) {
  if (!expiresAt) return "";
  try {
    const d = new Date(expiresAt);
    if (isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `expira ${dd}/${mm}/${yyyy}`;
  } catch {
    return "";
  }
}

function renderActiveOnly(features) {
  const entries = Object.entries(features || {}).filter(([_, cfg]) => !!cfg?.enabled);

  document.getElementById("count").textContent = `${entries.length} ativa(s)`;

  if (entries.length === 0) {
    return `<div class="empty">Não há nada ativo.</div>`;
  }

  return entries.map(([key, cfg]) => {
    const title = cfg?.title || key;
    const svc = cfg?.serviceName || cfg?.service_name || "";
    const exp = fmtExpiry(cfg?.expiresAt || cfg?.expires_at);
    const meta = [svc, exp].filter(Boolean).join(" • ");

    return `
      <div class="row">
        <div class="nameWrap">
          <div class="name" title="${title}">${title}</div>
          ${meta ? `<div class="meta" title="${meta}">${meta}</div>` : ""}
        </div>
        <div class="badge"><span class="miniDot"></span>ATIVO</div>
      </div>
    `;
  }).join("");
}

async function load() {
  const content = document.getElementById("content");
  content.innerHTML = `<div class="empty">Carregando…</div>`;
  setStatus(false);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tenant = getTenant(tab?.url || "");

  if (!tenant) {
    document.getElementById("count").textContent = "—";
    content.innerHTML = `<div class="empty">Abra o Blip Desk para ver os recursos.</div>`;
    return;
  }

  try {
    const r = await fetch(`${API}${TENANT_PATH}/${encodeURIComponent(tenant)}`, {
      headers: { "Accept": "application/json" }
    });
    const d = await r.json();

    if (!d || d.active !== true) {
      document.getElementById("count").textContent = "0 ativa(s)";
      content.innerHTML = `<div class="empty">Não há nada ativo.</div>`;
      return;
    }

    const features = normalizeFeatures(d.settings || {});
    content.innerHTML = renderActiveOnly(features);
    setStatus(true);
  } catch {
    document.getElementById("count").textContent = "—";
    content.innerHTML = `<div class="empty">Não foi possível carregar agora.</div>`;
  }
}

document.getElementById("refresh").addEventListener("click", load);
load();
