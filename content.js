const API_URL = "https://extension.services.dkdevs.com.br";
let hookInjected = false;
let lastOpenRequestAt = 0;

function getDeskSubdomain() {
  const hostname = location.hostname.toLowerCase();
  if (!hostname.endsWith(".desk.blip.ai")) return null;
  return hostname.split(".")[0];
}

async function validateTenant(subdomain) {
  try {
    const r = await fetch(`${API_URL}/extension/tenants/${encodeURIComponent(subdomain)}`, {
      headers: { Accept: "application/json" }
    });
    const data = await r.json();
    if (!data || data.active !== true) return null;
    return data;
  } catch {
    return null;
  }
}

function normalizeSettingsForHook(settings) {
  const s = settings || {};
  const deskSidebar = s?.features?.deskSidebar && typeof s.features.deskSidebar === 'object'
    ? { ...s.features.deskSidebar, enabled: true }
    : { enabled: true };

  return {
    ...s,
    mode: undefined,
    features: {
      deskSidebar,
      messagePrefix: { enabled: false },
      ticketTagging: { enabled: false },
    },
  };
}

function injectHookViaBackground(callback) {
  if (hookInjected) return callback?.(true);

  try {
    chrome.runtime.sendMessage({ type: 'INJECT_HOOK' }, (response) => {
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
  window.postMessage({ __blipExt: true, type: 'ENABLE', enabled, subdomain, settings }, '*');
}

function requestHookRefresh(forceReload = false, reason = 'sync') {
  window.postMessage({ __blipExt: true, type: 'REFRESH_PANEL_CONTEXT', forceReload, reason }, '*');
}

async function syncHookState(subdomain, { forceReload = false, reason = 'sync' } = {}) {
  const tenantData = await validateTenant(subdomain);
  if (!tenantData?.settings) return false;

  const normalized = normalizeSettingsForHook(tenantData.settings);
  injectHookViaBackground((success) => {
    if (!success) return;
    sendEnableToHook(true, subdomain, normalized);
    requestHookRefresh(forceReload, reason);
  });

  return true;
}

function monitorUrlChanges(subdomain) {
  let lastUrl = location.href;
  setInterval(async () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      await syncHookState(subdomain, { forceReload: true, reason: 'url-change' });
    }
  }, 1000);
}

(function bootstrap() {
  const subdomain = getDeskSubdomain();
  if (!subdomain) return;

  validateTenant(subdomain).then((tenantData) => {
    if (!tenantData) return;

    injectHookViaBackground((success) => {
      if (!success) return;
      const normalized = normalizeSettingsForHook(tenantData.settings);
      setTimeout(() => {
        sendEnableToHook(true, subdomain, normalized);
        requestHookRefresh(false, 'bootstrap');
      }, 250);
      setTimeout(() => {
        sendEnableToHook(true, subdomain, normalized);
        requestHookRefresh(true, 'bootstrap-retry');
      }, 1200);
    });

    monitorUrlChanges(subdomain);

    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await syncHookState(subdomain, { forceReload: true, reason: 'visibility-visible' });
      }
    });

    window.addEventListener('focus', async () => {
      await syncHookState(subdomain, { forceReload: true, reason: 'url-change' });
    });
  });
})();


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'OPEN_ATTACHMENT_PREVIEW') {
    openAttachmentPreview(msg.items || [], msg.startIndex || 0);
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type !== 'REFRESH_DESK_CONTEXT') return;

  const subdomain = getDeskSubdomain();
  if (!subdomain) {
    sendResponse?.({ ok: false, error: 'NOT_DESK_PAGE' });
    return;
  }

  syncHookState(subdomain, {
    forceReload: msg.forceReload !== false,
    reason: msg.reason || 'runtime-refresh'
  })
    .then((ok) => sendResponse?.({ ok }))
    .catch((error) => sendResponse?.({ ok: false, error: String(error?.message || error) }));

  return true;
});

window.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data || data.__dkSidebar !== true || data.type !== 'API_FETCH') return;

  const { requestId, url, options } = data;
  if (!requestId || !url) return;

  try {
    const response = await fetch(url, options || {});
    const contentType = response.headers.get('content-type') || '';
    let body;

    if (contentType.includes('application/json')) body = await response.json();
    else body = await response.text();

    window.postMessage({ __dkSidebar: true, type: 'API_FETCH_RESULT', requestId, ok: response.ok, status: response.status, body }, '*');
  } catch (error) {
    window.postMessage({
      __dkSidebar: true,
      type: 'API_FETCH_RESULT',
      requestId,
      ok: false,
      status: 0,
      error: String(error?.message || error)
    }, '*');
  }
});

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.__dkSidePanel !== true || data.type !== 'SIDEPANEL_CONTEXT') return;

  try {
    chrome.runtime.sendMessage({ type: 'DESK_CONTEXT_UPDATE', payload: data.payload || {} });
  } catch {}
});

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.__dkSidePanel !== true || data.type !== 'OPEN_SIDE_PANEL_REQUEST') return;
  openSidePanelNow();
});

