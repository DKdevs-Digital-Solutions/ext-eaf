
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
const WFE_BASE_URL = 'https://wfe.services.dkdevs.com.br';
const WFE_API_KEY = "(2>7N7G?r{?y9(Ya:h%LfAIJ%}m?KDOlKPQUEj!8Na6";
const attachmentCache = new Map();
const ticketCache = new Map();
const availabilityCache = new Map();
let attachmentsRequestToken = 0;
let ticketRequestToken = 0;
let availabilitiesRequestToken = 0;
let modalGalleryItems = [];
let modalGalleryIndex = -1;
let modalZoom = 1;
let modalDragState = null;

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function normalizeDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}
function normalizeProtocol(value) {
  return String(value || '').trim();
}
function normalizePostalCode(value) {
  return normalizeDigits(value).slice(0, 8);
}
function isBlank(value) {
  return value == null || String(value).trim() === '';
}
function coalesce(...values) {
  for (const value of values) {
    if (!isBlank(value)) return String(value).trim();
  }
  return '';
}
function deepFind(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  const queue = [obj];
  const seen = new Set();
  const lowered = keys.map((k) => String(k).toLowerCase());
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      const lk = String(key).toLowerCase();
      if (lowered.includes(lk) && value != null && (typeof value !== 'object' || Array.isArray(value))) {
        return value;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return '';
}
function field(label, value, full = false, locked = false) {
  return `<div class="field ${full ? 'full' : ''} ${locked ? 'locked' : ''}"><label>${escapeHtml(label)}</label><div>${escapeHtml(value || '—')}</div></div>`;
}
function buildAttachmentUrl(protocol, fileName) {
  return `${R2_BASE_URL}/${encodeURIComponent(protocol)}/${encodeURIComponent(fileName)}`;
}
function isImageAttachment(name, type = '') {
  return /^image\//i.test(type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(name || ''));
}
async function headAttachment(url) {
  const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  return response;
}

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

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1).replace('.0', '')} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace('.0', '')} MB`;
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

async function ensureAttachmentsLoaded(state, { force = false } = {}) {
  const protocol = normalizeProtocol(state?.protocol || state?.ticketApi?.protocolNumber || state?.ticketDisplay || state?.ticketId || '');
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
  listEl.innerHTML = '<div class="empty">Buscando anexos no R2...</div>';
  try {
    const attachments = await fetchR2Attachments(protocol);
    if (token !== attachmentsRequestToken) return;
    if (currentState && normalizeProtocol(currentState?.protocol || currentState?.ticketApi?.protocolNumber || '') === protocol) {
      currentState.attachments = attachments;
    }
    renderAttachments({ ...(currentState || state || {}), attachments });
  } catch {
    if (token !== attachmentsRequestToken) return;
    listEl.innerHTML = '<div class="empty">Não foi possível carregar os anexos.</div>';
  }
}

async function apiRequest(path, options = {}) {
  const url = path.startsWith('http') ? path : `${WFE_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  headers.set('x-api-key', WFE_API_KEY);
  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  let body = null;
  try {
    body = contentType.includes('application/json') ? await response.json() : await response.text();
  } catch {}
  if (!response.ok) {
    const message = typeof body === 'string' && body ? body : (body?.message || body?.error || `HTTP ${response.status}`);
    throw new Error(message);
  }
  return body;
}

