(() => {
  if (window.__BLIP_PROD_HOOK__) return;
  window.__BLIP_PROD_HOOK__ = true;

  let enabled = false;
  let agentName = null;
  let settings = {};

  const socketState = {
    latestContact: null,
    byTicketId: new Map(),
    byIdentity: new Map(),
    ticketIdentity: new Map(),
    observedSockets: new WeakSet(),
    patched: false,
  };

  const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

  function loadAgentName() {
    try {
      const raw = localStorage.getItem("ajs_user_traits");
      if (!raw) return false;
      const traits = safeParse(raw);
      const name = traits?.name || traits?.user?.name || traits?.userName || traits?.fullName;
      if (!name) return false;
      agentName = String(name).trim();
      return !!agentName;
    } catch { return false; }
  }

  function isEnabledBySettings() {
    if (settings?.mode) return true;
    const mp = settings?.features?.messagePrefix;
    return !!mp?.enabled;
  }

  function isTaggingEnabled() {
    const tt = settings?.features?.ticketTagging;
    if (tt && typeof tt === "object") return !!tt.enabled;
    // fallback: se a chave não existir no settings, desabilita por padrão
    return false;
  }

  function getMode() {
    if (settings?.mode) return settings.mode;
    const mp = settings?.features?.messagePrefix;
    return mp?.mode || "bold_name_two_breaks";
  }

  function buildPrefix(name, mode) {
    switch (mode) {
      case "bold_name_two_breaks": return `<b>${name}</b>\n\n`;
      case "bold_name_one_break": return `<b>${name}</b>\n`;
      case "plain_name_two_breaks": return `${name}\n\n`;
      case "plain_name_one_break": return `${name}\n`;
      default: return `<b>${name}</b>\n\n`;
    }
  }

  function alreadyPrefixed(text) {
    if (!text || !agentName) return false;
    const t = String(text).trimStart();
    const prefixA = `<b>${agentName}</b>`;
    return t.startsWith(prefixA) || t.startsWith(agentName);
  }

  function findTextarea() {
    return (
      document.getElementById("text-input") ||
      document.querySelector("textarea#text-input") ||
      document.querySelector('textarea[placeholder*="mensagem"]') ||
      document.querySelector("textarea")
    );
  }

  function findSendButton(fromTarget) {
    return (
      fromTarget?.closest?.("#blip-send-message") ||
      fromTarget?.closest?.('bds-button-icon[id="blip-send-message"]') ||
      fromTarget?.closest?.('[aria-label*="Enviar"]') ||
      document.getElementById("blip-send-message") ||
      document.querySelector('bds-button-icon[id="blip-send-message"]')
    );
  }

  function applyPrefixStealth(textarea) {
    if (!textarea) return;
    const original = textarea.value ?? "";
    const trimmed = original.trim();
    if (!trimmed) return;
    if (alreadyPrefixed(trimmed)) return;

    const prefix = buildPrefix(agentName, getMode());
    const nextVal = prefix + trimmed;

    textarea.value = nextVal;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    setTimeout(() => {
      try {
        if (textarea.value === nextVal) {
          textarea.value = original;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          textarea.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch {}
    }, 0);
  }

  document.addEventListener("click", (e) => {
    if (!enabled || !agentName || !isEnabledBySettings()) return;
    const sendButton = findSendButton(e.target);
    if (!sendButton) return;
    const textarea = findTextarea();
    if (!textarea) return;
    applyPrefixStealth(textarea);
  }, true);

  document.addEventListener("keydown", (e) => {
    if (!enabled || !agentName || !isEnabledBySettings()) return;
    if (e.key !== "Enter" || e.shiftKey) return;
    const textarea = e.target;
    if (!textarea || textarea.tagName !== "TEXTAREA") return;
    applyPrefixStealth(textarea);
  }, true);

  window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!data?.__blipExt) return;

    if (data.type === "ENABLE") {
      enabled = !!data.enabled;
      if (data.settings) settings = data.settings;
      if (data.subdomain) tfState.subdomain = data.subdomain;
      if (enabled && !agentName) loadAgentName();
      if (enabled) {
        tfInject();
        if (!isTaggingEnabled()) {
          document.querySelectorAll("[data-dkdevspp-orig-display]").forEach(el => {
            el.style.display = el.dataset.dkdevsppOrigDisplay || "";
          });
          document.querySelectorAll("[" + DK_MENU_MARK + "]").forEach(el => {
            el.removeAttribute(DK_MENU_MARK);
          });
        }
        if (isSidebarEnabled()) renderSidebar();
        else removeSidebar();
      } else {
        tfRemove();
        removeSidebar();
      }
      return;
    }

    if (data.type === 'REFRESH_PANEL_CONTEXT') {
      if (!enabled || !isSidebarEnabled()) return;
      const activeTicketId = sidebarState.ticketId || getCurrentTicketId();
      const activeDisplay = sidebarState.ticketDisplay || activeTicketId || '';
      if (data.forceReload && activeTicketId) {
        loadSidebarData(activeTicketId, activeDisplay);
        return;
      }
      if (activeTicketId && (!sidebarState.ticketId || sidebarState.ticketId !== activeTicketId)) {
        loadSidebarData(activeTicketId, activeDisplay);
        return;
      }
      emitSidePanelContext();
    }
  });

  patchWebSocketForContacts();

  // -----------------------------
  // Etiquetas (Labels) nos cards
  // -----------------------------

  const LS_LABELS_KEY = "dkext_labels";
  const LS_TICKET_LABELS_KEY = "dkext_ticket_labels";
  const DK_MENU_MARK = "data-dkext-labels";
  const DK_BADGES_CLASS = "dkext-label-badges";

  // =============================================
  // PALETA BLIP — tons médios, sem saturação excessiva
  // Sem bordas, visual "pill" sólido e elegante
  // 13 cores garantem boa diversidade mesmo em nomes parecidos
  // =============================================
  const BLIP_TAG_COLORS = [
    { bg: "#3B9E7E", text: "#FFFFFF" }, // 0 verde
    { bg: "#3D6FD9", text: "#FFFFFF" }, // 1 azul Blip
    { bg: "#D4920A", text: "#FFFFFF" }, // 2 âmbar
    { bg: "#6B4DC4", text: "#FFFFFF" }, // 3 roxo
    { bg: "#C44A8B", text: "#FFFFFF" }, // 4 rosa
    { bg: "#1A9DBF", text: "#FFFFFF" }, // 5 ciano
    { bg: "#B04040", text: "#FFFFFF" }, // 6 vermelho escuro
    { bg: "#5E8C3A", text: "#FFFFFF" }, // 7 verde musgo
    { bg: "#1A6FA8", text: "#FFFFFF" }, // 8 azul marinho
    { bg: "#9B5E1A", text: "#FFFFFF" }, // 9 marrom dourado
    { bg: "#3A6E8C", text: "#FFFFFF" }, // 10 azul acinzentado
    { bg: "#7A4E9E", text: "#FFFFFF" }, // 11 violeta
    { bg: "#7A8494", text: "#FFFFFF" }, // 12 cinza azulado
  ];

  const normLabelName = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const norm = normLabelName;

  // Hash mais disperso: usa posição + valor para evitar colisões em nomes curtos similares
  const pickColorForName = (name) => {
    const n = normLabelName(name).toLowerCase();
    let h = 5381;
    for (let i = 0; i < n.length; i++) {
      h = Math.imul(h ^ n.charCodeAt(i), 0x9e3779b9 + i + 1);
    }
    // segunda passagem para misturar mais
    h ^= (h >>> 16);
    h = Math.imul(h, 0x45d9f3b);
    h ^= (h >>> 16);
    const idx = Math.abs(h) % BLIP_TAG_COLORS.length;
    return BLIP_TAG_COLORS[idx];
  };

  const readJsonLS = (key, fallback) => {
    try {
      const v = localStorage.getItem(key);
      if (!v) return fallback;
      const parsed = safeParse(v);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  };

  const writeJsonLS = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };

  const getAllLabels = () => {
    const raw = readJsonLS(LS_LABELS_KEY, []);
    const arr = Array.isArray(raw) ? raw.filter(x => x && x.id && x.name) : [];
    let changed = false;
    for (const l of arr) {
      if (!l.color || !l.color.bg) {
        l.color = pickColorForName(l.name);
        changed = true;
      }
    }
    if (changed) writeJsonLS(LS_LABELS_KEY, arr);
    return arr;
  };

  const setAllLabels = (labels) => {
    const clean = Array.isArray(labels) ? labels.filter(x => x && x.id && x.name) : [];
    writeJsonLS(LS_LABELS_KEY, clean);
  };

  const getTicketLabelsMap = () => {
    const raw = readJsonLS(LS_TICKET_LABELS_KEY, {});
    return raw && typeof raw === "object" ? raw : {};
  };

  const setTicketLabelsMap = (map) => {
    writeJsonLS(LS_TICKET_LABELS_KEY, map && typeof map === "object" ? map : {});
  };

  const genId = () => `lbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function getCurrentTicketId() {
    const path = location.pathname || "";
    const m = path.match(/\/tickets\/(\w[\w-]*)/i);
    if (m?.[1]) return m[1];
    try {
      const u = new URL(location.href);
      const qid = u.searchParams.get("id") || u.searchParams.get("ticketId");
      if (qid) return qid;
    } catch {}
    return null;
  }

  function extractTicketIdFromCard(cardRoot) {
    if (!cardRoot) return null;
    try {
      const idAttr = cardRoot.getAttribute?.("id") || "";
      const m0 = idAttr.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-chat-list-item$/i);
      if (m0?.[1]) return m0[1];
    } catch {}
    try {
      const aria = cardRoot.getAttribute?.("aria-label") || "";
      const m0b = aria.match(/-\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
      if (m0b?.[1]) return m0b[1];
    } catch {}
    const attrs = ["data-ticket-id","data-ticketid","data-id","ticket-id","ticketid","data-conversation-id","data-conversationid"];
    for (const a of attrs) {
      const v = cardRoot.getAttribute?.(a);
      if (v && String(v).trim()) return String(v).trim();
    }
    for (const a of attrs) {
      const el = cardRoot.querySelector?.(`[${a}]`);
      const v = el?.getAttribute?.(a);
      if (v && String(v).trim()) return String(v).trim();
    }
    const links = cardRoot.querySelectorAll?.("a[href]") || [];
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/tickets\/(\w[\w-]*)/i);
      if (m?.[1]) return m[1];
      const m2 = href.match(/ticketId=([\w-]+)/i);
      if (m2?.[1]) return m2[1];
    }
    const text = (cardRoot.textContent || "").trim();
    const m3 = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
    if (m3?.[0]) return m3[0];
    return null;
  }

  function getTicketIdFromContext(cardRoot) {
    return extractTicketIdFromCard(cardRoot) || getCurrentTicketId();
  }

  function getTicketDisplayFromCard(cardRoot, ticketId) {
    try {
      const info = cardRoot?.querySelector?.("section.ticket-info, .ticket-info");
      const typo = info?.querySelector?.('span.flex.truncate bds-typo, span.flex.truncate .bds-typo, span.flex.truncate');
      const txt = (typo?.textContent || "").trim();
      if (txt) return txt;
    } catch {}
    if (ticketId) return String(ticketId).slice(0, 8) + "…";
    return "(não identificado)";
  }

  const DK_BADGES_INFO_CLASS = "dkext-label-badges-info";

  function ensureTicketInfoBadgesContainer(cardRoot) {
    if (!cardRoot) return null;
    const info = cardRoot.querySelector?.("section.ticket-info, .ticket-info");
    if (!info) return null;

    const existing = info.querySelector?.(`.${DK_BADGES_INFO_CLASS}`);
    if (existing) return existing;

    const menuArea = info.querySelector?.(".ticket-menu");
    if (menuArea) {
      try {
        menuArea.style.minWidth = "38px";
        menuArea.style.display = "flex";
        menuArea.style.justifyContent = "flex-end";
        menuArea.style.alignItems = "center";
        menuArea.style.flexShrink = "0";
      } catch {}
    }

    const wrap = document.createElement("span");
    wrap.className = DK_BADGES_INFO_CLASS;
    wrap.style.display = "inline-flex";
    wrap.style.flexWrap = "nowrap";
    wrap.style.whiteSpace = "nowrap";
    wrap.style.overflowX = "auto";
    wrap.style.overflowY = "hidden";
    wrap.style.gap = "5px";
    wrap.style.alignItems = "center";
    wrap.style.marginLeft = "8px";
    wrap.style.marginRight = "8px";
    wrap.style.minWidth = "0";
    wrap.style.flexShrink = "0";

    try {
      if (menuArea) info.insertBefore(wrap, menuArea);
      else info.appendChild(wrap);
    } catch {
      try { info.appendChild(wrap); } catch {}
    }
    return wrap;
  }

  function findCardRootFromMenu(menuEl) {
    if (!menuEl) return null;
    return (
      menuEl.closest?.("bds-card") ||
      menuEl.closest?.('[data-testid*="ticket" i]') ||
      menuEl.closest?.('[data-testid*="card" i]') ||
      menuEl.closest?.("article") ||
      menuEl.closest?.("section") ||
      menuEl.parentElement
    );
  }

  function ensureBadgesContainer(cardRoot) {
    if (!cardRoot) return null;
    const existing = cardRoot.querySelector?.(`.${DK_BADGES_CLASS}`);
    if (existing) return existing;

    const anchor =
      cardRoot.querySelector?.(".message-preview") ||
      cardRoot.querySelector?.('[class*="message-preview" i]') ||
      cardRoot.querySelector?.(".ticket-chip") ||
      cardRoot.querySelector?.('[class*="ticket-chip" i]') ||
      cardRoot.querySelector?.("header") ||
      cardRoot.querySelector?.('[class*="header" i]') ||
      cardRoot;

    const wrap = document.createElement("span");
    wrap.className = DK_BADGES_CLASS;
    wrap.style.display = "flex";
    wrap.style.flexWrap = "nowrap";
    wrap.style.whiteSpace = "nowrap";
    wrap.style.overflowX = "auto";
    wrap.style.overflowY = "hidden";
    wrap.style.gap = "5px";
    wrap.style.margin = "0 6px 0 0";
    wrap.style.alignItems = "center";
    wrap.style.zIndex = "1";

    try {
      anchor.insertBefore(wrap, anchor.firstChild);
    } catch {
      try { anchor.appendChild(wrap); } catch {}
    }
    return wrap;
  }

  function renderBadgesForTicket(ticketId, cardRoot) {
    if (!ticketId || !cardRoot) return;
    const labels = getAllLabels();
    const map = getTicketLabelsMap();
    const selectedIds = Array.isArray(map[ticketId]) ? map[ticketId] : [];
    const selected = selectedIds
      .map(id => labels.find(l => l.id === id))
      .filter(Boolean);

    const wrapInfo = ensureTicketInfoBadgesContainer(cardRoot);

    const renderInto = (wrap) => {
      if (!wrap) return;
      wrap.innerHTML = "";
      if (!selected.length) return;

      for (const l of selected) {
        const c = l.color || pickColorForName(l.name);
        const badge = document.createElement("span");
        badge.textContent = String(l.name || "").toUpperCase();
        badge.style.fontSize = "10px";
        badge.style.fontWeight = "700";
        badge.style.letterSpacing = ".4px";
        badge.style.padding = "2px 8px";
        badge.style.borderRadius = "4px";
        badge.style.border = "none"; // SEM BORDA
        badge.style.display = "inline-flex";
        badge.style.alignItems = "center";
        badge.style.justifyContent = "center";
        badge.style.height = "18px";
        badge.style.background = c.bg;
        badge.style.color = c.text;
        badge.style.lineHeight = "18px";
        badge.style.whiteSpace = "nowrap";
        wrap.appendChild(badge);
      }
    };

    renderInto(wrapInfo);
  }

  function closeBdsMenu(menuEl) {
    try {
      if (typeof menuEl?.close === "function") menuEl.close();
      if (typeof menuEl?.hide === "function") menuEl.hide();
      menuEl.open = false;
      menuEl.removeAttribute?.("open");
    } catch {}
  }

  function closeAllMenus() {
    // Fecha todos os bds-menu abertos
    document.querySelectorAll("bds-menu").forEach(m => closeBdsMenu(m));
    // Fecha o submenu de etiquetas
    closeSubmenu();
  }

  // ── Submenu lateral — estilo context menu nativo ─────────────────────────
  let activeSubmenu = null;

  function closeSubmenu() {
    try { activeSubmenu?.remove(); } catch {}
    activeSubmenu = null;
  }

  function openLabelSubmenu(actionEl, ticketId, cardRoot) {
    closeSubmenu();

    if (!document.getElementById("dkext-submenu-styles")) {
      const st = document.createElement("style");
      st.id = "dkext-submenu-styles";
      st.textContent = `
        .dkext-submenu {
          position: fixed;
          background: #ffffff;
          border: 1px solid rgba(0,0,0,0.10);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.08);
          z-index: 99999999;
          width: 220px;
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
          overflow: hidden;
          animation: dkext-subslide .13s ease-out;
        }
        @keyframes dkext-subslide {
          from { opacity:0; transform: translateX(-4px); }
          to   { opacity:1; transform: translateX(0); }
        }
        .dkext-submenu-header {
          padding: 10px 16px 7px;
          font-size: 11px; font-weight: 700;
          color: #8A96A8;
          letter-spacing: .7px;
          text-transform: uppercase;
        }
        .dkext-submenu-list {
          max-height: 240px;
          overflow-y: auto;
          padding: 2px 0 6px;
        }
        .dkext-submenu-empty {
          padding: 12px 16px;
          font-size: 13px; color: #9AA5B5;
        }
        .dkext-submenu-item {
          display: flex; align-items: center; gap: 9px;
          padding: 7px 16px;
          cursor: pointer;
          transition: background .08s;
          user-select: none;
          min-height: 34px;
        }
        .dkext-submenu-item:hover { background: #f5f5f5; }
        .dkext-submenu-item.is-sel { background: #f5f5f5; }
        .dkext-submenu-badge {
          height: 18px; padding: 0 7px;
          border-radius: 3px;
          font-size: 10px; font-weight: 700;
          letter-spacing: .4px;
          display: inline-flex; align-items: center;
          white-space: nowrap; flex-shrink: 0;
          max-width: 85px;
          overflow: hidden; text-overflow: ellipsis;
        }
        .dkext-submenu-name {
          font-size: 14px; color: #3d3d3d; flex: 1;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-weight: 400;
        }
        .dkext-submenu-chk {
          width: 16px; height: 16px; flex-shrink: 0;
          border-radius: 3px;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 900; line-height: 1;
        }
        .dkext-submenu-chk.on  { background: #0096FA; color: #fff; }
        .dkext-submenu-chk.off { border: 1.5px solid #d0d0d0; }
        .dkext-submenu-divider { height: 1px; background: #ebebeb; margin: 4px 0; }
        .dkext-submenu-manage {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 16px;
          font-size: 13px; font-weight: 400; color: #0096FA;
          cursor: pointer;
          transition: background .08s;
        }
        .dkext-submenu-manage:hover { background: #f5f5f5; }
      `;
      document.head.appendChild(st);
    }

    const sub = document.createElement("div");
    sub.className = "dkext-submenu";

    // Header
    const hdr = document.createElement("div");
    hdr.className = "dkext-submenu-header";
    hdr.textContent = "Etiquetas";
    sub.appendChild(hdr);

    // Lista
    const list = document.createElement("div");
    list.className = "dkext-submenu-list";

    const renderList = () => {
      list.innerHTML = "";
      const lbls = getAllLabels();
      const mp = getTicketLabelsMap();
      const selIds = new Set(ticketId && Array.isArray(mp[ticketId]) ? mp[ticketId] : []);

      if (!lbls.length) {
        const emp = document.createElement("div");
        emp.className = "dkext-submenu-empty";
        emp.textContent = "Nenhuma etiqueta cadastrada.";
        list.appendChild(emp);
        return;
      }

      lbls.forEach(lbl => {
        const c = lbl.color || pickColorForName(lbl.name);
        const isSel = selIds.has(lbl.id);

        const item = document.createElement("div");
        item.className = "dkext-submenu-item" + (isSel ? " is-sel" : "");

        const chk = document.createElement("span");
        chk.className = "dkext-submenu-chk " + (isSel ? "on" : "off");
        chk.textContent = isSel ? "✓" : "";

        const badge = document.createElement("span");
        badge.className = "dkext-submenu-badge";
        badge.style.background = c.bg;
        badge.style.color = c.text;
        badge.textContent = lbl.name.toUpperCase();

        const name = document.createElement("span");
        name.className = "dkext-submenu-name";
        name.textContent = lbl.name;

        item.appendChild(chk);
        item.appendChild(badge);
        item.appendChild(name);

        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!ticketId) return;
          const m2 = getTicketLabelsMap();
          const cur = new Set(Array.isArray(m2[ticketId]) ? m2[ticketId] : []);
          if (cur.has(lbl.id)) cur.delete(lbl.id); else cur.add(lbl.id);
          m2[ticketId] = Array.from(cur);
          setTicketLabelsMap(m2);
          if (cardRoot) renderBadgesForTicket(ticketId, cardRoot);
          renderList();
        });

        list.appendChild(item);
      });
    };

    renderList();
    sub.appendChild(list);

    // Divider + Gerenciar
    const div = document.createElement("div");
    div.className = "dkext-submenu-divider";
    sub.appendChild(div);

    const manage = document.createElement("div");
    manage.className = "dkext-submenu-manage";
    manage.innerHTML = `<svg width="13" height="13" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="#0096FA" stroke-width="1.8"/>
      <path d="M10 6v8M6 10h8" stroke="#0096FA" stroke-width="1.8" stroke-linecap="round"/>
    </svg>Gerenciar etiquetas`;
    manage.addEventListener("mousedown", (e) => {
      e.preventDefault();
      closeAllMenus();
      openLabelsModal({ ticketId, cardRoot });
    });
    sub.appendChild(manage);

    document.body.appendChild(sub);
    activeSubmenu = sub;

    // ── Posicionamento: âncora no actionEl, abre à direita igual submenu nativo ──
    const rect = actionEl.getBoundingClientRect();
    const sw = 220;
    const sh = sub.offsetHeight || 280;

    let left = rect.right + 2;
    let top  = rect.top;

    // Não cabe à direita → abre à esquerda
    if (left + sw > window.innerWidth - 8) left = rect.left - sw - 2;
    // Não cabe abaixo → sobe
    if (top + sh > window.innerHeight - 8) top = window.innerHeight - sh - 8;

    sub.style.left = Math.max(8, left) + "px";
    sub.style.top  = Math.max(8, top)  + "px";

    // Fecha ao clicar fora ou pressionar Escape
    const onOut = (e) => {
      if (!sub.contains(e.target) && e.target !== actionEl) {
        closeSubmenu();
        document.removeEventListener("mousedown", onOut);
        document.removeEventListener("keydown", onKey);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeSubmenu();
        document.removeEventListener("mousedown", onOut);
        document.removeEventListener("keydown", onKey);
      }
    };
    setTimeout(() => {
      document.addEventListener("mousedown", onOut);
      document.addEventListener("keydown", onKey);
    }, 0);
  }

  function upsertMenuAction(menuEl) {
    if (!isTaggingEnabled()) return;
    if (!menuEl || menuEl.getAttribute?.(DK_MENU_MARK) === "1") return;
    menuEl.setAttribute?.(DK_MENU_MARK, "1");

    const action = document.createElement("bds-menu-action");
    action.setAttribute("button-text", "Adicionar etiqueta");
    action.setAttribute("subtitle", "");
    action.setAttribute("icon-left", "tag");
    action.classList.add("hydrated");
    action.style.cursor = "pointer";
    action.style.position = "relative";

    // Seta ▶ via wrapper relativo — contorna o Shadow DOM do bds-menu-action
    const actionWrap = document.createElement("div");
    actionWrap.style.cssText = "position:relative; display:block;";

    const arrow = document.createElement("span");
    arrow.style.cssText = [
      "position:absolute",
      "right:14px",
      "top:50%",
      "transform:translateY(-50%)",
      "font-size:9px",
      "color:#8A96A8",
      "pointer-events:none",
      "z-index:1",
      "line-height:1",
    ].join(";");
    arrow.textContent = "▶";

    actionWrap.appendChild(action);
    actionWrap.appendChild(arrow);

    action.addEventListener("mouseenter", () => {
      // Abre ao hover — comportamento nativo de submenu
      const cardRoot = findCardRootFromMenu(menuEl);
      const ticketId = getTicketIdFromContext(cardRoot);
      openLabelSubmenu(action, ticketId, cardRoot);
    });

    action.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const cardRoot = findCardRootFromMenu(menuEl);
      const ticketId = getTicketIdFromContext(cardRoot);
      openLabelSubmenu(action, ticketId, cardRoot);
    });

    try { menuEl.appendChild(actionWrap); } catch {}
  }

  let modalEl = null;

  function closeLabelsModal() {
    try { modalEl?.remove?.(); } catch {}
    modalEl = null;
  }

  // ============================================================
  // MODAL — padrão visual Blip Desk
  // Cores: #0096FA (azul Blip primário), fundo #F6F8FA, cards #FFFFFF
  // Tipografia: fonte system-ui, pesos 600/700/800
  // Sem bordas nas etiquetas
  // ============================================================
  function openLabelsModal(ctx) {
    closeLabelsModal();

    const ticketId = ctx?.ticketId || getTicketIdFromContext(ctx?.cardRoot) || getCurrentTicketId();
    const cardRoot = ctx?.cardRoot || null;

    // Injeta estilos globais (uma única vez)
    if (!document.getElementById("dkext-modal-styles")) {
      const style = document.createElement("style");
      style.id = "dkext-modal-styles";
      style.textContent = `
        .dkext-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(15, 30, 60, 0.48);
          z-index: 999999;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(2px);
          animation: dkext-fadein .18s ease;
        }
        @keyframes dkext-fadein {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes dkext-slidein {
          from { opacity: 0; transform: translateY(12px) scale(.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .dkext-modal {
          width: min(860px, 94vw);
          max-height: 84vh;
          overflow: hidden;
          background: #F6F8FA;
          border-radius: 14px;
          box-shadow: 0 24px 64px rgba(0,30,80,0.28), 0 4px 16px rgba(0,0,0,0.12);
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
          animation: dkext-slidein .22s cubic-bezier(.22,.68,0,1.2);
          display: flex; flex-direction: column;
        }
        .dkext-modal-header {
          background: #1A1F2E;
          padding: 18px 22px 16px;
          display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
          border-radius: 14px 14px 0 0;
        }
        .dkext-modal-header-title {
          font-size: 17px; font-weight: 800; color: #FFFFFF; letter-spacing: -.2px;
        }
        .dkext-modal-header-sub {
          font-size: 12px; color: rgba(255,255,255,0.55); margin-top: 3px; font-weight: 400;
        }
        .dkext-modal-close {
          width: 32px; height: 32px;
          background: rgba(255,255,255,0.1);
          border: none; border-radius: 8px;
          cursor: pointer; color: rgba(255,255,255,0.75);
          font-size: 20px; line-height: 1;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: background .15s, color .15s;
        }
        .dkext-modal-close:hover { background: rgba(255,255,255,0.18); color: #fff; }
        .dkext-modal-body {
          padding: 18px 20px 20px;
          overflow-y: auto;
          display: flex; flex-direction: column; gap: 14px;
        }
        .dkext-card {
          background: #FFFFFF;
          border-radius: 10px;
          padding: 14px 16px;
          border: none;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07);
        }
        .dkext-card-title {
          font-size: 13px; font-weight: 700; color: #1A2B4A; margin-bottom: 4px;
        }
        .dkext-card-sub {
          font-size: 11.5px; color: #6B7A90; margin-bottom: 12px; font-weight: 400;
        }
        .dkext-chips-input-box {
          border: 1.5px solid #D5DDE8;
          border-radius: 8px;
          padding: 8px 12px;
          display: flex; flex-wrap: wrap; gap: 7px; align-items: center;
          min-height: 46px;
          background: #FAFBFD;
          transition: border-color .15s;
        }
        .dkext-chips-input-box:focus-within {
          border-color: #0096FA;
          box-shadow: 0 0 0 3px rgba(0,150,250,0.1);
        }
        .dkext-text-input {
          flex: 1; min-width: 140px;
          border: 0; outline: none;
          padding: 4px 2px;
          font-size: 13.5px;
          background: transparent;
          color: #1A2B4A;
          font-family: inherit;
        }
        .dkext-text-input::placeholder { color: #9AA5B5; }
        .dkext-apply-wrap {
          display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px;
        }
        .dkext-empty-hint {
          font-size: 12px; color: #9AA5B5; padding: 4px 0;
        }
        .dkext-warn {
          font-size: 11.5px; color: #D4920A; font-weight: 600;
        }
        .dkext-apply-subtitle {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 10px; margin-bottom: 10px;
        }

        /* ── CHIPS / ETIQUETAS ── sem bordas, padding ajustado */
        .dkext-chip {
          display: inline-flex; align-items: center; gap: 5px;
          height: 22px; padding: 0 10px;
          border-radius: 5px;
          border: none; /* SEM BORDA */
          font-size: 11px; font-weight: 700;
          letter-spacing: .4px; line-height: 1;
          white-space: nowrap;
          user-select: none;
          cursor: default;
          transition: filter .12s, transform .1s;
        }
        .dkext-chip-clickable {
          cursor: pointer;
        }
        .dkext-chip-clickable:hover {
          filter: brightness(1.1);
          transform: scale(1.04);
        }
        .dkext-chip-selected {
          box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.45);
        }
        .dkext-chip-check {
          display: inline-flex; align-items: center; justify-content: center;
          width: 13px; height: 13px;
          border-radius: 3px;
          background: rgba(255,255,255,0.25);
          color: #fff;
          font-size: 9px; line-height: 1;
          margin-right: 2px;
        }
        .dkext-chip-remove {
          font-weight: 900; margin-left: 4px;
          cursor: pointer; opacity: .75;
          font-size: 13px; line-height: 1;
          transition: opacity .12s;
        }
        .dkext-chip-remove:hover { opacity: 1; }
      `;
      document.head.appendChild(style);
    }

    // ── Overlay ──
    const overlay = document.createElement("div");
    overlay.className = "dkext-modal-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeLabelsModal();
    });

    // ── Modal shell ──
    const modal = document.createElement("div");
    modal.className = "dkext-modal";

    // ── Header ──
    const header = document.createElement("div");
    header.className = "dkext-modal-header";

    const titleWrap = document.createElement("div");
    titleWrap.innerHTML = `
      <div class="dkext-modal-header-title">Gerenciar etiquetas</div>
      <div class="dkext-modal-header-sub">Crie e exclua etiquetas. Para aplicar, use o menu (⋯) de cada atendimento.</div>
    `;

    const closeBtn = document.createElement("button");
    closeBtn.className = "dkext-modal-close";
    closeBtn.setAttribute("aria-label", "Fechar");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", closeLabelsModal);

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    // ── Body ──
    const body = document.createElement("div");
    body.className = "dkext-modal-body";

    // Card — Gerenciar etiquetas
    const manageCard = document.createElement("div");
    manageCard.className = "dkext-card";

    const mgTitle = document.createElement("div");
    mgTitle.className = "dkext-card-title";
    mgTitle.textContent = "Etiquetas disponíveis";

    const mgSub = document.createElement("div");
    mgSub.className = "dkext-card-sub";
    mgSub.textContent = "Digite e pressione Enter para adicionar. Clique no × para excluir.";

    const chipsInputBox = document.createElement("div");
    chipsInputBox.className = "dkext-chips-input-box";

    const chipsWrap = document.createElement("span");
    chipsWrap.style.display = "inline-flex";
    chipsWrap.style.flexWrap = "wrap";
    chipsWrap.style.gap = "7px";
    chipsWrap.style.alignItems = "center";

    const input = document.createElement("input");
    input.className = "dkext-text-input";
    input.placeholder = "Nova etiqueta… pressione Enter";

    chipsInputBox.appendChild(chipsWrap);
    chipsInputBox.appendChild(input);

    manageCard.appendChild(mgTitle);
    manageCard.appendChild(mgSub);
    manageCard.appendChild(chipsInputBox);

    // ── Helpers de chip ──
    function buildChip(label, { removable = false, selected = false, onToggle, onRemove } = {}) {
      const c = label.color || pickColorForName(label.name || "");
      const chip = document.createElement("span");
      chip.className = "dkext-chip" + (onToggle ? " dkext-chip-clickable" : "") + (selected ? " dkext-chip-selected" : "");
      chip.style.background = c.bg;
      chip.style.color = c.text;

      if (selected) {
        const check = document.createElement("span");
        check.className = "dkext-chip-check";
        check.textContent = "✓";
        chip.appendChild(check);
      }

      const label_text = document.createElement("span");
      label_text.textContent = String(label.name || "").toUpperCase();
      chip.appendChild(label_text);

      if (removable) {
        const x = document.createElement("span");
        x.className = "dkext-chip-remove";
        x.textContent = "×";
        x.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove?.(label);
        });
        chip.appendChild(x);
      }

      if (onToggle) {
        chip.addEventListener("click", () => onToggle(label));
      }

      return chip;
    }

    function addTagsFromRaw(raw) {
      const value = norm(raw);
      if (!value) return;
      const parts = value.split(",").map(norm).filter(Boolean);
      if (!parts.length) return;
      const labels = getAllLabels();
      const existingLower = new Set(labels.map(l => String(l.name).toLowerCase()));
      for (const name of parts) {
        const lower = name.toLowerCase();
        if (existingLower.has(lower)) continue;
        const color = pickColorForName(name);
        labels.push({ id: genId(), name, color });
        existingLower.add(lower);
      }
      setAllLabels(labels);
      input.value = "";
      rerender();
    }

    function removeLabelEverywhere(labelId) {
      const next = getAllLabels().filter(x => x.id !== labelId);
      setAllLabels(next);
      const m = getTicketLabelsMap();
      for (const k of Object.keys(m)) {
        if (Array.isArray(m[k])) m[k] = m[k].filter(id => id !== labelId);
      }
      setTicketLabelsMap(m);
    }

    function toggleLabelOnTicket(labelId) {
      if (!ticketId) return;
      const m = getTicketLabelsMap();
      const cur = Array.isArray(m[ticketId]) ? new Set(m[ticketId]) : new Set();
      if (cur.has(labelId)) cur.delete(labelId); else cur.add(labelId);
      m[ticketId] = Array.from(cur);
      setTicketLabelsMap(m);
      if (cardRoot) renderBadgesForTicket(ticketId, cardRoot);
      rerender();
    }

    function rerender() {
      const labels = getAllLabels();
      chipsWrap.innerHTML = "";
      for (const l of labels) {
        chipsWrap.appendChild(buildChip(l, {
          removable: true,
          onRemove: (lbl) => {
            removeLabelEverywhere(lbl.id);
            rerender();
            if (ticketId && cardRoot) renderBadgesForTicket(ticketId, cardRoot);
            renderBadgesOnAllCards();
          }
        }));
      }
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTagsFromRaw(input.value);
        return;
      }
      // Backspace com input vazio → remove a última etiqueta
      if (e.key === "Backspace" && input.value === "") {
        e.preventDefault();
        const labels = getAllLabels();
        if (!labels.length) return;
        const last = labels[labels.length - 1];
        removeLabelEverywhere(last.id);
        rerender();
        if (ticketId && cardRoot) renderBadgesForTicket(ticketId, cardRoot);
        renderBadgesOnAllCards();
      }
    });
    input.addEventListener("blur", () => {
      const v = norm(input.value);
      if (v) addTagsFromRaw(v);
    });

    body.appendChild(manageCard);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    modalEl = overlay;
    document.body.appendChild(overlay);
    rerender();

    // foca o input automaticamente
    setTimeout(() => { try { input.focus(); } catch {} }, 50);
  }

  // Observa menus e injeta a opção "Etiquetas".
  function renderBadgesOnAllCards() {
    if (!isTaggingEnabled()) return;
    const labels = getAllLabels();
    if (!labels.length) return;
    const candidates = Array.from(document.querySelectorAll?.(
      "article.chat-list-item,article.ticket-list-item,article[id$='-chat-list-item'],bds-card,[data-ticket-id],[data-conversation-id],[data-testid*='ticket' i]"
    ) || []);
    const limited = candidates.slice(0, 200);
    for (const card of limited) {
      const tid = extractTicketIdFromCard(card);
      if (!tid) continue;
      renderBadgesForTicket(tid, card);
    }
  }

  const ROOT_OBS_OPTS = { childList: true, subtree: true };

  let __dkextScheduled = false;
  let __dkextRendering = false;

  function runMenuAndBadgesScan(menuObserver) {
    if (!enabled) return;
    if (__dkextRendering) return;
    __dkextRendering = true;
    try {
      try { menuObserver.disconnect(); } catch {}
      const menus = document.querySelectorAll?.("bds-menu") || [];
      if (menus.length) menus.forEach(upsertMenuAction);
      renderBadgesOnAllCards();
      const openMenus = Array.from(menus).filter(m => m.getAttribute?.("open") !== null);
      const candidateMenu = openMenus[0];
      if (candidateMenu) {
        const cardRoot = findCardRootFromMenu(candidateMenu);
        const ticketId = getTicketIdFromContext(cardRoot);
        if (ticketId && cardRoot) renderBadgesForTicket(ticketId, cardRoot);
      }
    } catch {
    } finally {
      __dkextRendering = false;
      try { menuObserver.observe(document.documentElement, ROOT_OBS_OPTS); } catch {}
    }
  }

  const menuObserver = new MutationObserver(() => {
    if (!enabled) return;
    if (__dkextScheduled) return;
    __dkextScheduled = true;
    requestAnimationFrame(() => {
      __dkextScheduled = false;
      runMenuAndBadgesScan(menuObserver);
    });
  });

  try { menuObserver.observe(document.documentElement, ROOT_OBS_OPTS); } catch {}

  setTimeout(() => {
    try {
      document.querySelectorAll?.("bds-menu")?.forEach?.(upsertMenuAction);
      renderBadgesOnAllCards();
    } catch {}
  }, 1200);

  loadAgentName();

  // ── Ícone de etiquetas na navbar lateral ──────────────────────────────────


  // navbar label btn removido

  // ============================================================
  // FILTRO DE TAGS — linha dedicada abaixo dos chips, centralizada
  // ============================================================

  const TF_WRAP_ID   = "dkdevspp-tagfilter-wrap";
  const TF_INPUT_ID  = "dkdevspp-tagfilter-input";
  const TF_CLEAR_ID  = "dkdevspp-tagfilter-clear";
  const TF_LIST_ID   = "dkdevspp-tagfilter-datalist";
  const TF_LS_PREFIX = "dkdevspp_tagfilter_";

  const tfState = {
    injected: false,
    selectedTag: "",
    lastTagsHash: "",
    mo: null,
    subdomain: null,
  };

  function tfLoadTag() {
    try {
      const v = localStorage.getItem(TF_LS_PREFIX + (tfState.subdomain || "default"));
      if (v) tfState.selectedTag = v;
    } catch {}
  }

  function tfSaveTag(tag) {
    try { localStorage.setItem(TF_LS_PREFIX + (tfState.subdomain || "default"), tag || ""); } catch {}
  }

  function tfEnsureStyles() {
    if (document.getElementById("dkdevspp-tagfilter-style")) return;
    const style = document.createElement("style");
    style.id = "dkdevspp-tagfilter-style";
    style.textContent = `
      #${TF_WRAP_ID} {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 0 16px 10px;
        box-sizing: border-box;
      }
      .dkdevspp-tf-input-wrap {
        position: relative;
        width: 100%;
        max-width: 320px;
      }
      /* ícone de busca */
      .dkdevspp-tf-search-icon {
        position: absolute;
        left: 11px; top: 50%;
        transform: translateY(-50%);
        width: 15px; height: 15px;
        pointer-events: none;
        color: #9AA5B5;
      }
      #${TF_INPUT_ID} {
        height: 34px;
        padding: 0 34px 0 34px;
        border-radius: 17px;
        border: 1.5px solid #D5DDE8;
        background: #F7F9FC;
        font: inherit; font-size: 13px;
        outline: none;
        width: 100%;
        box-sizing: border-box;
        transition: border-color .15s, box-shadow .15s, background .15s;
        color: #1A2B4A;
      }
      #${TF_INPUT_ID}:focus {
        border-color: #0096FA;
        background: #fff;
        box-shadow: 0 0 0 3px rgba(0,150,250,.13);
      }
      #${TF_INPUT_ID}::placeholder { color: #9AA5B5; }
      /* botão × */
      #${TF_CLEAR_ID} {
        position: absolute;
        right: 9px; top: 50%;
        transform: translateY(-50%);
        width: 18px; height: 18px;
        border-radius: 50%;
        background: #C8D0DA;
        color: #fff;
        font-size: 13px; font-weight: 700;
        line-height: 18px; text-align: center;
        cursor: pointer;
        display: none;
        user-select: none;
        transition: background .15s, transform .15s;
        flex-shrink: 0;
      }
      #${TF_CLEAR_ID}:hover {
        background: #e53935;
        transform: translateY(-50%) scale(1.15);
      }
      /* dropdown autocomplete */
      #dkdevspp-tf-dropdown {
        position: absolute;
        top: calc(100% + 5px); left: 0; right: 0;
        background: #fff;
        border: 1px solid #D5DDE8;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,30,80,0.13);
        z-index: 999999;
        max-height: 200px;
        overflow-y: auto;
        display: none;
        padding: 4px 0;
      }
      .dkdevspp-tf-option {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 14px;
        font-size: 13px; color: #1A2B4A;
        cursor: pointer;
        transition: background .1s;
        white-space: nowrap;
      }
      .dkdevspp-tf-option:hover, .dkdevspp-tf-option.active {
        background: #EEF5FF;
      }
      .dkdevspp-tf-badge {
        display: inline-flex; align-items: center;
        height: 18px; padding: 0 8px;
        border-radius: 4px;
        font-size: 10px; font-weight: 700;
        letter-spacing: .4px;
        pointer-events: none;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function tfFindTicketCards() {
    return Array.from(document.querySelectorAll(
      "article.chat-list-item, article.ticket-list-item, article[id$=\'-chat-list-item\'], [data-ticket-id], [data-conversation-id]"
    ));
  }

  function tfGetTagNamesFromCard(card) {
    const map = getTicketLabelsMap();
    const tid = extractTicketIdFromCard(card);
    if (!tid) return [];
    const labels = getAllLabels();
    const ids = Array.isArray(map[tid]) ? map[tid] : [];
    return ids.map(id => labels.find(l => l.id === id)?.name).filter(Boolean).map(n => n.toLowerCase());
  }

  function tfApplyFilter(tag) {
    const t = (tag || "").trim().toLowerCase().replace(/^#/, "");

    const cards = tfFindTicketCards();
    cards.forEach(card => {
      if (card.dataset.dkTfOrigDisplay === undefined) {
        card.dataset.dkTfOrigDisplay = card.style.display || "";
      }
      if (!t) {
        card.style.display = card.dataset.dkTfOrigDisplay;
        return;
      }
      const tags = tfGetTagNamesFromCard(card);
      const textLower = (card.textContent || "").toLowerCase();
      const match = tags.some(tg => tg.includes(t)) || textLower.includes("#" + t);
      card.style.display = match ? card.dataset.dkTfOrigDisplay : "none";
    });
  }

  function tfPopulateDatalist(datalist) {
    const labels = getAllLabels();
    const hash = labels.map(l => l.id).join("|");
    if (hash === tfState.lastTagsHash) return;
    tfState.lastTagsHash = hash;
    datalist.innerHTML = "";
    labels.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.name;
      datalist.appendChild(opt);
    });
  }

  function tfInject() {
    if (!isTaggingEnabled()) {
      tfRemove();
      return;
    }
    if (tfState.injected) return;
    if (!enabled) return;
    if (document.getElementById(TF_WRAP_ID)) { tfState.injected = true; return; }

    // Âncora: injeta logo após o #filters-container (dentro do mesmo pai)
    const filtersContainer = document.getElementById("filters-container");
    if (!filtersContainer) return;
    const parent = filtersContainer.parentElement;
    if (!parent) return;

    tfEnsureStyles();

    const wrap = document.createElement("div");
    wrap.id = TF_WRAP_ID;

    const inputWrap = document.createElement("div");
    inputWrap.className = "dkdevspp-tf-input-wrap";

    // ícone lupa (SVG inline)
    const searchIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    searchIcon.setAttribute("viewBox","0 0 20 20");
    searchIcon.setAttribute("fill","none");
    searchIcon.classList.add("dkdevspp-tf-search-icon");
    searchIcon.innerHTML = `<circle cx="8.5" cy="8.5" r="5" stroke="currentColor" stroke-width="1.8"/>
      <line x1="12.5" y1="12.5" x2="16.5" y2="16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;

    const input = document.createElement("input");
    input.id = TF_INPUT_ID;
    input.placeholder = "Filtrar por tag\u2026";
    input.autocomplete = "off";
    input.spellcheck = false;

    const clear = document.createElement("div");
    clear.id = TF_CLEAR_ID;
    clear.textContent = "\u00d7";

    const dropdown = document.createElement("div");
    dropdown.id = "dkdevspp-tf-dropdown";

    inputWrap.appendChild(searchIcon);
    inputWrap.appendChild(input);
    inputWrap.appendChild(clear);
    inputWrap.appendChild(dropdown);
    wrap.appendChild(inputWrap);

    // Insere imediatamente após o #filters-container
    filtersContainer.insertAdjacentElement("afterend", wrap);

    // Restaura tag salva no localStorage
    tfLoadTag();
    if (tfState.selectedTag) {
      input.value = tfState.selectedTag;
      clear.style.display = "block";
      tfApplyFilter(tfState.selectedTag);
    }

    let ddActiveIdx = -1;

    const closeDropdown = () => {
      dropdown.style.display = "none";
      ddActiveIdx = -1;
    };

    const openDropdown = (items) => {
      dropdown.innerHTML = "";
      if (!items.length) { closeDropdown(); return; }
      items.forEach((lbl, i) => {
        const c = lbl.color || pickColorForName(lbl.name);
        const opt = document.createElement("div");
        opt.className = "dkdevspp-tf-option";
        opt.dataset.idx = i;

        const badge = document.createElement("span");
        badge.className = "dkdevspp-tf-badge";
        badge.style.background = c.bg;
        badge.style.color = c.text;
        badge.textContent = lbl.name.toUpperCase();

        const label = document.createElement("span");
        label.textContent = lbl.name;

        opt.appendChild(badge);
        opt.appendChild(label);

        opt.addEventListener("mousedown", (e) => {
          e.preventDefault();
          input.value = lbl.name;
          closeDropdown();
          onChange();
        });
        dropdown.appendChild(opt);
      });
      dropdown.style.display = "block";
      ddActiveIdx = -1;
    };

    const refreshDropdown = () => {
      const q = (input.value || "").trim().toLowerCase();
      const labels = getAllLabels();
      const filtered = q
        ? labels.filter(l => l.name.toLowerCase().includes(q))
        : labels;
      openDropdown(filtered);
    };

    const onChange = () => {
      const val = (input.value || "").trim();
      tfState.selectedTag = val;
      clear.style.display = val ? "block" : "none";
      tfApplyFilter(val);
      tfSaveTag(val);
    };

    input.addEventListener("input", () => {
      clearTimeout(input._dkTfT);
      clear.style.display = input.value ? "block" : "none";
      refreshDropdown();
      input._dkTfT = setTimeout(onChange, 180);
    });

    input.addEventListener("focus", () => refreshDropdown());

    input.addEventListener("blur", () => {
      setTimeout(closeDropdown, 150);
    });

    input.addEventListener("keydown", (e) => {
      const opts = dropdown.querySelectorAll(".dkdevspp-tf-option");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        ddActiveIdx = Math.min(ddActiveIdx + 1, opts.length - 1);
        opts.forEach((o, i) => o.classList.toggle("active", i === ddActiveIdx));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        ddActiveIdx = Math.max(ddActiveIdx - 1, 0);
        opts.forEach((o, i) => o.classList.toggle("active", i === ddActiveIdx));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (ddActiveIdx >= 0 && opts[ddActiveIdx]) {
          input.value = opts[ddActiveIdx].querySelector("span:last-child").textContent;
          closeDropdown();
        }
        onChange();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (dropdown.style.display === "block") { closeDropdown(); return; }
        input.value = "";
        onChange();
      }
    });

    clear.addEventListener("click", () => {
      input.value = "";
      closeDropdown();
      onChange();
    });

    // Fecha dropdown ao clicar fora
    document.addEventListener("click", (e) => {
      if (!inputWrap.contains(e.target)) closeDropdown();
    });

    // Reaplica filtro quando a lista de tickets muda (SPA)
    if (tfState.mo) { try { tfState.mo.disconnect(); } catch {} }
    const mo = new MutationObserver(() => {
      if (tfState.selectedTag) tfApplyFilter(tfState.selectedTag);
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: false });
    tfState.mo = mo;

    tfState.injected = true;
  }

  function tfRemove() {
    try { tfState.mo?.disconnect(); tfState.mo = null; } catch {}
    document.getElementById(TF_WRAP_ID)?.remove();
    tfApplyFilter(""); // restaura cards ocultos
    tfState.injected = false;
  }


  // -----------------------------
  // CRM lateral / sidebar de ticket
  // -----------------------------

  const DK_SIDEBAR_HOST_ID = "dkext-crm-sidebar-host";
  const DK_SIDEBAR_STYLE_ID = "dkext-crm-sidebar-style";
  const DK_SIDEBAR_WIDTH = 380;

  const sidebarState = {
    visible: false,
    collapsed: false,
    activeTab: "cliente",
    ticketId: null,
    ticketDisplay: "",
    protocol: "",
    protocolLabel: "Integração lateral do CRM",
    customer: null,
    schedule: null,
    attachments: [],
    validatorUrl: "",
    loading: false,
    error: "",
    lastLoadKey: "",
    lastObservedTicketId: null,
    lastContactSignature: "",
    lastEmittedPanelSignature: "",
  };

  function isSidebarEnabled() {
    const cfg = settings?.features?.deskSidebar;
    return !!cfg?.enabled;
  }

  function getSidebarSettings() {
    const feat = settings?.features?.deskSidebar || {};
    // A API retorna os campos dentro de feat.config — merge para compatibilidade
    const nested = (feat.config && typeof feat.config === 'object') ? feat.config : {};
    return { ...nested, ...feat, config: undefined };
  }

  function isExtensionSidePanelMode() {
    const cfg = getSidebarSettings();
    return cfg.useExtensionSidePanel !== false;
  }

  function requestExtensionSidePanelOpen() {
    if (!isSidebarEnabled() || !isExtensionSidePanelMode()) return;
    try {
      window.postMessage({
        __dkSidePanel: true,
        type: 'OPEN_SIDE_PANEL_REQUEST'
      }, '*');
    } catch {}
  }

  function emitSidePanelContext() {
    if (!isSidebarEnabled() || !isExtensionSidePanelMode()) return;
    const payload = {
      visible: !!sidebarState.visible,
      collapsed: !!sidebarState.collapsed,
      activeTab: sidebarState.activeTab || 'cliente',
      ticketId: sidebarState.ticketId || '',
      ticketDisplay: sidebarState.ticketDisplay || '',
      protocol: sidebarState.protocol || '',
      protocolLabel: sidebarState.protocolLabel || '',
      customer: sidebarState.customer || {},
      schedule: sidebarState.schedule || {},
      attachments: Array.isArray(sidebarState.attachments) ? sidebarState.attachments : [],
      validatorUrl: sidebarState.validatorUrl || '',
      loading: !!sidebarState.loading,
      error: sidebarState.error || ''
    };

    const signature = JSON.stringify(payload);
    if (signature === sidebarState.lastEmittedPanelSignature) return;
    sidebarState.lastEmittedPanelSignature = signature;

    window.postMessage({
      __dkSidePanel: true,
      type: 'SIDEPANEL_CONTEXT',
      payload
    }, '*');
  }

  function apiFetchViaContent(url, options = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `dkreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      const onMessage = (event) => {
        const data = event.data;
        if (!data || data.__dkSidebar !== true || data.type !== "API_FETCH_RESULT" || data.requestId !== requestId) return;
        window.removeEventListener("message", onMessage);
        if (!data.ok) return reject(new Error(data.error || `HTTP ${data.status || 0}`));
        resolve(data.body);
      };

      window.addEventListener("message", onMessage);
      window.postMessage({ __dkSidebar: true, type: "API_FETCH", requestId, url, options }, "*");

      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Timeout ao consultar API"));
      }, 20000);
    });
  }

  function buildApiUrl(baseUrl, endpoint, ticketId) {
    const cleanBase = String(baseUrl || "").trim();
    if (!cleanBase) return null;
    const ep = String(endpoint || "").trim();
    const url = new URL(ep || "/", cleanBase);
    if (ticketId) {
      url.searchParams.set("ticketId", ticketId);
      url.searchParams.set("conversationId", ticketId);
    }
    const protocol = sidebarState.protocol || ticketId || "";
    if (protocol) url.searchParams.set("protocol", protocol);
    return url.toString();
  }

  function htmlEscape(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getProtocolFromPayload(protocolPayload) {
    if (!protocolPayload) return "";
    if (typeof protocolPayload === "string") return protocolPayload;
    return protocolPayload.protocol || protocolPayload.id || protocolPayload.ticketId || "";
  }

  function extractIdentityFromData(data) {
    if (!data || typeof data !== 'object') return '';
    const raw = data.resource && typeof data.resource === 'object' ? data.resource : data;
    const extras = raw && typeof raw.extras === 'object' && raw.extras ? raw.extras : {};
    return String(
      raw.identity ||
      raw.identifier ||
      raw.contactIdentity ||
      raw.customerIdentity ||
      extras.identifier ||
      extras.identity ||
      extras['tunnel.originator'] ||
      ''
    ).trim();
  }

  function bindTicketToIdentity(ticketId, identity) {
    if (!ticketId || !identity) return;
    socketState.ticketIdentity.set(ticketId, identity);
    if (socketState.byIdentity.has(identity)) {
      socketState.byTicketId.set(ticketId, socketState.byIdentity.get(identity));
    }
  }

  function getSocketContactForTicket(ticketId) {
    const boundIdentity = ticketId ? socketState.ticketIdentity.get(ticketId) : '';
    if (boundIdentity && socketState.byIdentity.has(boundIdentity)) return socketState.byIdentity.get(boundIdentity);
    if (ticketId && socketState.byTicketId.has(ticketId)) {
      const contact = socketState.byTicketId.get(ticketId);
      const identity = extractIdentityFromData(contact);
      if (identity) bindTicketToIdentity(ticketId, identity);
      return contact;
    }
    return socketState.latestContact || null;
  }


  function textFromNode(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeLabelKey(label) {
    return String(label || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/:$/, '')
      .toLowerCase();
  }

  function getProfileInfoRoot() {
    const roots = Array.from(document.querySelectorAll('bds-paper, .profile-info, .profile-info-content'));
    return roots.find((el) => /informa[cç][õo]es/i.test(textFromNode(el))) || null;
  }

  function extractContactFromProfileDom() {
    const root = getProfileInfoRoot();
    if (!root) return null;

    const map = {};
    const items = Array.from(root.querySelectorAll('p.profile-info-item'));
    for (const item of items) {
      const labelNode = item.querySelector('bds-typo');
      const valueNode = item.querySelector('span');
      const rawLabel = textFromNode(labelNode);
      const key = normalizeLabelKey(rawLabel);
      if (!key) continue;
      const value = textFromNode(valueNode);
      map[key] = value;
    }

    if (!Object.keys(map).length) return null;

    const numero = map['numlogradouro'] || '';
    const logradouro = map['logradouro'] || '';
    const complemento = map['complemento'] || '';
    const endereco = [
      logradouro,
      numero ? `, ${numero}` : ''
    ].filter(Boolean).join('');

    return {
      source: 'dom',
      nome: map['nome'] || '',
      name: map['nome'] || '',
      identity: map['id'] || map['identifier'] || map['tunnel.originator'] || '',
      email: map['e-mail'] || map['email'] || 'Não informado',
      telefone: map['telefone'] || '',
      phone: map['telefone'] || '',
      phoneOutro2: map['phoneoutro2'] || '',
      cpf: map['documento'] || map['cpfretorno'] || '',
      document: map['documento'] || map['cpfretorno'] || '',
      cidade: map['cidade'] || map['citycad'] || '',
      city: map['cidade'] || map['citycad'] || '',
      uf: map['uf'] || map['statecad'] || '',
      estado: map['uf'] || map['statecad'] || '',
      cep: map['cep'] || map['cepcad'] || '',
      bairro: map['bairro'] || '',
      logradouro,
      numero,
      complemento,
      endereco,
      pontoReferencia: map['pontoreferencia'] || '',
      produto: map['nomecampanha'] || map['contact.extras.nomecampanha'] || '',
      product: map['nomecampanha'] || map['contact.extras.nomecampanha'] || '',
      status: map['team'] || '',
      team: map['team'] || '',
      protocol: map['protocol'] || map['protocoloretorno'] || '',
      crmId: map['crmid'] || '',
      familyCode: map['familycode'] || '',
      ibgeCode: map['ibgecode'] || '',
      sessionId: map['sessionid'] || '',
      raw: map,
    };
  }

  async function waitForContactFromDom(timeoutMs = 6000) {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
      const parsed = extractContactFromProfileDom();
      if (parsed && (parsed.name || parsed.identity || parsed.phone || parsed.document)) return parsed;
      await new Promise((r) => setTimeout(r, 250));
    }
    return extractContactFromProfileDom();
  }

  function getContactSignature(contact) {
    if (!contact || typeof contact !== 'object') return '';
    const raw = contact.raw && typeof contact.raw === 'object' ? contact.raw : {};
    return JSON.stringify({
      nome: contact.nome || contact.name || '',
      identity: contact.identity || '',
      email: contact.email || '',
      telefone: contact.telefone || contact.phone || '',
      cpf: contact.cpf || contact.document || '',
      cidade: contact.cidade || contact.city || '',
      uf: contact.uf || contact.estado || '',
      cep: contact.cep || '',
      bairro: contact.bairro || '',
      logradouro: contact.logradouro || '',
      numero: contact.numero || '',
      complemento: contact.complemento || '',
      pontoReferencia: contact.pontoReferencia || '',
      protocol: contact.protocol || '',
      team: contact.team || contact.status || '',
      raw,
    });
  }

  function applyDomContactToCurrentSidebar(contact, ticketId, ticketDisplay = '') {
    if (!contact || !ticketId) return false;
    const signature = getContactSignature(contact);
    const hasMeaningfulData = !!(contact.name || contact.nome || contact.identity || contact.phone || contact.telefone || contact.document || contact.cpf);
    if (!hasMeaningfulData) return false;

    sidebarState.ticketId = ticketId;
    sidebarState.ticketDisplay = ticketDisplay || sidebarState.ticketDisplay || ticketId;
    sidebarState.customer = contact;
    sidebarState.protocol = contact?.protocol || ticketId || '';
    sidebarState.protocolLabel = getSidebarSettings().crmLabel || 'Integração lateral do CRM';
    sidebarState.schedule = {};
    sidebarState.attachments = [];
    sidebarState.loading = false;
    sidebarState.error = '';
    sidebarState.lastContactSignature = signature;

    const resolvedIdentity = extractIdentityFromData(contact);
    if (resolvedIdentity) bindTicketToIdentity(ticketId, resolvedIdentity);

    const cfg = getSidebarSettings();
    sidebarState.validatorUrl = buildValidatorUrl(cfg.validatorUrl || cfg.validator?.baseUrl || '', ticketId, sidebarState.protocol || ticketId);
    renderSidebar();
    return true;
  }

  function normalizeContactPayload(payload) {
    const resource = payload && typeof payload === 'object' ? (payload.resource || payload) : {};
    const extras = resource && typeof resource.extras === 'object' && resource.extras ? resource.extras : {};
    const phone = resource.phoneNumber || extras.phoneNumber || extras.identifier || extras['tunnel.originator'] || '';
    const email = resource.email && String(resource.email).trim() ? resource.email : (extras.email || '');
    const protocol = extras.protocol || resource.protocol || '';
    const addressParts = [
      extras.logradouro,
      extras.numLogradouro && String(extras.numLogradouro).toLowerCase() !== 'sn' ? `, ${extras.numLogradouro}` : (extras.numLogradouro ? `, ${extras.numLogradouro}` : ''),
      extras.complemento ? ` • ${extras.complemento}` : '',
    ].filter(Boolean).join('');

    return {
      source: 'socket',
      identity: resource.identity || extras.identifier || '',
      protocol,
      nome: resource.name || extras.nome || '',
      name: resource.name || extras.nome || '',
      cpf: resource.taxDocument || extras.taxDocument || '',
      document: resource.taxDocument || extras.taxDocument || '',
      telefone: resource.phoneNumber || '',
      phoneOutro2: extras.phoneOutro2 || '',
      phone: phone || resource.phoneNumber || '',
      email: email || 'Não informado',
      cidade: resource.city || extras.cityCad || extras.city || '',
      city: resource.city || extras.cityCad || extras.city || '',
      uf: extras.uf || extras.stateCad || '',
      estado: extras.uf || extras.stateCad || '',
      cep: extras.cep || extras.cepCad || '',
      bairro: extras.bairro || '',
      logradouro: extras.logradouro || '',
      numero: extras.numLogradouro || '',
      complemento: extras.complemento || '',
      endereco: addressParts || '',
      pontoReferencia: extras.pontoReferencia || '',
      produto: extras.nomeCampanha || extras['contact.extras.nomeCampanha'] || '',
      product: extras.nomeCampanha || extras['contact.extras.nomeCampanha'] || '',
      status: extras.team || '',
      team: extras.team || '',
      crmId: extras.crmId || '',
      familyCode: extras.familyCode || '',
      ibgeCode: extras.ibgeCode || '',
      sessionId: extras.sessionId || '',
      lastMessageDate: resource.lastMessageDate || '',
      lastUpdateDate: resource.lastUpdateDate || '',
      raw: resource,
    };
  }

  function applySocketContactToSidebar(contact, ticketId) {
    if (!contact) return;
    const normalized = normalizeContactPayload(contact);
    socketState.latestContact = normalized;
    if (normalized.identity) socketState.byIdentity.set(normalized.identity, normalized);

    const effectiveTicketId = ticketId || sidebarState.ticketId || getCurrentTicketId();
    const currentIdentity = extractIdentityFromData(sidebarState.customer);

    if (effectiveTicketId) {
      socketState.byTicketId.set(effectiveTicketId, normalized);
      if (normalized.identity) bindTicketToIdentity(effectiveTicketId, normalized.identity);
      else if (currentIdentity) bindTicketToIdentity(effectiveTicketId, currentIdentity);
    }

    const shouldUpdateCurrentSidebar = !!(
      sidebarState.ticketId &&
      effectiveTicketId &&
      sidebarState.ticketId === effectiveTicketId &&
      (
        !currentIdentity ||
        !normalized.identity ||
        currentIdentity === normalized.identity
      )
    );

    if (shouldUpdateCurrentSidebar) {
      sidebarState.customer = { ...(sidebarState.customer || {}), ...normalized };
      if (normalized.identity && effectiveTicketId) bindTicketToIdentity(effectiveTicketId, normalized.identity);
      if (!sidebarState.protocol && normalized.protocol) sidebarState.protocol = normalized.protocol;
      renderSidebar();
    }
  }

  function handleSocketMessage(rawData) {
    let parsed = rawData;
    if (typeof rawData === 'string') parsed = safeParse(rawData);
    if (!parsed || typeof parsed !== 'object') return;

    const items = Array.isArray(parsed) ? parsed : [parsed];
    const activeTicketId = sidebarState.ticketId || getCurrentTicketId();

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const isContactEnvelope = item.type === 'application/vnd.lime.contact+json' && (item.status === 'success' || item.method === 'get');
      const isContactResource = item.resource && typeof item.resource === 'object' && item.resource.identity && (item.type === 'application/vnd.lime.contact+json' || item.resource.phoneNumber || item.resource.taxDocument);
      if (!isContactEnvelope && !isContactResource) continue;
      applySocketContactToSidebar(item, activeTicketId);
    }
  }

  function observeSocketInstance(ws) {
    if (!ws || socketState.observedSockets.has(ws)) return;
    socketState.observedSockets.add(ws);
    ws.addEventListener('message', (event) => {
      try {
        handleSocketMessage(event.data);
      } catch {}
    });
  }

  function patchWebSocketForContacts() {
    if (socketState.patched || typeof window.WebSocket !== 'function') return;
    socketState.patched = true;

    const NativeWebSocket = window.WebSocket;

    function PatchedWebSocket(...args) {
      const ws = new NativeWebSocket(...args);
      observeSocketInstance(ws);
      return ws;
    }

    PatchedWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
    try { Object.defineProperty(PatchedWebSocket, 'name', { value: 'WebSocket' }); } catch {}
    try { Object.defineProperty(PatchedWebSocket, 'CONNECTING', { value: NativeWebSocket.CONNECTING }); } catch {}
    try { Object.defineProperty(PatchedWebSocket, 'OPEN', { value: NativeWebSocket.OPEN }); } catch {}
    try { Object.defineProperty(PatchedWebSocket, 'CLOSING', { value: NativeWebSocket.CLOSING }); } catch {}
    try { Object.defineProperty(PatchedWebSocket, 'CLOSED', { value: NativeWebSocket.CLOSED }); } catch {}

    window.WebSocket = PatchedWebSocket;
  }

  function ensureSidebarStyles() {
    if (document.getElementById(DK_SIDEBAR_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = DK_SIDEBAR_STYLE_ID;
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');

      #${DK_SIDEBAR_HOST_ID} {
        /* Quando encaixado ao lado do drawer: elemento de fluxo normal */
        position: relative;
        height: 100%;
        min-height: 0;
        z-index: 10;
        display: flex;
        flex-direction: row-reverse;
        flex-shrink: 0;
        font-family: 'Nunito', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        --bp-blue:        #1A5ED4;
        --bp-blue-hov:    #1550b8;
        --bp-blue-bg:     #EBF2FF;
        --bp-blue-border: #C2D6F8;
        --bp-gray:        #8F8F8F;
        --bp-surface:     #F6F6F6;
        --bp-white:       #FFFFFF;
        --bp-border:      #E4E4E4;
        --bp-onix:        #242B36;
        --bp-city:        #52636C;
        --bp-warning:     #F76556;
        -webkit-font-smoothing: antialiased;
      }

      /* Fallback: quando não consegue encaixar ao lado do drawer */
      #${DK_SIDEBAR_HOST_ID}.dk-fixed-fallback {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        z-index: 9990;
      }

      /* ── Nav bar ── */
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav {
        width: 52px;
        background: var(--bp-white);
        border-left: 1px solid var(--bp-border);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 8px 6px;
      }

      /* Nav buttons base */
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button {
        border: 0;
        background: transparent;
        cursor: pointer;
        border-radius: 12px;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--bp-gray);
        transition: background 0.15s, color 0.15s;
        position: relative;
        flex-shrink: 0;
        padding: 0;
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button:hover {
        background: var(--bp-surface);
        color: var(--bp-blue);
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button.active {
        background: var(--bp-blue-bg);
        color: var(--bp-blue);
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button.active .dkcrm-nav-indicator {
        display: block;
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav-indicator {
        display: none;
        position: absolute;
        left: -1px;
        top: 25%;
        bottom: 25%;
        width: 3px;
        background: var(--bp-blue);
        border-radius: 0 3px 3px 0;
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav-divider {
        width: 28px;
        height: 1px;
        background: var(--bp-border);
        flex-shrink: 0;
        margin: 2px 0;
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav-spacer { flex: 1; }

      /* Tooltips */
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button[data-tip] { position: relative; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button[data-tip]::after {
        content: attr(data-tip);
        position: absolute;
        right: calc(100% + 10px);
        top: 50%;
        transform: translateY(-50%);
        background: var(--bp-onix);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        font-family: 'Nunito', sans-serif;
        white-space: nowrap;
        padding: 4px 8px;
        border-radius: 6px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s;
        z-index: 9999;
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button[data-tip]:hover::after { opacity: 1; }

      /* SVG icons inside nav */
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button svg {
        width: 17px;
        height: 17px;
        display: block;
        flex-shrink: 0;
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button.btn-reload svg { width: 15px; height: 15px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button.btn-toggle svg { width: 16px; height: 16px; }

      /* Reload spin animation */
      @keyframes dkcrm-spin { to { transform: rotate(360deg); } }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-nav button.loading svg { animation: dkcrm-spin 0.8s linear infinite; }

      /* ── Panel ── */
      #${DK_SIDEBAR_HOST_ID} .dkcrm-panel {
        width: ${DK_SIDEBAR_WIDTH}px;
        background: var(--bp-surface);
        border-left: 1px solid var(--bp-border);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: width 0.22s ease, opacity 0.22s ease;
        opacity: 1;
      }
      #${DK_SIDEBAR_HOST_ID}.collapsed .dkcrm-panel {
        width: 0;
        opacity: 0;
        border-left: none;
        pointer-events: none;
      }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-header { display:flex; align-items:center; gap:10px; padding: 12px 16px; background:var(--bp-white); border-bottom:1px solid var(--bp-border); flex-shrink:0; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-header svg { width:16px; height:16px; color:var(--bp-blue); flex-shrink:0; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-header-title { font-weight:700; font-size:14px; color:var(--bp-onix); flex:1; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-protocol { display:flex; justify-content:space-between; align-items:center; gap:10px; padding: 10px 16px; background:var(--bp-blue-bg); border-bottom:1px solid var(--bp-blue-border); flex-shrink:0; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-protocol small { display:block; color:var(--bp-gray); text-transform:uppercase; letter-spacing:.08em; font-size:9px; font-weight:700; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-protocol strong { color:var(--bp-blue); font-size:14px; font-weight:800; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-body { flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-body::-webkit-scrollbar { width:4px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-body::-webkit-scrollbar-track { background:transparent; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-body::-webkit-scrollbar-thumb { background:#D4D4D4; border-radius:4px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-field { background:var(--bp-white); border:1px solid var(--bp-border); border-radius:14px; padding:10px 12px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-field.full { grid-column:1/-1; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-field label { display:block; font-size:10px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--bp-gray); margin-bottom:4px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-field span { display:block; font-size:13px; font-weight:700; color:var(--bp-onix); line-height:1.35; word-break:break-word; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-card { background:var(--bp-white); border:1px solid var(--bp-border); border-radius:14px; padding:12px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-note { background:var(--bp-blue-bg); color:var(--bp-city); border:1px solid var(--bp-blue-border); border-radius:14px; padding:10px 12px; font-size:12px; font-weight:600; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-empty, #${DK_SIDEBAR_HOST_ID} .dkcrm-error { background:var(--bp-white); border:1px dashed var(--bp-border); border-radius:14px; padding:18px 14px; text-align:center; color:var(--bp-gray); font-size:13px; font-weight:600; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-error { border-style:solid; border-color:#fcc; background:#fff5f4; color:var(--bp-warning); }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-list { display:flex; flex-direction:column; gap:8px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-link { color:var(--bp-blue); text-decoration:none; font-weight:700; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-link:hover { text-decoration:underline; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-upload { display:flex; align-items:center; justify-content:center; height:42px; border-radius:12px; background:var(--bp-blue); color:#fff; cursor:pointer; font-weight:700; font-family:'Nunito',sans-serif; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-upload:hover { background:var(--bp-blue-hov); }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-upload input { display:none; }
      #${DK_SIDEBAR_HOST_ID} iframe { width:100%; min-height:320px; height:100%; border:0; background:var(--bp-white); border-radius:14px; }
      #${DK_SIDEBAR_HOST_ID} .dkcrm-footer-space { flex:1; }
    `;
    document.documentElement.appendChild(style);
  }

  // Seletores do drawer do Blip Desk — tenta do mais específico ao mais genérico
  const BLIP_DRAWER_SELECTORS = [
    'aside[class*="contact"]',
    'aside[class*="drawer"]',
    'aside[class*="detail"]',
    'aside[class*="info"]',
    '[class*="contact-info"]',
    '[class*="contactPanel"]',
    '[class*="contact_panel"]',
    '[class*="right-panel"]',
    '[class*="rightPanel"]',
    '[data-testid*="contact"]',
    '[data-testid*="drawer"]',
    // fallback: último aside visível na viewport direita
    'aside',
  ];

  function findBlipDrawer() {
    for (const sel of BLIP_DRAWER_SELECTORS) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const r = el.getBoundingClientRect();
          // Deve estar visível, ter altura razoável e estar na metade direita da tela
          if (r.width > 50 && r.height > 100 && r.right >= window.innerWidth * 0.5) {
            return el;
          }
        }
      } catch {}
    }
    return null;
  }

  function ensureSidebarHost() {
    ensureSidebarStyles();
    let host = document.getElementById(DK_SIDEBAR_HOST_ID);

    const shouldShow = !!sidebarState.ticketId;

    if (!shouldShow) {
      if (host) host.style.display = "none";
      return host || document.createElement("div"); // dummy
    }

    // Tenta encaixar ao lado do drawer do Blip
    const drawer = findBlipDrawer();

    if (!host) {
      host = document.createElement("div");
      host.id = DK_SIDEBAR_HOST_ID;
    }

    if (drawer) {
      // Insere imediatamente APÓS o drawer no mesmo container flex
      const parent = drawer.parentElement;
      if (host.parentElement !== parent) {
        // Garante que o pai seja flex (ou grid) para os elementos ficarem lado a lado
        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.display !== 'flex' && parentStyle.display !== 'grid') {
          parent.style.display = 'flex';
          parent.style.alignItems = 'stretch';
        }
        // Remove de onde estava e re-insere após o drawer
        host.remove();
        drawer.insertAdjacentElement('afterend', host);
      }
      host.classList.remove('dk-fixed-fallback');
    } else {
      // Fallback: fixed à direita caso o drawer não seja encontrado
      if (!host.parentElement) document.body.appendChild(host);
      host.classList.add('dk-fixed-fallback');
    }

    host.classList.toggle("collapsed", !!sidebarState.collapsed);
    host.style.display = "flex";
    return host;
  }

  // Inline SVG icons — Lucide-style, matching the main CRM project
  const SVG_ICONS = {
    validador:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
    cliente:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    anexo:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
    agendamento:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="12 14 12 16 13.5 17"/><circle cx="12" cy="16" r="3.5"/></svg>`,
    reload:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    chevronLeft:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    close:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  };

  function iconForTab(tab) {
    return SVG_ICONS[tab] || SVG_ICONS.cliente;
  }

  function renderField(label, value, full = false) {
    return `<div class="dkcrm-field ${full ? 'full' : ''}"><label>${htmlEscape(label)}</label><span>${htmlEscape(value || '—')}</span></div>`;
  }

  function renderCustomerPanel() {
    const c = sidebarState.customer || {};
    return `
      <div class="dkcrm-grid">
        ${renderField('Nome', c.nome || c.name, true)}
        ${renderField('CPF', c.cpf || c.document)}
        ${renderField('Telefone', c.telefone || c.phone)}
        ${renderField('Telefone 2', c.phoneOutro2)}
        ${renderField('E-mail', c.email, true)}
        ${renderField('Cidade', c.cidade || c.city)}
        ${renderField('UF', c.uf || c.estado)}
        ${renderField('CEP', c.cep)}
        ${renderField('Bairro', c.bairro)}
        ${renderField('Endereço', c.endereco || c.logradouro, true)}
        ${renderField('Complemento', c.complemento)}
        ${renderField('Referência', c.pontoReferencia)}
      </div>
    `;
  }

  function renderSchedulePanel() {
    const s = sidebarState.schedule || {};
    return `
      <div class="dkcrm-grid">
        ${renderField('Data', s.data || s.date)}
        ${renderField('Hora', s.hora || s.time)}
        ${renderField('Canal', s.canal || s.channel)}
        ${renderField('Responsável', s.responsavel || s.owner)}
      </div>
      <div class="dkcrm-footer-space"></div>
      <button class="icon-btn" data-dk-action="schedule-action" style="width:100%;height:42px;border-radius:12px;background:var(--bp-blue);color:#fff;font-size:14px;font-weight:700;border:0;cursor:pointer;font-family:inherit;">Realizar Agendamento</button>
    `;
  }

  function renderAttachmentsPanel() {
    const items = Array.isArray(sidebarState.attachments) ? sidebarState.attachments : [];
    const list = items.length
      ? `<div class="dkcrm-list">${items.map((item) => `
          <div class="dkcrm-card">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:16px;">📎</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;color:var(--bp-onix);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${htmlEscape(item.nome || item.name || 'Arquivo')}</div>
                ${(item.url || item.href) ? `<a class="dkcrm-link" href="${htmlEscape(item.url || item.href)}" target="_blank" rel="noreferrer">abrir</a>` : `<span style="color:var(--bp-gray);font-size:12px;">sem link</span>`}
              </div>
            </div>
          </div>`).join('')}</div>`
      : `<div class="dkcrm-empty">Nenhum arquivo anexado.</div>`;

    return `${list}<label class="dkcrm-upload">Anexar arquivo<input data-dk-upload type="file" /></label>`;
  }

  function renderValidatorPanel() {
    if (!sidebarState.validatorUrl) return `<div class="dkcrm-empty">Configure <strong>validatorUrl</strong> na feature <strong>deskSidebar</strong> para exibir o validador.</div>`;
    return `<iframe title="Validador" src="${htmlEscape(sidebarState.validatorUrl)}"></iframe>`;
  }

  function renderBody() {
    if (sidebarState.loading) return `<div class="dkcrm-empty">Carregando dados do ticket…</div>`;
    if (sidebarState.error) return `<div class="dkcrm-error">${htmlEscape(sidebarState.error)}</div>`;
    if (sidebarState.activeTab === 'validador') return renderValidatorPanel();
    if (sidebarState.activeTab === 'anexo') return renderAttachmentsPanel();
    if (sidebarState.activeTab === 'agendamento') return renderSchedulePanel();
    return renderCustomerPanel();
  }

  function renderSidebar() {
    if (!isSidebarEnabled()) return;
    if (isExtensionSidePanelMode()) {
      removeSidebar();
      emitSidePanelContext();
      return;
    }
    const host = ensureSidebarHost();
    // Sem ticket selecionado: host já fica oculto via ensureSidebarHost
    if (!sidebarState.ticketId) return;

    const TAB_LABELS = { validador: 'Validador', cliente: 'Contatos', anexo: 'Anexos', agendamento: 'Agendamento' };
    const activeTitle = TAB_LABELS[sidebarState.activeTab] || 'CRM lateral';
    const tabs = ['validador', 'cliente', 'anexo', 'agendamento'];
    const isCollapsed = !!sidebarState.collapsed;

    const tabButtons = tabs.map(tab => {
      const isActive = sidebarState.activeTab === tab && !isCollapsed;
      return `<button
        data-dk-tab="${tab}"
        class="${isActive ? 'active' : ''}"
        data-tip="${TAB_LABELS[tab]}"
      ><span class="dkcrm-nav-indicator"></span>${iconForTab(tab)}</button>`;
    }).join('');

    // Nav fica à direita: chevron aponta para a esquerda quando colapsado (expandir)
    // e para a direita quando aberto (recolher o panel)
    const toggleIcon = isCollapsed ? SVG_ICONS.chevronLeft : SVG_ICONS.chevronRight;
    const toggleTip  = isCollapsed ? 'Expandir' : 'Recolher';

    host.innerHTML = `
      <nav class="dkcrm-nav">
        <button class="btn-reload${sidebarState.loading ? ' loading' : ''}" data-dk-action="reload" data-tip="Recarregar">${SVG_ICONS.reload}</button>
        <div class="dkcrm-nav-divider"></div>
        ${tabButtons}
        <div class="dkcrm-nav-spacer"></div>
        <button class="btn-toggle" data-dk-action="toggle" data-tip="${toggleTip}">${toggleIcon}</button>
      </nav>
      <section class="dkcrm-panel">
        <div class="dkcrm-header">
          ${iconForTab(sidebarState.activeTab)}
          <div class="dkcrm-header-title">${htmlEscape(activeTitle)}</div>
        </div>
        <div class="dkcrm-protocol">
          <div>
            <small>Protocolo</small>
            ${sidebarState.protocolLabel ? `<div style="font-size:10px;color:var(--bp-blue);font-weight:700;">${htmlEscape(sidebarState.protocolLabel)}</div>` : ''}
          </div>
          <strong>${htmlEscape(sidebarState.protocol || sidebarState.ticketDisplay || '···')}</strong>
        </div>
        <div class="dkcrm-body">${renderBody()}</div>
      </section>
    `;
    emitSidePanelContext();
  }

  function removeSidebar() {
    document.getElementById(DK_SIDEBAR_HOST_ID)?.remove();
  }

  function getAgentEmail() {
    const candidates = [
      'ajs_user_traits',
      'auth',
      'blipDeskAccount',
      'blip-account',
      'user',
    ];

    for (const key of candidates) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = safeParse(raw);
        if (!parsed || typeof parsed !== 'object') continue;
        const email = parsed?.email || parsed?.user?.email || parsed?.traits?.email || parsed?.account?.email;
        if (email && String(email).trim()) return String(email).trim();
      } catch {}
    }

    return '';
  }

  function buildValidatorUrl(baseUrl, ticketId, protocol) {
    const cpf = String(sidebarState?.customer?.cpf || sidebarState?.customer?.document || '').replace(/\D+/g, '');
    const emailOperador = getAgentEmail();

    let resolvedBaseUrl = String(baseUrl || '').trim();
    if (!resolvedBaseUrl) {
      resolvedBaseUrl = 'https://sigaantenado.datasintese.com/crm_eaf/validacao_beneficiario.php?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMjAyNCIsImlhdCI6MTcwMTg5MzIzM30.A-y9Zr4VpWfhQAEwmaKo4u6Lbu7-Sq5H9X_hRdAdJLY&id_crm=2024171953&grupo=9';
    }

    try {
      resolvedBaseUrl = resolvedBaseUrl
        .replace(/\(cpf aqui\)/gi, encodeURIComponent(cpf))
        .replace(/\(usu[aá]rio logado aqui\)/gi, encodeURIComponent(emailOperador));

      const url = new URL(resolvedBaseUrl);
      if (cpf) url.searchParams.set('cpf', cpf);
      if (emailOperador) url.searchParams.set('email_operador', emailOperador);
      return url.toString();
    } catch {
      return String(resolvedBaseUrl || '')
        .replace(/\(cpf aqui\)/gi, cpf)
        .replace(/\(usu[aá]rio logado aqui\)/gi, emailOperador);
    }
  }

  async function loadSidebarData(ticketId, ticketDisplay = '') {
    const cfg = getSidebarSettings();

    sidebarState.ticketId = ticketId;
    sidebarState.ticketDisplay = ticketDisplay || ticketId || '';
    sidebarState.loading = true;
    sidebarState.error = '';
    sidebarState.validatorUrl = buildValidatorUrl(cfg.validatorUrl || cfg.validator?.baseUrl || '', ticketId, sidebarState.protocol || ticketId);
    renderSidebar();

    const loadKey = `${ticketId}:${Date.now()}`;
    sidebarState.lastLoadKey = loadKey;

    try {
      const domContact = await waitForContactFromDom(7000);
      if (sidebarState.lastLoadKey !== loadKey) return;

      sidebarState.customer = domContact || {};
      sidebarState.lastObservedTicketId = ticketId;
      sidebarState.lastContactSignature = getContactSignature(domContact);
      sidebarState.protocol = domContact?.protocol || ticketId || '';
      sidebarState.protocolLabel = cfg.crmLabel || 'Integração lateral do CRM';
      sidebarState.schedule = {};
      sidebarState.attachments = [];
      sidebarState.validatorUrl = buildValidatorUrl(cfg.validatorUrl || cfg.validator?.baseUrl || '', ticketId, sidebarState.protocol || ticketId);
      sidebarState.loading = false;
      sidebarState.error = domContact ? '' : 'Não foi possível localizar os dados na área Informações do contato.';

      const resolvedIdentity = extractIdentityFromData(sidebarState.customer);
      if (resolvedIdentity) bindTicketToIdentity(ticketId, resolvedIdentity);
      renderSidebar();
    } catch (error) {
      if (sidebarState.lastLoadKey !== loadKey) return;
      sidebarState.loading = false;
      sidebarState.customer = {};
      sidebarState.lastContactSignature = '';
      sidebarState.error = error?.message || 'Falha ao ler os dados do contato na tela.';
      renderSidebar();
    }
  }

  function openSidebarForTicket(ticketId, ticketDisplay) {
    if (!ticketId || !isSidebarEnabled()) return;
    const isNewTicket = sidebarState.ticketId !== ticketId;
    sidebarState.visible = true;
    // Novo ticket: inicia colapsado — apenas a nav lateral fica visível
    if (isNewTicket) sidebarState.collapsed = true;
    if (!sidebarState.activeTab) sidebarState.activeTab = 'cliente';
    requestExtensionSidePanelOpen();
    renderSidebar();
    loadSidebarData(ticketId, ticketDisplay);
  }

  function closeSidebar() {
    sidebarState.visible = false;
    sidebarState.ticketId = null;
    sidebarState.ticketDisplay = '';
    sidebarState.protocol = '';
    sidebarState.customer = null;
    sidebarState.schedule = null;
    sidebarState.attachments = [];
    sidebarState.validatorUrl = '';
    sidebarState.loading = false;
    sidebarState.error = '';
    sidebarState.lastEmittedPanelSignature = '';
    emitSidePanelContext();
    removeSidebar();
  }

  document.addEventListener('click', (event) => {
    const host = document.getElementById(DK_SIDEBAR_HOST_ID);
    const tabButton = event.target.closest?.('[data-dk-tab]');
    if (tabButton && host?.contains(tabButton)) {
      const newTab = tabButton.getAttribute('data-dk-tab') || 'cliente';
      // Se clicar na aba já ativa e o panel já está aberto: fecha
      if (sidebarState.activeTab === newTab && !sidebarState.collapsed) {
        sidebarState.collapsed = true;
      } else {
        sidebarState.activeTab = newTab;
        sidebarState.collapsed = false;
      }
      renderSidebar();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const actionButton = event.target.closest?.('[data-dk-action]');
    if (actionButton && host?.contains(actionButton)) {
      const action = actionButton.getAttribute('data-dk-action');
      if (action === 'toggle') { sidebarState.collapsed = !sidebarState.collapsed; renderSidebar(); }
      if (action === 'reload' && sidebarState.ticketId) loadSidebarData(sidebarState.ticketId, sidebarState.ticketDisplay);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!isSidebarEnabled()) return;

    // Clique fora da sidebar (e fora de um card/ticket): fecha o panel
    if (host && !host.contains(event.target) && !sidebarState.collapsed) {
      const cardRoot = findCardRootFromMenu(event.target) || event.target.closest?.('article, bds-card, [data-testid*="ticket" i]');
      if (!cardRoot) {
        sidebarState.collapsed = true;
        renderSidebar();
        return;
      }
    }

    if (host?.contains(event.target)) return;

    const cardRoot = findCardRootFromMenu(event.target) || event.target.closest?.('article, bds-card, [data-testid*="ticket" i]');
    const ticketId = getTicketIdFromContext(cardRoot);
    if (!ticketId) return;
    const ticketDisplay = getTicketDisplayFromCard(cardRoot, ticketId);
    openSidebarForTicket(ticketId, ticketDisplay);
  }, true);

  document.addEventListener('change', async (event) => {
    if (!event.target.matches?.('[data-dk-upload]')) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const cfg = getSidebarSettings();
    if (!cfg.apiBaseUrl || !cfg.uploadEndpoint || !sidebarState.ticketId) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('ticketId', sidebarState.ticketId);
    formData.append('protocol', sidebarState.protocol || sidebarState.ticketId);

    try {
      await apiFetchViaContent(buildApiUrl(cfg.apiBaseUrl, cfg.uploadEndpoint, sidebarState.ticketId), { method: 'POST', body: formData });
      loadSidebarData(sidebarState.ticketId, sidebarState.ticketDisplay);
    } catch (error) {
      sidebarState.error = error?.message || 'Falha ao enviar arquivo.';
      renderSidebar();
    }
  });

  let domContactRefreshTimer = null;
  function scheduleDomContactRefresh() {
    if (domContactRefreshTimer) clearTimeout(domContactRefreshTimer);
    domContactRefreshTimer = setTimeout(() => {
      domContactRefreshTimer = null;
      const activeTicketId = sidebarState.ticketId || getCurrentTicketId();
      if (!activeTicketId) return;
      const parsed = extractContactFromProfileDom();
      if (!parsed) return;
      const nextSignature = getContactSignature(parsed);
      const currentTicketChanged = sidebarState.lastObservedTicketId && sidebarState.lastObservedTicketId !== activeTicketId;
      const contactChanged = !!nextSignature && nextSignature !== sidebarState.lastContactSignature;
      if (!currentTicketChanged && !contactChanged) return;
      applyDomContactToCurrentSidebar(parsed, activeTicketId, sidebarState.ticketDisplay || activeTicketId);
      sidebarState.lastObservedTicketId = activeTicketId;
    }, 180);
  }

  const domContactObserver = new MutationObserver(() => {
    if (!enabled || !isSidebarEnabled()) return;
    scheduleDomContactRefresh();
  });
  domContactObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  setInterval(() => {
    if (!enabled || !isSidebarEnabled()) return;
    const currentTicketId = getCurrentTicketId();
    if (!currentTicketId) return;

    if (sidebarState.ticketId && sidebarState.ticketId !== currentTicketId) {
      const display = sidebarState.ticketDisplay || currentTicketId;
      sidebarState.lastObservedTicketId = currentTicketId;
      sidebarState.lastContactSignature = '';
      loadSidebarData(currentTicketId, display);
      return;
    }

    const parsed = extractContactFromProfileDom();
    if (!parsed) return;
    const nextSignature = getContactSignature(parsed);
    if (nextSignature && nextSignature !== sidebarState.lastContactSignature && sidebarState.ticketId === currentTicketId) {
      applyDomContactToCurrentSidebar(parsed, currentTicketId, sidebarState.ticketDisplay || currentTicketId);
      sidebarState.lastObservedTicketId = currentTicketId;
    }
  }, 700);

  // Polling leve: garante reinjeção após navegação SPA
  setInterval(() => {
    if (!enabled) return;
    if (!document.getElementById(TF_WRAP_ID)) tfState.injected = false;
    tfInject();
  }, 800);


})();