function isTicketClickEvent(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const candidates = path.length ? path : [event.target];
  const selectors = [
    'article.ticket-list-item',
    'article.chat-list-item',
    "article[id$='-chat-list-item']",
    '[data-ticket-id]',
    '[data-conversation-id]',
    '[data-testid*="ticket" i]',
    '[data-testid*="conversation" i]',
    'bds-card',
    'li'
  ];

  for (const node of candidates) {
    if (!(node instanceof Element)) continue;
    for (const selector of selectors) {
      try {
        if (node.matches?.(selector) || node.closest?.(selector)) return true;
      } catch {}
    }

    const cls = String(node.className || '').toLowerCase();
    const role = String(node.getAttribute?.('role') || '').toLowerCase();
    const dataTestId = String(node.getAttribute?.('data-testid') || '').toLowerCase();
    if (cls.includes('ticket-list-item') || cls.includes('chat-list-item') || dataTestId.includes('ticket') || dataTestId.includes('conversation')) return true;
    if (role === 'option' || role === 'listitem') {
      const text = String(node.textContent || '').trim();
      if (text) return true;
    }
  }

  return false;
}

function openSidePanelNow() {
  const now = Date.now();
  if (now - lastOpenRequestAt < 500) return;
  lastOpenRequestAt = now;

  try {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    setTimeout(() => chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }), 120);
  } catch {}
}

document.addEventListener('mousedown', (event) => {
  if (!isTicketClickEvent(event)) return;
  openSidePanelNow();
}, true);

document.addEventListener('click', (event) => {
  if (!isTicketClickEvent(event)) return;
  openSidePanelNow();
}, true);


const ATTACHMENT_PREVIEW_ROOT_ID = 'dk-attachment-preview-root';
let attachmentPreviewState = { items: [], index: 0, zoom: 1, drag: null };

function ensureAttachmentPreview() {
  let root = document.getElementById(ATTACHMENT_PREVIEW_ROOT_ID);
  if (root) return root;

  root = document.createElement('div');
  root.id = ATTACHMENT_PREVIEW_ROOT_ID;
  root.innerHTML = `
    <style>
      #${ATTACHMENT_PREVIEW_ROOT_ID} { position: fixed; inset: 0; z-index: 2147483647; display: none; }
      #${ATTACHMENT_PREVIEW_ROOT_ID}.open { display: block; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-backdrop { position: absolute; inset: 0; background: rgba(15, 23, 42, .76); }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-dialog { position: absolute; inset: 24px; background: #fff; border-radius: 16px; box-shadow: 0 20px 70px rgba(0,0,0,.35); overflow: hidden; display: flex; flex-direction: column; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-topbar { display: flex; align-items: center; justify-content: flex-end; padding: 10px; border-bottom: 1px solid #e5e7eb; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-close,
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-nav { border: 1px solid #d1d5db; background: rgba(255,255,255,.96); color: #111827; border-radius: 999px; cursor: pointer; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-close { width: 34px; height: 34px; font-size: 22px; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-stage { position: relative; flex: 1; min-height: 0; overflow: auto; background: #f8fafc; display: flex; align-items: center; justify-content: center; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-img { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center center; transition: transform .12s ease; cursor: zoom-in; user-select: none; -webkit-user-drag: none; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-img.zoomed { cursor: grab; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-img.dragging { cursor: grabbing; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-caption { padding: 10px 16px 14px; text-align: center; font: 13px Arial, sans-serif; color: #6b7280; border-top: 1px solid #e5e7eb; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 42px; height: 42px; font-size: 30px; z-index: 2; display: flex; align-items: center; justify-content: center; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-prev { left: 14px; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .dk-ap-next { right: 14px; }
      #${ATTACHMENT_PREVIEW_ROOT_ID} .hidden { display: none !important; }
    </style>
    <div class="dk-ap-backdrop" data-close="1"></div>
    <div class="dk-ap-dialog" role="dialog" aria-modal="true" aria-label="Visualização de anexo">
      <div class="dk-ap-topbar"><button type="button" class="dk-ap-close" aria-label="Fechar">×</button></div>
      <div class="dk-ap-stage">
        <button type="button" class="dk-ap-nav dk-ap-prev" aria-label="Anterior">‹</button>
        <img class="dk-ap-img" alt="Anexo" />
        <button type="button" class="dk-ap-nav dk-ap-next" aria-label="Próxima">›</button>
      </div>
      <div class="dk-ap-caption"></div>
    </div>
  `;
  document.documentElement.appendChild(root);

  const close = () => closeAttachmentPreview();
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close="1"]') || event.target.closest('.dk-ap-close')) close();
    else if (event.target.closest('.dk-ap-prev')) { event.stopPropagation(); changeAttachmentPreview(-1); }
    else if (event.target.closest('.dk-ap-next')) { event.stopPropagation(); changeAttachmentPreview(1); }
  });

  const img = root.querySelector('.dk-ap-img');
  const stage = root.querySelector('.dk-ap-stage');
  img.addEventListener('click', () => setAttachmentPreviewZoom(attachmentPreviewState.zoom > 1 ? 1 : 2));
  stage.addEventListener('wheel', (event) => {
    if (!root.classList.contains('open')) return;
    event.preventDefault();
    setAttachmentPreviewZoom(attachmentPreviewState.zoom + (event.deltaY < 0 ? 0.2 : -0.2));
  }, { passive: false });
  img.addEventListener('mousedown', (event) => {
    if (attachmentPreviewState.zoom <= 1) return;
    attachmentPreviewState.drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    img.classList.add('dragging');
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event) => {
    if (!attachmentPreviewState.drag || attachmentPreviewState.zoom <= 1 || !root.classList.contains('open')) return;
    stage.scrollLeft = attachmentPreviewState.drag.left - (event.clientX - attachmentPreviewState.drag.x);
    stage.scrollTop = attachmentPreviewState.drag.top - (event.clientY - attachmentPreviewState.drag.y);
  });
  window.addEventListener('mouseup', () => {
    attachmentPreviewState.drag = null;
    img.classList.remove('dragging');
  });
  document.addEventListener('keydown', (event) => {
    if (!root.classList.contains('open')) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowLeft') changeAttachmentPreview(-1);
    else if (event.key === 'ArrowRight') changeAttachmentPreview(1);
    else if (event.key === '+' || event.key === '=') setAttachmentPreviewZoom(attachmentPreviewState.zoom + 0.2);
    else if (event.key === '-') setAttachmentPreviewZoom(attachmentPreviewState.zoom - 0.2);
  }, true);
  return root;
}