function normalizeTicketPayload(raw, fallbackCustomer = {}) {
  const customerNode = raw?.customer && typeof raw.customer === 'object' ? raw.customer : raw;
  const postalCode = coalesce(
    customerNode?.postalCode,
    customerNode?.cep,
    customerNode?.zipCode,
    deepFind(raw, ['postalCode', 'postal-code', 'cep', 'zipCode'])
  );
  const number = coalesce(customerNode?.number, customerNode?.numero, deepFind(raw, ['number', 'numero']));
  const logradouro = coalesce(customerNode?.logradouro, customerNode?.street, deepFind(raw, ['logradouro', 'street']));
  const complemento = coalesce(customerNode?.complemento, customerNode?.complement, deepFind(raw, ['complemento', 'complement']));
  const bairro = coalesce(customerNode?.bairro, customerNode?.district, customerNode?.neighborhood, deepFind(raw, ['bairro', 'district', 'neighborhood']));
  const endereco = coalesce(customerNode?.endereco, customerNode?.address, deepFind(raw, ['endereco', 'address']));
  const uuid = coalesce(customerNode?.uuid, customerNode?.id, deepFind(raw, ['uuid', 'customerUuid', 'customerUUID']));
  const protocolNumber = coalesce(raw?.protocolNumber, raw?.protocol, deepFind(raw, ['protocolNumber', 'protocol']));
  const ibgeCode = coalesce(raw?.ibgeCode, customerNode?.ibgeCode, deepFind(raw, ['ibgeCode', 'ibgecode']));
  const customer = {
    nome: coalesce(customerNode?.name, customerNode?.nome, fallbackCustomer?.nome, fallbackCustomer?.name),
    name: coalesce(customerNode?.name, customerNode?.nome, fallbackCustomer?.name, fallbackCustomer?.nome),
    cpf: coalesce(customerNode?.document, customerNode?.cpf, fallbackCustomer?.cpf, fallbackCustomer?.document),
    document: coalesce(customerNode?.document, customerNode?.cpf, fallbackCustomer?.document, fallbackCustomer?.cpf),
    telefone: coalesce(customerNode?.phone, customerNode?.telefone, fallbackCustomer?.telefone, fallbackCustomer?.phone),
    phone: coalesce(customerNode?.phone, customerNode?.telefone, fallbackCustomer?.phone, fallbackCustomer?.telefone),
    phoneOutro2: coalesce(customerNode?.phoneOutro2, fallbackCustomer?.phoneOutro2),
    email: coalesce(customerNode?.email, fallbackCustomer?.email),
    cidade: coalesce(customerNode?.city, customerNode?.cidade, fallbackCustomer?.cidade, fallbackCustomer?.city),
    city: coalesce(customerNode?.city, customerNode?.cidade, fallbackCustomer?.city, fallbackCustomer?.cidade),
    uf: coalesce(customerNode?.uf, customerNode?.state, fallbackCustomer?.uf, fallbackCustomer?.estado),
    estado: coalesce(customerNode?.uf, customerNode?.state, fallbackCustomer?.estado, fallbackCustomer?.uf),
    cep: postalCode || fallbackCustomer?.cep || '',
    bairro: bairro || fallbackCustomer?.bairro || '',
    logradouro: logradouro || fallbackCustomer?.logradouro || '',
    endereco: endereco || fallbackCustomer?.endereco || '',
    complemento: complemento || fallbackCustomer?.complemento || '',
    number: number || fallbackCustomer?.number || fallbackCustomer?.numero || '',
    numero: number || fallbackCustomer?.numero || fallbackCustomer?.number || '',
    pontoReferencia: coalesce(customerNode?.reference, customerNode?.pontoReferencia, fallbackCustomer?.pontoReferencia),
    uuid,
    protocolNumber,
    ibgeCode,
  };
  return { raw, customer, customerUuid: uuid, protocolNumber, ibgeCode };
}

