let currentTabId = null;
let currentState = null;
let activeTab = 'validador';
const DESK_URL_RE = /^https:\/\/[^/]+\.desk\.blip\.ai\//i;

const R2_BASE_URL = 'https://pub-c54ecb6f6021463e95790b49774c4e8c.r2.dev';
const R2_ATTACHMENTS = [
  { name: 'frente.jpg', label: 'Frente' },
  { name: 'self.png', label: 'Self' },
  { name: 'tv.jpg', label: 'TV' },
  { name: 'verso.png', label: 'Verso' },
];
const attachmentCache = new Map();
let attachmentsRequestToken = 0;
let modalGalleryItems = [];
let modalGalleryIndex = -1;
let modalZoom = 1;
let modalDragState = null;

function getImageModalElements() {
  return {
    modal: qs('#imageModal'),
    image: qs('#imageModalImg'),
    caption: qs('#imageModalCaption'),
    prev: qs('#imageModalPrev'),
    next: qs('#imageModalNext'),
    wrap: qs('.modal-image-wrap'),
  };
}
function resetModalZoom() {
  const { image, wrap } = getImageModalElements();
  modalZoom = 1;
  modalDragState = null;
  if (image) {
    image.style.transform = 'scale(1)';
    image.classList.remove('is-zoomed', 'is-dragging');
  }
  if (wrap) {
    wrap.scrollTop = 0;
    wrap.scrollLeft = 0;
  }
}
function renderModalImage() {
  const { modal, image, caption, prev, next } = getImageModalElements();
  const item = modalGalleryItems[modalGalleryIndex];
  if (!modal || !image || !caption || !item) return;
  image.src = item.src;
  image.alt = item.name || 'Anexo';
  const count = modalGalleryItems.length > 1 ? ` <span class="modal-counter">${modalGalleryIndex + 1}/${modalGalleryItems.length}</span>` : '';
  caption.innerHTML = `${escapeHtml(item.name || '')}${count}`;
  if (prev) prev.classList.toggle('hidden', modalGalleryItems.length < 2);
  if (next) next.classList.toggle('hidden', modalGalleryItems.length < 2);
  resetModalZoom();
}
function openImageModal(src, caption = '', items = [], startIndex = 0) {
  const { modal } = getImageModalElements();
  if (!modal || !src) return;
  modalGalleryItems = Array.isArray(items) && items.length ? items : [{ src, name: caption || 'Anexo' }];
  modalGalleryIndex = Math.max(0, modalGalleryItems.findIndex((item) => item.src === src));
  if (modalGalleryIndex < 0) modalGalleryIndex = Math.max(0, startIndex || 0);
  renderModalImage();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}
function closeImageModal() {
  const { modal, image, caption } = getImageModalElements();
  if (!modal || !image || !caption) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  image.removeAttribute('src');
  caption.textContent = '';
  modalGalleryItems = [];
  modalGalleryIndex = -1;
  resetModalZoom();
  document.body.classList.remove('modal-open');
}
function changeModalImage(step) {
  if (modalGalleryItems.length < 2) return;
  modalGalleryIndex = (modalGalleryIndex + step + modalGalleryItems.length) % modalGalleryItems.length;
  renderModalImage();
}
function setModalZoom(nextZoom) {
  const { image } = getImageModalElements();
  if (!image) return;
  modalZoom = Math.min(4, Math.max(1, nextZoom));
  image.style.transform = `scale(${modalZoom})`;
  image.classList.toggle('is-zoomed', modalZoom > 1);
}


