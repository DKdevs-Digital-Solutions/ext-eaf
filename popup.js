const DESK_URL_RE = /^https:\/\/[^/]+\.desk\.blip\.ai\//i;

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isDesk = DESK_URL_RE.test(String(tab?.url || ''));
  const status = document.getElementById('status');
  const button = document.getElementById('openSidePanel');

  if (isDesk) {
    status.textContent = 'Clique abaixo para abrir o painel lateral.';
    button.disabled = false;
  } else {
    status.textContent = 'Abra um atendimento no Blip Desk para usar o validador.';
    button.disabled = true;
  }

  button.addEventListener('click', async () => {
    if (!tab?.id || !tab?.windowId || !isDesk) return;
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', tabId: tab.id, windowId: tab.windowId, url: tab.url });
      window.close();
    } catch {}
  });
}

main();