function getEffectiveCustomer(state) {
  const base = state?.customer || {};
  const fromApi = state?.ticketApi?.customer || {};
  return {
    ...base,
    ...fromApi,
    nome: coalesce(fromApi.nome, fromApi.name, base.nome, base.name),
    name: coalesce(fromApi.name, fromApi.nome, base.name, base.nome),
    cpf: coalesce(fromApi.cpf, fromApi.document, base.cpf, base.document),
    document: coalesce(fromApi.document, fromApi.cpf, base.document, base.cpf),
    telefone: coalesce(fromApi.telefone, fromApi.phone, base.telefone, base.phone),
    phone: coalesce(fromApi.phone, fromApi.telefone, base.phone, base.telefone),
    cidade: coalesce(fromApi.cidade, fromApi.city, base.cidade, base.city),
    city: coalesce(fromApi.city, fromApi.cidade, base.city, base.cidade),
    uf: coalesce(fromApi.uf, fromApi.estado, base.uf, base.estado),
    estado: coalesce(fromApi.estado, fromApi.uf, base.estado, base.uf),
    cep: coalesce(fromApi.cep, base.cep),
    bairro: coalesce(fromApi.bairro, base.bairro),
    logradouro: coalesce(fromApi.logradouro, base.logradouro),
    endereco: coalesce(fromApi.endereco, base.endereco, fromApi.logradouro, base.logradouro),
    complemento: coalesce(fromApi.complemento, base.complemento),
    number: coalesce(fromApi.number, fromApi.numero, base.number, base.numero),
    numero: coalesce(fromApi.numero, fromApi.number, base.numero, base.number),
    pontoReferencia: coalesce(fromApi.pontoReferencia, base.pontoReferencia),
    uuid: coalesce(fromApi.uuid, base.uuid, state?.ticketApi?.customerUuid),
    protocolNumber: coalesce(fromApi.protocolNumber, state?.ticketApi?.protocolNumber, base.protocol, state?.protocol),
    ibgeCode: coalesce(fromApi.ibgeCode, state?.ticketApi?.ibgeCode, base.ibgeCode),
  };
}

function getCurrentDocument(state) {
  const customer = getEffectiveCustomer(state || currentState || {});
  return normalizeDigits(customer.document || customer.cpf);
}

async function ensureTicketDataLoaded(state, { force = false } = {}) {
  const document = getCurrentDocument(state);
  if (!document) return;
  if (!force && state?.ticketApi?.document === document) return;
  if (!force && ticketCache.has(document)) {
    const cached = ticketCache.get(document);
    if (currentState) {
      currentState.ticketApi = { ...cached, document };
      currentState.protocol = cached.protocolNumber || currentState.ticketDisplay || '';
      currentState.customer = { ...(cached.customer || {}) };
      renderCustomer(currentState);
      renderSchedule(currentState);
    }
    return;
  }
  const token = ++ticketRequestToken;
  try {
    const raw = await apiRequest(`/proxy/ticket?document=${encodeURIComponent(document)}`, { method: 'GET' });
    if (token !== ticketRequestToken) return;
    const normalized = normalizeTicketPayload(raw, state?.customer || {});
    const payload = { ...normalized, document };
    ticketCache.set(document, payload);
    if (!currentState) return;
    currentState.ticketApi = payload;
    currentState.protocol = normalized.protocolNumber || currentState.ticketDisplay || '';
    currentState.customer = { ...(normalized.customer || {}) };
    renderCustomer(currentState);
    renderSchedule(currentState);
  } catch (error) {
    if (token !== ticketRequestToken) return;
    if (currentState) {
      currentState.ticketApiError = error?.message || 'Falha ao consultar a API de ticket.';
      if (activeTab === 'cliente') renderCustomer(currentState);
      if (activeTab === 'agendamento') renderSchedule(currentState);
    }
  }
}

function needsAddressCompletion(customer) {
  return [customer?.logradouro, customer?.bairro, customer?.complemento].some(isBlank);
}

function renderCustomer(state) {
  const c = getEffectiveCustomer(state);
  const ticketApiError = state?.ticketApiError ? `<div class="empty warning">${escapeHtml(state.ticketApiError)}</div>` : '';
  qs('#customerGrid').innerHTML = `
    ${ticketApiError}
    ${renderAddressForm(c)}
  `;
}