function setAttachmentPreviewZoom(value) {
  const root = ensureAttachmentPreview();
  const img = root.querySelector('.dk-ap-img');
  attachmentPreviewState.zoom = Math.min(4, Math.max(1, Number(value) || 1));
  img.style.transform = `scale(${attachmentPreviewState.zoom})`;
  img.classList.toggle('zoomed', attachmentPreviewState.zoom > 1);
  if (attachmentPreviewState.zoom <= 1) {
    const stage = root.querySelector('.dk-ap-stage');
    stage.scrollTop = 0; stage.scrollLeft = 0;
  }
}

function renderAttachmentPreview() {
  const root = ensureAttachmentPreview();
  const img = root.querySelector('.dk-ap-img');
  const caption = root.querySelector('.dk-ap-caption');
  const prev = root.querySelector('.dk-ap-prev');
  const next = root.querySelector('.dk-ap-next');
  const item = attachmentPreviewState.items[attachmentPreviewState.index];
  if (!item) return;
  img.src = item.src;
  img.alt = item.name || 'Anexo';
  caption.textContent = `${item.name || 'Anexo'}${attachmentPreviewState.items.length > 1 ? ` — ${attachmentPreviewState.index + 1}/${attachmentPreviewState.items.length}` : ''}`;
  prev.classList.toggle('hidden', attachmentPreviewState.items.length < 2);
  next.classList.toggle('hidden', attachmentPreviewState.items.length < 2);
  root.classList.add('open');
  setAttachmentPreviewZoom(1);
}

function openAttachmentPreview(items, startIndex) {
  attachmentPreviewState.items = Array.isArray(items) ? items.filter((x) => x && x.src) : [];
  attachmentPreviewState.index = Math.max(0, Math.min(Number(startIndex) || 0, attachmentPreviewState.items.length - 1));
  if (!attachmentPreviewState.items.length) return;
  renderAttachmentPreview();
}

function closeAttachmentPreview() {
  const root = document.getElementById(ATTACHMENT_PREVIEW_ROOT_ID);
  if (!root) return;
  root.classList.remove('open');
  const img = root.querySelector('.dk-ap-img');
  if (img) img.removeAttribute('src');
  attachmentPreviewState = { items: [], index: 0, zoom: 1, drag: null };
}

function changeAttachmentPreview(step) {
  if ((attachmentPreviewState.items || []).length < 2) return;
  attachmentPreviewState.index = (attachmentPreviewState.index + step + attachmentPreviewState.items.length) % attachmentPreviewState.items.length;
  renderAttachmentPreview();
}
