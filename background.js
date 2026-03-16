const DESK_URL_RE = /^https:\/\/[^/]+\.desk\.blip\.ai\//i;
const tabContexts = new Map();

function isDeskUrl(url) {
  return DESK_URL_RE.test(String(url || ''));
}

async function setDeskSidePanelForTab(tabId, url) {
  if (!tabId) return;
  const isDesk = isDeskUrl(url);

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: isDesk,
    });
  } catch {}
}

async function syncKnownTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.map((tab) => setDeskSidePanelForTab(tab.id, tab.url)));
  } catch {}
}

chrome.runtime.onInstalled.addListener(() => {
  syncKnownTabs();
});

chrome.runtime.onStartup.addListener(() => {
  syncKnownTabs();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const nextUrl = info.url || tab?.url;
  if (nextUrl || info.status === 'loading' || info.status === 'complete') {
    setDeskSidePanelForTab(tabId, nextUrl);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setDeskSidePanelForTab(tabId, tab?.url);
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabContexts.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'INJECT_HOOK') {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse?.({ ok: false, error: 'NO_TAB_ID' });
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['hook.js'],
    })
      .then(() => sendResponse?.({ ok: true }))
      .catch((err) => sendResponse?.({ ok: false, error: String(err?.message || err) }));

    return true;
  }

  if (msg.type === 'DESK_CONTEXT_UPDATE') {
    const tabId = sender?.tab?.id || msg.tabId;
    if (!tabId) {
      sendResponse?.({ ok: false, error: 'NO_TAB_ID' });
      return;
    }

    const payload = {
      ...(msg.payload || {}),
      tabId,
      url: sender?.tab?.url || msg.url || '',
      updatedAt: Date.now(),
    };

    tabContexts.set(tabId, payload);
    chrome.runtime.sendMessage({ type: 'DESK_CONTEXT_BROADCAST', payload }).catch(() => {});
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === 'GET_TAB_CONTEXT') {
    const tabId = msg.tabId;
    sendResponse?.({ ok: true, payload: tabContexts.get(tabId) || null });
    return;
  }


  if (msg.type === 'REFRESH_TAB_CONTEXT') {
    const tabId = msg.tabId || sender?.tab?.id;
    if (!tabId) {
      sendResponse?.({ ok: false, error: 'NO_TAB_ID' });
      return;
    }

    chrome.tabs.sendMessage(tabId, {
      type: 'REFRESH_DESK_CONTEXT',
      forceReload: msg.forceReload !== false,
      reason: msg.reason || 'manual'
    })
      .then(() => sendResponse?.({ ok: true }))
      .catch((err) => sendResponse?.({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (msg.type === 'OPEN_SIDE_PANEL') {
    const tabId = msg.tabId || sender?.tab?.id;
    const windowId = msg.windowId || sender?.tab?.windowId;
    const targetUrl = msg.url || sender?.tab?.url || '';

    if (!tabId || !windowId) {
      sendResponse?.({ ok: false, error: 'NO_TARGET' });
      return;
    }

    if (!isDeskUrl(targetUrl)) {
      sendResponse?.({ ok: false, error: 'NOT_DESK_TAB' });
      return;
    }

    chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true,
    })
      .then(() => chrome.sidePanel.open({ tabId, windowId }))
      .then(() => sendResponse?.({ ok: true }))
      .catch((err) => sendResponse?.({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});