function renderAddressForm(customer) {
  const canFillAddress = needsAddressCompletion(customer);
  const logradouroFilled = !isBlank(customer.logradouro);
  const bairroFilled = !isBlank(customer.bairro);
  const complementoFilled = !isBlank(customer.complemento);
  const numberFilled = !isBlank(customer.number || customer.numero);
  const cepEditable = !canFillAddress;

  return `
    <form id="customerAddressForm" class="form-card compact-stack customer-layout-card">
      <div class="form-grid distributed customer-form-grid customer-pairs-grid">
        <label class="input-group disabled span-2">
          <span>Nome</span>
          <input value="${escapeHtml(customer.nome || customer.name || '')}" disabled />
        </label>
        <label class="input-group disabled">
          <span>CPF</span>
          <input value="${escapeHtml(customer.cpf || customer.document || '')}" disabled />
        </label>
        <label class="input-group disabled">
          <span>Telefone</span>
          <input value="${escapeHtml(customer.telefone || customer.phone || '')}" disabled />
        </label>
        <label class="input-group disabled">
          <span>Telefone 2</span>
          <input value="${escapeHtml(customer.phoneOutro2 || '')}" disabled />
        </label>
        <label class="input-group disabled">
          <span>E-mail</span>
          <input value="${escapeHtml(customer.email || '')}" disabled />
        </label>
        <label class="input-group disabled">
          <span>Cidade</span>
          <input value="${escapeHtml(customer.cidade || customer.city || '')}" disabled />
        </label>
        <label class="input-group disabled">
          <span>UF</span>
          <input value="${escapeHtml(customer.uf || customer.estado || '')}" disabled />
        </label>
        <label class="input-group ${cepEditable ? 'editable' : 'disabled'}">
          <span>CEP</span>
          <input name="cep" value="${escapeHtml(customer.cep || '')}" ${cepEditable ? '' : 'disabled'} />
        </label>
        <label class="input-group ${canFillAddress && !bairroFilled ? 'editable' : 'disabled'}">
          <span>Bairro</span>
          <input name="bairro" value="${escapeHtml(customer.bairro || '')}" ${(canFillAddress && !bairroFilled) ? '' : 'disabled'} />
        </label>
        <label class="input-group ${canFillAddress && !logradouroFilled ? 'editable' : 'disabled'}">
          <span>Logradouro</span>
          <input name="logradouro" value="${escapeHtml(customer.logradouro || '')}" ${(canFillAddress && !logradouroFilled) ? '' : 'disabled'} />
        </label>
        <label class="input-group ${canFillAddress && !numberFilled ? 'editable' : 'disabled'}">
          <span>Número</span>
          <input name="number" value="${escapeHtml(customer.number || customer.numero || '')}" ${(canFillAddress && !numberFilled) ? '' : 'disabled'} />
        </label>
        <label class="input-group ${canFillAddress && !complementoFilled ? 'editable' : 'disabled'} span-2">
          <span>Complemento</span>
          <input name="complemento" value="${escapeHtml(customer.complemento || '')}" ${(canFillAddress && !complementoFilled) ? '' : 'disabled'} />
        </label>
        <label class="input-group disabled span-2">
          <span>Referência</span>
          <input value="${escapeHtml(customer.pontoReferencia || '')}" disabled />
        </label>
      </div>
      <button class="primary-btn" type="submit">Salvar alteração</button>
      <div id="customerAddressFeedback" class="mini-feedback"></div>
    </form>
  `;
}

function renderAttachments(state) {
  const items = Array.isArray(state?.attachments) ? state.attachments : [];
  const galleryItems = items
    .filter((item) => {
      const name = item.nome || item.name || '';
      return (item.url || item.href) && isImageAttachment(name, item.tipo || item.type || '');
    })
    .map((item) => ({ src: item.url || item.href || '', name: item.nome || item.name || 'Arquivo' }));

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
    return `<div class="card attachment-card">${preview}<div class="card-title">${escapeHtml(name)}</div><div class="card-sub">${escapeHtml(meta || 'Arquivo disponível')}</div></div>`;
  }).join('') : '<div class="empty">Nenhum arquivo encontrado para este protocolo.</div>';
}

function scheduleRequestKey(state) {
  const customer = getEffectiveCustomer(state);
  const postalCode = normalizePostalCode(customer.cep);
  const protocol = normalizeProtocol(state?.ticketApi?.protocolNumber || customer.protocolNumber || state?.protocol || state?.ticketDisplay || '');
  return postalCode && protocol ? `${postalCode}:${protocol}` : '';
}