async function openAttachmentPreviewInPage(items, startIndex) {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return false;
    await chrome.tabs.sendMessage(tab.id, {
      type: 'OPEN_ATTACHMENT_PREVIEW',
      items,
      startIndex: Math.max(0, Number(startIndex) || 0),
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeProtocol(value) {
  return String(value || '').trim();
}
function buildAttachmentUrl(protocol, fileName) {
  return `${R2_BASE_URL}/${encodeURIComponent(protocol)}/${encodeURIComponent(fileName)}`;
}
function isImageAttachment(name, type = '') {
  return /^image\//i.test(type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(name || ''));
}
async function headAttachment(url) {
  const response = await fetch(url, {
    method: 'HEAD',
    cache: 'no-store'
  });
  return response;
}
async function fetchR2Attachments(protocol) {
  const normalizedProtocol = normalizeProtocol(protocol);
  if (!normalizedProtocol) return [];
  if (attachmentCache.has(normalizedProtocol)) return attachmentCache.get(normalizedProtocol);

  const found = [];
  for (const item of R2_ATTACHMENTS) {
    const url = buildAttachmentUrl(normalizedProtocol, item.name);
    try {
      const response = await headAttachment(url);
      if (!response.ok) continue;
      found.push({
        nome: item.name,
        titulo: item.label,
        tipo: response.headers.get('content-type') || '',
        tamanho: Number(response.headers.get('content-length') || 0),
        url,
      });
    } catch {}
  }

  attachmentCache.set(normalizedProtocol, found);
  return found;
}
function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1).replace('.0', '')} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace('.0', '')} MB`;
}
async function ensureAttachmentsLoaded(state, { force = false } = {}) {
  const protocol = normalizeProtocol(state?.protocol || state?.ticketDisplay || state?.ticketId || '');
  const listEl = qs('#attachmentsList');
  if (!listEl) return;
  if (!protocol) {
    listEl.innerHTML = '<div class="empty">Nenhum protocolo disponível para buscar anexos.</div>';
    return;
  }

  if (!force && Array.isArray(state?.attachments) && state.attachments.length) {
    renderAttachments(state);
    return;
  }

  const token = ++attachmentsRequestToken;
  listEl.innerHTML = '<div class="empty">Buscando anexos...</div>';

  try {
    const attachments = await fetchR2Attachments(protocol);
    if (token != attachmentsRequestToken) return;
    if (currentState && normalizeProtocol(currentState?.protocol || currentState?.ticketDisplay || currentState?.ticketId || '') === protocol) {
      currentState.attachments = attachments;
    }
    renderAttachments({ ...(currentState || state || {}), attachments });
  } catch {
    if (token != attachmentsRequestToken) return;
    listEl.innerHTML = '<div class="empty">Não foi possível carregar os anexos.</div>';
  }
}

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function field(label, value, full = false, locked = false) {
  return `<div class="field ${full ? 'full' : ''} ${locked ? 'locked' : ''}"><label>${escapeHtml(label)}</label><div>${escapeHtml(value || '—')}</div></div>`;
}
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] || null;
}
async function loadStateForActiveTab() {
  const tab = await getActiveTab();
  currentTabId = tab?.id || null;

  if (!currentTabId || !DESK_URL_RE.test(String(tab?.url || ''))) {
    render(null, false);
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_CONTEXT', tabId: currentTabId });
  render(response?.payload || null, true);
}
function setStatus(text, kind = 'muted') {
  const box = qs('#statusBox');
  if (!box) return;
  if (!text) {
    box.className = 'status hidden';
    box.textContent = '';
    return;
  }
  box.className = `status ${kind}`;
  box.textContent = text;
}

function showValidatorLoader(show) {
  const loader = qs('#validatorLoader');
  if (!loader) return;
  loader.classList.toggle('hidden', !show);
}
let validatorLoadTimer = null;
function armValidatorLoaderTimeout() {
  clearTimeout(validatorLoadTimer);
  validatorLoadTimer = setTimeout(() => showValidatorLoader(false), 15000);
}
function renderValidator(state) {
  const frame = qs('#validatorFrame');
  const empty = qs('#validatorEmpty');
  const shell = qs('#validatorShell');
  const url = state?.validatorUrl || '';
  if (!url) {
    empty.style.display = 'block';
    if (shell) shell.style.display = 'none';
    frame.style.display = 'none';
    frame.removeAttribute('src');
    showValidatorLoader(false);
    clearTimeout(validatorLoadTimer);
    return;
  }
  empty.style.display = 'none';
  if (shell) shell.style.display = 'block';
  if (frame.src !== url) {
    showValidatorLoader(true);
    armValidatorLoaderTimeout();
    frame.src = url;
  }
  frame.style.display = 'block';
}
function renderCustomer(state) {
  const c = state?.customer || {};
  qs('#customerGrid').innerHTML = [
    field('Nome', c.nome || c.name, true, true),
    field('CPF', c.cpf || c.document, false, true),
    field('Telefone', c.telefone || c.phone),
    field('Telefone 2', c.phoneOutro2),
    field('E-mail', c.email, true),
    field('Cidade', c.cidade || c.city, false, true),
    field('UF', c.uf || c.estado, false, true),
    field('CEP', c.cep),
    field('Bairro', c.bairro),
    field('Endereço', c.endereco || c.logradouro, true),
    field('Complemento', c.complemento),
    field('Referência', c.pontoReferencia),
  ].join('');
}
function renderAttachments(state) {
  const items = Array.isArray(state?.attachments) ? state.attachments : [];
  const galleryItems = items
    .filter((item) => {
      const name = item.nome || item.name || '';
      return (item.url || item.href) && isImageAttachment(name, item.tipo || item.type || '');
    })
    .map((item) => ({
      src: item.url || item.href || '',
      name: item.nome || item.name || 'Arquivo'
    }));

  qs('#attachmentsList').innerHTML = items.length ? items.map((item) => {
    const name = item.nome || item.name || 'Arquivo';
    const href = item.url || item.href || '';
    const meta = [item.titulo || '', item.tipo || item.type || '', formatBytes(item.tamanho)].filter(Boolean).join(' • ');
    const canPreview = href && isImageAttachment(name, item.tipo || item.type || '');
    const galleryIndex = canPreview ? galleryItems.findIndex((galleryItem) => galleryItem.src === href) : -1;
    const preview = canPreview
      ? `<div class="attachment-thumb-wrap" data-preview-src="${escapeHtml(href)}" data-preview-name="${escapeHtml(name)}" data-preview-index="${galleryIndex}" title="Clique para ampliar">
          <img class="attachment-thumb" src="${escapeHtml(href)}" alt="${escapeHtml(name)}" loading="lazy" />
        </div>`
      : '';

    return `
      <div class="card attachment-card">
        ${preview}
        <div class="card-title">${escapeHtml(name)}</div>
        <div class="card-sub">${escapeHtml(meta || 'Arquivo disponível')}</div>
      </div>
    `;
  }).join('') : '<div class="empty">Nenhum arquivo encontrado para este protocolo.</div>';
}

function renderSchedule(state) {
  const s = state?.schedule || {};
  qs('#scheduleGrid').innerHTML = [
    field('Data', s.data || s.date),
    field('Hora', s.hora || s.time),
    field('Canal', s.canal || s.channel),
    field('Responsável', s.responsavel || s.owner),
  ].join('');
}
function render(state, isDeskTab = true) {
  currentState = state;
  const protocolValueEl = qs('#protocolValue');
  if (protocolValueEl) protocolValueEl.textContent = state?.protocol || state?.ticketDisplay || '···';

  if (!isDeskTab) {
    setStatus('Este painel só funciona nas páginas do Blip Desk.', 'muted');
    renderValidator(null);
    renderCustomer(null);
    renderAttachments(null);
    renderSchedule(null);
    return;
  }

  if (!state?.ticketId) {
    setStatus('Selecione um ticket no Blip Desk para carregar os dados.', 'muted');
  } else if (state?.error) {
    setStatus(state.error, 'error');
  } else if (state?.loading) {
    setStatus('Carregando dados do ticket…', 'muted');
  } else {
    setStatus('');
  }

  renderValidator(state);
  renderCustomer(state);
  renderAttachments(state);
  if (activeTab === 'anexo' && isDeskTab) ensureAttachmentsLoaded(state).catch(() => {});
  renderSchedule(state);
}
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((el) => el.classList.toggle('active', el.id === `tab-${tab}`));
  if (tab === 'anexo') ensureAttachmentsLoaded(currentState, { force: true }).catch(() => {});
}

const validatorFrame = qs('#validatorFrame');
if (validatorFrame) {
  validatorFrame.addEventListener('load', () => {
    clearTimeout(validatorLoadTimer);
    showValidatorLoader(false);
  });
  validatorFrame.addEventListener('error', () => {
    clearTimeout(validatorLoadTimer);
    showValidatorLoader(false);
  });
}

document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
let copyFeedbackTimer = null;
qs('#copyProtocolBtn').addEventListener('click', async () => {
  const value = currentState?.protocol || currentState?.ticketDisplay || '';
  if (!value) return;
  const toast = qs('#copyToast');
  let copied = false;
  try {
    await navigator.clipboard.writeText(value);
    copied = true;
  } catch {}

  if (toast) {
    toast.textContent = copied ? 'Protocolo copiado' : 'Falha ao copiar';
    toast.classList.add('show');
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 1400);
  }
});
qs('#refreshBtn').addEventListener('click', async () => {
  const tab = await getActiveTab();
  currentTabId = tab?.id || null;

  if (!currentTabId || !DESK_URL_RE.test(String(tab?.url || ''))) {
    render(null, false);
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'REFRESH_TAB_CONTEXT',
      tabId: currentTabId,
      forceReload: true,
      reason: 'sidepanel-refresh'
    });
  } catch {}

  setTimeout(() => {
    loadStateForActiveTab().catch(() => {});
  }, 250);
});

const attachmentsList = qs('#attachmentsList');
if (attachmentsList) {
  attachmentsList.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-preview-src]');
    if (!trigger) return;
    const items = (currentState?.attachments || [])
      .filter((item) => isImageAttachment(item.nome || item.name || '', item.tipo || item.type || '') && (item.url || item.href))
      .map((item) => ({ src: item.url || item.href || '', name: item.nome || item.name || 'Arquivo' }));

    const openedInPage = await openAttachmentPreviewInPage(items, Number(trigger.dataset.previewIndex || 0));
    if (!openedInPage) {
      openImageModal(trigger.dataset.previewSrc || '', trigger.dataset.previewName || '', items, Number(trigger.dataset.previewIndex || 0));
    }
  });
}

const imageModal = qs('#imageModal');
if (imageModal) {
  imageModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-modal="true"]') || event.target.id === 'imageModalClose') {
      closeImageModal();
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeImageModal();
  else if (event.key === 'ArrowLeft' && !qs('#imageModal')?.classList.contains('hidden')) changeModalImage(-1);
  else if (event.key === 'ArrowRight' && !qs('#imageModal')?.classList.contains('hidden')) changeModalImage(1);
  else if ((event.key === '+' || event.key === '=') && !qs('#imageModal')?.classList.contains('hidden')) setModalZoom(modalZoom + 0.2);
  else if (event.key === '-' && !qs('#imageModal')?.classList.contains('hidden')) setModalZoom(modalZoom - 0.2);
});


const modalPrevBtn = qs('#imageModalPrev');
if (modalPrevBtn) modalPrevBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  changeModalImage(-1);
});
const modalNextBtn = qs('#imageModalNext');
if (modalNextBtn) modalNextBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  changeModalImage(1);
});
const modalImage = qs('#imageModalImg');
const modalWrap = qs('.modal-image-wrap');
if (modalImage && modalWrap) {
  modalImage.addEventListener('click', (event) => {
    event.stopPropagation();
    setModalZoom(modalZoom > 1 ? 1 : 2);
  });
  modalWrap.addEventListener('wheel', (event) => {
    if (qs('#imageModal')?.classList.contains('hidden')) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.2 : -0.2;
    setModalZoom(modalZoom + delta);
  }, { passive: false });
  modalImage.addEventListener('mousedown', (event) => {
    if (modalZoom <= 1) return;
    modalDragState = { x: event.clientX, y: event.clientY, left: modalWrap.scrollLeft, top: modalWrap.scrollTop };
    modalImage.classList.add('is-dragging');
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event) => {
    if (!modalDragState || modalZoom <= 1) return;
    modalWrap.scrollLeft = modalDragState.left - (event.clientX - modalDragState.x);
    modalWrap.scrollTop = modalDragState.top - (event.clientY - modalDragState.y);
  });
  window.addEventListener('mouseup', () => {
    modalDragState = null;
    modalImage.classList.remove('is-dragging');
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'DESK_CONTEXT_BROADCAST') return;
  if (!currentTabId || msg.payload?.tabId !== currentTabId) return;
  render(msg.payload || null, true);
});

chrome.tabs.onActivated.addListener(() => { loadStateForActiveTab().catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === currentTabId && (changeInfo.status === 'complete' || changeInfo.url)) {
    loadStateForActiveTab().catch(() => {});
  }
});

switchTab(activeTab);
loadStateForActiveTab().catch(() => {
  setStatus('Não foi possível carregar o painel lateral.', 'error');
});
