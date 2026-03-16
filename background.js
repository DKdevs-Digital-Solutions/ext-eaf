chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "INJECT_HOOK") return;

  const tabId = sender?.tab?.id;
  if (!tabId) return sendResponse({ ok: false, error: "NO_TAB_ID" });

  chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["hook.js"]
  })
  .then(() => sendResponse({ ok: true }))
  .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));

  return true;
});