async function ensureAvailabilitiesLoaded(state, { force = false } = {}) {
  const key = scheduleRequestKey(state);
  const customer = getEffectiveCustomer(state);
  const postalCode = normalizePostalCode(customer.cep);
  const protocol = normalizeProtocol(state?.ticketApi?.protocolNumber || customer.protocolNumber || state?.protocol || state?.ticketDisplay || '');
  if (!postalCode || !protocol) return;
  if (!force && state?.scheduleOptionsLoaded) return;
  if (!force && availabilityCache.has(key)) {
    const cached = availabilityCache.get(key);
    currentState.scheduleOptions = cached;
    currentState.scheduleOptionsLoaded = true;
    renderSchedule(currentState);
    return;
  }
  const token = ++availabilitiesRequestToken;
  currentState.scheduleLoading = true;
  renderSchedule(currentState);
  try {
    const raw = await apiRequest(`/proxy/capacity/availabilities?postalCode=${encodeURIComponent(postalCode)}&protocol=${encodeURIComponent(protocol)}`, { method: 'GET' });
    if (token !== availabilitiesRequestToken) return;
    const schedules = Array.isArray(raw?.data?.schedules) ? raw.data.schedules : (Array.isArray(raw?.schedules) ? raw.schedules : []);
    availabilityCache.set(key, schedules);
    currentState.scheduleOptions = schedules;
    currentState.scheduleOptionsLoaded = true;
    currentState.scheduleLoading = false;
    currentState.scheduleError = '';
    if (!currentState.selectedScheduleDate && schedules[0]?.date) currentState.selectedScheduleDate = schedules[0].date;
    renderSchedule(currentState);
  } catch (error) {
    if (token !== availabilitiesRequestToken) return;
    currentState.scheduleLoading = false;
    currentState.scheduleError = error?.message || 'Falha ao carregar datas disponíveis.';
    renderSchedule(currentState);
  }
}

function formatScheduleDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR');
}

function renderSchedule(state) {
  const root = qs('#scheduleGrid');
  if (!root) return;
  const options = Array.isArray(state?.scheduleOptions) ? state.scheduleOptions : [];
  const selectedDate = state?.selectedScheduleDate || '';
  const successMessage = state?.scheduleSuccess ? `<div class="empty success">${escapeHtml(state.scheduleSuccess)}</div>` : '';
  let body = successMessage;

  if (state?.scheduleLoading) {
    body += '<div class="empty">Buscando datas disponíveis...</div>';
  } else if (state?.scheduleError) {
    body += `<div class="empty warning">${escapeHtml(state.scheduleError)}</div>`;
  } else if (!state?.scheduleOptionsLoaded) {
    body += `
      <div class="form-card compact-stack">
        <div class="form-title">Agendamento</div>
        <div class="form-help">Clique no botão abaixo para consultar as datas disponíveis.</div>
        <button id="startScheduleBtn" class="primary-btn" type="button">Iniciar agendamento</button>
        <div id="scheduleFeedback" class="mini-feedback"></div>
      </div>
    `;
  } else if (!options.length) {
    body += `
      <div class="form-card compact-stack">
        <div class="form-title">Agendamento</div>
        <div class="form-help">Nenhuma data disponível encontrada.</div>
        <button id="startScheduleBtn" class="primary-btn" type="button">Buscar novamente</button>
      </div>
    `;
  } else {
    body += `
      <form id="scheduleForm" class="form-card compact-stack">
        <div class="form-title">Escolha uma data</div>
        <div class="schedule-options">${options.map((item, index) => `
          <label class="schedule-option">
            <input type="radio" name="scheduleDate" value="${escapeHtml(item.date || '')}" ${selectedDate === item.date || (!selectedDate && index === 0) ? 'checked' : ''} />
            <div>
              <strong>${escapeHtml(formatScheduleDate(item.date || ''))}</strong>
            </div>
          </label>
        `).join('')}</div>
        <div class="schedule-actions schedule-actions-single">
          <button class="primary-btn" type="submit">Agendar</button>
          <button id="resetScheduleBtn" class="secondary-btn" type="button">Cancelar agendamento</button>
        </div>
        <div id="scheduleFeedback" class="mini-feedback">${selectedDate ? `Data selecionada: ${escapeHtml(formatScheduleDate(selectedDate))}` : ''}</div>
      </form>
    `;
  }

  root.innerHTML = body;
}

function buildContextKey(state) {
  const customer = state?.customer || {};
  return [
    normalizeProtocol(state?.protocol || state?.ticketDisplay || ''),
    normalizeProtocol(state?.ticketId || ''),
    normalizeDigits(customer.document || customer.cpf || ''),
    normalizeDigits(customer.phone || customer.telefone || ''),
    coalesce(customer.name, customer.nome),
  ].join('|');
}

function render(state, isDeskTab = true) {
  const nextContextKey = buildContextKey(state || {});
  const previousContextKey = buildContextKey(currentState || {});
  const tabChanged = (state?.tabId && currentState?.tabId && state.tabId !== currentState.tabId)
    || (state?.ticketId && currentState?.ticketId && state.ticketId !== currentState.ticketId);
  const contextChanged = !!nextContextKey && !!previousContextKey && nextContextKey !== previousContextKey;
  const shouldReset = tabChanged || contextChanged;
  const incomingCustomer = state?.customer || {};
  const preservedTicketApi = shouldReset ? null : (state?.ticketApi || currentState?.ticketApi || null);
  const preservedCustomer = shouldReset
    ? incomingCustomer
    : ((state?.loading && !Object.keys(incomingCustomer || {}).length)
        ? incomingCustomer
        : { ...(currentState?.customer || {}), ...incomingCustomer });
  currentState = {
    ...(state || {}),
    customer: preservedCustomer,
    ticketApi: preservedTicketApi,
    attachments: shouldReset ? (state?.attachments || []) : (state?.attachments || currentState?.attachments || []),
    scheduleOptions: shouldReset ? [] : (state?.scheduleOptions || currentState?.scheduleOptions || []),
    selectedScheduleDate: shouldReset ? '' : (state?.selectedScheduleDate || currentState?.selectedScheduleDate || ''),
    scheduleLoading: shouldReset ? false : (state?.scheduleLoading ?? currentState?.scheduleLoading ?? false),
    scheduleOptionsLoaded: shouldReset ? false : (state?.scheduleOptionsLoaded || currentState?.scheduleOptionsLoaded || false),
    scheduleError: '',
    ticketApiError: '',
    contextKey: nextContextKey,
  };
  const protocolValueEl = qs('#protocolValue');
  if (protocolValueEl) protocolValueEl.textContent = currentState?.protocol || currentState?.ticketApi?.protocolNumber || currentState?.ticketDisplay || '···';

  if (!isDeskTab) {
    setStatus('Este painel só funciona nas páginas do Blip Desk.', 'muted');
    renderValidator(null);
    renderCustomer(null);
    renderAttachments(null);
    renderSchedule(null);
    return;
  }
  if (!currentState?.ticketId) {
    setStatus('Selecione um ticket no Blip Desk para carregar os dados.', 'muted');
  } else if (currentState?.error) {
    setStatus(currentState.error, 'error');
  } else if (currentState?.loading) {
    setStatus('Carregando dados do ticket…', 'muted');
  } else {
    setStatus('');
  }
  renderValidator(currentState);
  renderCustomer(currentState);
  renderAttachments(currentState);
  renderSchedule(currentState);
  if (activeTab === 'anexo' && isDeskTab) ensureAttachmentsLoaded(currentState).catch(() => {});
  if (currentState?.ticketId) ensureTicketDataLoaded(currentState).catch(() => {});
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

async function updateCustomerAddress(formData) {
  const customer = getEffectiveCustomer(currentState);
  const canFillAddress = needsAddressCompletion(customer);
  const payload = canFillAddress
    ? {
        logradouro: formData.get('logradouro') || customer.logradouro || '',
        bairro: formData.get('bairro') || customer.bairro || '',
        complemento: formData.get('complemento') || customer.complemento || '',
        number: formData.get('number') || customer.number || customer.numero || '',
        numero: formData.get('number') || customer.number || customer.numero || '',
        cep: formData.get('cep') || customer.cep || '',
      }
    : {
        cep: formData.get('cep') || customer.cep || '',
      };
  currentState.customer = { ...(currentState.customer || {}), ...payload };
  if (currentState.ticketApi?.customer) {
    currentState.ticketApi.customer = { ...(currentState.ticketApi.customer || {}), ...payload };
  }
  currentState.ticketApiError = '';
  renderCustomer(currentState);
  return { ok: true, payload, mode: canFillAddress ? 'address-completion' : 'cep-only' };
}

async function submitSelectedSchedule(cancel = false) {
  const customer = getEffectiveCustomer(currentState);
  const protocol = normalizeProtocol(currentState?.ticketApi?.protocolNumber || customer.protocolNumber || currentState?.protocol || currentState?.ticketDisplay || '');
  const options = Array.isArray(currentState?.scheduleOptions) ? currentState.scheduleOptions : [];
  const selectedDate = currentState?.selectedScheduleDate || options[0]?.date || '';
  const selected = options.find((item) => item.date === selectedDate) || options[0];
  if (!protocol || !options.length) throw new Error('Nenhuma data disponível para enviar.');
  if (!cancel && !selected?.date) throw new Error('Selecione uma data disponível.');
  const payload = {
    ibgeCode: selected?.ibgeCode || options[0]?.ibgeCode || customer.ibgeCode || currentState?.ticketApi?.ibgeCode || '',
    priority: 1,
    protocolNumber: protocol,
    reasonPriority: cancel ? 'Cancelamento de agendamento' : 'Agendamento de instalação',
    schedules: options.map((item) => ({
      chose: cancel ? false : item.date === selectedDate,
      date: item.date,
      installer: item.installer,
    })),
    tabulation: cancel ? 'Cancelamento' : 'Agendamento'
  };
  await apiRequest('/proxy/service-order/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (cancel) {
    currentState.schedule = null;
    currentState.selectedScheduleDate = '';
    currentState.scheduleSuccess = 'Agendamento cancelado com sucesso.';
  } else {
    currentState.schedule = {
      ...(currentState.schedule || {}),
      data: selectedDate,
      date: selectedDate,
      owner: selected?.installer || '',
      responsavel: selected?.installer || ''
    };
    currentState.scheduleSuccess = `Agendamento realizado com sucesso para ${formatScheduleDate(selectedDate)}.`;
  }
  renderSchedule(currentState);
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
function resetScheduleState() {
  if (!currentState) return;
  currentState.selectedScheduleDate = '';
  currentState.scheduleOptions = [];
  currentState.scheduleOptionsLoaded = false;
  currentState.scheduleLoading = false;
  currentState.scheduleError = '';
  currentState.scheduleSuccess = '';
}

function switchTab(tab) {
  const previousTab = activeTab;
  if (previousTab === 'agendamento' && tab !== 'agendamento') {
    resetScheduleState();
  }
  activeTab = tab;
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((el) => el.classList.toggle('active', el.id === `tab-${tab}`));
  if (tab === 'anexo') ensureAttachmentsLoaded(currentState, { force: true }).catch(() => {});
  if (tab === 'cliente') ensureTicketDataLoaded(currentState, { force: false }).catch(() => {});
  if (tab === 'agendamento') {
    ensureTicketDataLoaded(currentState, { force: false }).catch(() => {});
    renderSchedule(currentState);
  }
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
  const value = currentState?.protocol || currentState?.ticketApi?.protocolNumber || currentState?.ticketDisplay || '';
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
    copyFeedbackTimer = setTimeout(() => toast.classList.remove('show'), 1400);
  }
});
qs('#refreshBtn').addEventListener('click', async () => {
  const tab = await getActiveTab();
  currentTabId = tab?.id || null;
  if (!currentTabId || !DESK_URL_RE.test(String(tab?.url || ''))) {
    render(null, false);
    return;
  }
  if (currentState) {
    const document = getCurrentDocument(currentState);
    if (document) ticketCache.delete(document);
    availabilityCache.delete(scheduleRequestKey(currentState));
    currentState.scheduleOptionsLoaded = false;
  }
  try {
    await chrome.runtime.sendMessage({ type: 'REFRESH_TAB_CONTEXT', tabId: currentTabId, forceReload: true, reason: 'sidepanel-refresh' });
  } catch {}
  setTimeout(() => loadStateForActiveTab().catch(() => {}), 250);
});

document.addEventListener('click', async (event) => {
  if (event.target?.id === 'startScheduleBtn') {
    event.preventDefault();
    currentState.scheduleSuccess = '';
    await ensureTicketDataLoaded(currentState, { force: false });
    await ensureAvailabilitiesLoaded(currentState, { force: true });
    return;
  }
  if (event.target?.id === 'resetScheduleBtn') {
    event.preventDefault();
    resetScheduleState();
    renderSchedule(currentState);
    return;
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target?.id === 'customerAddressForm') {
    event.preventDefault();
    const feedback = qs('#customerAddressFeedback');
    if (feedback) feedback.textContent = 'Salvando endereço...';
    try {
      const result = await updateCustomerAddress(new FormData(event.target));
      if (feedback) feedback.textContent = result?.mode === 'address-completion' ? 'Dados salvos no painel. Envie a chamada da API para concluir a integração.' : 'CEP salvo no painel. Falta integrar a checagem de viabilidade/API final.';
      availabilityCache.delete(scheduleRequestKey(currentState));
      currentState.scheduleOptionsLoaded = false;
    } catch (error) {
      if (feedback) feedback.textContent = error?.message || 'Falha ao salvar endereço.';
    }
    return;
  }
  if (event.target?.id === 'scheduleForm') {
    event.preventDefault();
    const selected = event.target.querySelector('input[name="scheduleDate"]:checked');
    currentState.selectedScheduleDate = selected?.value || currentState.selectedScheduleDate || '';
    const feedback = qs('#scheduleFeedback');
    if (feedback) feedback.textContent = 'Enviando agendamento...';
    try {
      await submitSelectedSchedule();
      if (feedback) feedback.textContent = 'Agendamento enviado com sucesso.';
    } catch (error) {
      if (feedback) feedback.textContent = error?.message || 'Falha ao enviar agendamento.';
    }
  }
});

document.addEventListener('change', (event) => {
  if (event.target?.matches?.('input[name="scheduleDate"]')) {
    currentState.selectedScheduleDate = event.target.value || '';
    renderSchedule(currentState);
  }
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
    if (!openedInPage) openImageModal(trigger.dataset.previewSrc || '', trigger.dataset.previewName || '', items, Number(trigger.dataset.previewIndex || 0));
  });
}

const imageModal = qs('#imageModal');
if (imageModal) {
  imageModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-modal="true"]') || event.target.id === 'imageModalClose') closeImageModal();
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
if (modalPrevBtn) modalPrevBtn.addEventListener('click', (event) => { event.stopPropagation(); changeModalImage(-1); });
const modalNextBtn = qs('#imageModalNext');
if (modalNextBtn) modalNextBtn.addEventListener('click', (event) => { event.stopPropagation(); changeModalImage(1); });
const modalImage = qs('#imageModalImg');
const modalWrap = qs('.modal-image-wrap');
if (modalImage && modalWrap) {
  modalImage.addEventListener('click', (event) => { event.stopPropagation(); setModalZoom(modalZoom > 1 ? 1 : 2); });
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
  if (tabId === currentTabId && (changeInfo.status === 'complete' || changeInfo.url)) loadStateForActiveTab().catch(() => {});
});

switchTab(activeTab);
loadStateForActiveTab().catch(() => setStatus('Não foi possível carregar o painel lateral.', 'error'));
