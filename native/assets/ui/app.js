(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let state = null;
  let lastRenderedMessageCount = 0;
  let lastSelectedConversationId = null;
  let historyRequestCursor = null;
  let historyRequestInFlight = false;
  let historyPreviousHeight = 0;

  function send(type, payload = {}) {
    if (window.ipc && typeof window.ipc.postMessage === "function") {
      window.ipc.postMessage(JSON.stringify({ type, ...payload }));
    }
  }

  function text(element, value) {
    element.textContent = value || "";
  }

  function initials(user, fallback = "?") {
    const name = user && (user.global_name || user.username);
    if (!name) return fallback;
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || fallback;
  }

  function displayName(user, fallback = "Conversación") {
    return user && (user.global_name || user.username) || fallback;
  }

  function avatarUrl(user) {
    if (!user || !user.id) return null;
    if (user.avatar) {
      return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=128`;
    }
    const discriminator = Number.parseInt(user.discriminator || "0", 10) || 0;
    return `https://cdn.discordapp.com/embed/avatars/${discriminator % 5}.png`;
  }

  function conversationTitle(conversation) {
    if (conversation.name) return conversation.name;
    const recipients = (conversation.recipients || []).map((user) => displayName(user, "Usuario"));
    return recipients.join(", ") || "Conversación sin nombre";
  }

  function conversationSubtitle(conversation) {
    const group = conversation.kind === 3 || (conversation.recipients || []).length > 1 || Boolean(conversation.name);
    return group ? `${Math.max(1, (conversation.recipients || []).length)} miembros` : "Mensaje directo";
  }

  function setAvatar(element, user, extraClass = "") {
    element.className = `avatar ${extraClass}`.trim();
    const fallback = document.createElement("span");
    fallback.className = "avatar-fallback";
    fallback.textContent = initials(user);
    element.replaceChildren(fallback);
    if (user) element.classList.add("online");
    const url = avatarUrl(user);
    if (url) {
      const image = document.createElement("img");
      image.alt = `${displayName(user, "Usuario")} avatar`;
      image.loading = "lazy";
      image.decoding = "async";
      image.src = url;
      image.addEventListener("error", () => image.remove(), { once: true });
      element.append(image);
    }
  }

  function trustedAttachmentUrl(attachment) {
    const candidates = [attachment?.url, attachment?.proxy_url];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const parsed = new URL(candidate);
        const hostname = parsed.hostname.toLowerCase();
        const discordHost = hostname === "discordapp.com" || hostname.endsWith(".discordapp.com") || hostname === "discordapp.net" || hostname.endsWith(".discordapp.net");
        if (parsed.protocol === "https:" && discordHost) return parsed.href;
      } catch {
        // Ignore malformed attachment URLs and keep rendering the message.
      }
    }
    return null;
  }

  function isImageAttachment(attachment) {
    const contentType = String(attachment?.content_type || "").toLowerCase();
    if (contentType.startsWith("image/")) return true;
    return /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(attachment?.filename || "");
  }

  function renderAttachments(message) {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.length) return null;
    const container = document.createElement("div");
    container.className = "message-attachments";
    attachments.forEach((attachment) => {
      const url = trustedAttachmentUrl(attachment);
      const filename = attachment.filename || "Archivo adjunto";
      if (url && isImageAttachment(attachment)) {
        const figure = document.createElement("figure");
        figure.className = "message-attachment";
        const image = document.createElement("img");
        image.className = "message-attachment-image";
        image.alt = filename;
        image.loading = "lazy";
        image.decoding = "async";
        if (attachment.width) image.width = Math.min(attachment.width, 960);
        if (attachment.height) image.height = Math.min(attachment.height, 720);
        image.src = url;
        const caption = document.createElement("figcaption");
        caption.textContent = filename;
        image.addEventListener("error", () => {
          figure.classList.add("broken");
          image.remove();
          caption.textContent = `No se pudo cargar ${filename}`;
        }, { once: true });
        figure.append(image, caption);
        container.append(figure);
        return;
      }
      const file = document.createElement("div");
      file.className = "message-attachment-file";
      file.textContent = url ? filename : `Adjunto no disponible: ${filename}`;
      container.append(file);
    });
    return container;
  }

  function sendButtonState() {
    const sending = state && state.send_state.state === "sending";
    $("send-button").disabled = sending;
    $("composer-input").disabled = sending;
  }

  function renderLogin() {
    const showLogin = !state || state.auth !== "authenticated";
    $("login-screen").classList.toggle("hidden", !showLogin);
    $("app-shell").classList.toggle("hidden", showLogin);
    if (!showLogin) return;
    $("email").value = state?.login_email || $("email").value || "";
    $("login-button").disabled = state?.auth === "authenticating";
    $("login-button").textContent = state?.auth === "authenticating" ? "Conectando…" : "Iniciar sesión";
    text($("login-error"), state?.login_error || "");
    if (state?.auth === "loading") text($("login-error"), "Comprobando sesión segura…");
  }

  function renderAccount() {
    const user = state.user;
    const name = displayName(user, "Usuario");
    text($("account-name"), name);
    text($("account-handle"), user?.username ? `@${user.username}` : "");
    text($("profile-name"), name);
    text($("profile-handle"), user?.username ? `@${user.username}` : "");
    setAvatar($("account-avatar"), user, "avatar-small");
    setAvatar($("profile-avatar"), user, "avatar-profile");
  }

  function renderConversationHeader() {
    const conversation = state.selected_conversation;
    if (!conversation) {
      setAvatar($("conversation-avatar"), null, "avatar-medium");
      text($("conversation-name"), "Selecciona una conversación");
      text($("conversation-subtitle"), "Tus mensajes directos aparecerán aquí");
      return;
    }
    setAvatar($("conversation-avatar"), conversation.recipients?.[0], "avatar-medium");
    text($("conversation-name"), conversationTitle(conversation));
    text($("conversation-subtitle"), conversationSubtitle(conversation));
  }

  function renderConnection() {
    const connection = state.connection;
    $("connection-dot").className = `status-dot ${connection.state}`;
    text($("connection-label"), connection.label);
    text($("sync-label"), state.sync.state === "loading" ? "Sincronizando…" : state.sync.state === "ready" ? "Sincronizado" : state.sync.state === "error" ? "Error de sincronización" : "Sin sincronizar");
    const profile = $("profile-connection");
    profile.innerHTML = `<span class="status-dot ${connection.state}"></span> ${escapeHtml(connection.label)}`;
    if (connection.detail) profile.title = connection.detail;
  }

  function renderConversations() {
    const query = ($("dm-search").value || "").trim().toLocaleLowerCase();
    const conversations = state.conversations.filter((conversation) => conversationTitle(conversation).toLocaleLowerCase().includes(query));
    text($("dm-count"), String(state.conversations.length));
    const list = $("dm-list");
    list.replaceChildren();
    conversations.forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `dm-row ${conversation.id === state.selected_conversation_id ? "active" : ""}`;
      button.setAttribute("role", "listitem");
      const avatar = document.createElement("div");
      setAvatar(avatar, conversation.recipients[0], "avatar-small");
      const copy = document.createElement("div");
      copy.className = "dm-copy";
      const title = document.createElement("strong");
      title.textContent = conversationTitle(conversation);
      const subtitle = document.createElement("span");
      subtitle.textContent = conversationSubtitle(conversation);
      copy.append(title, subtitle);
      button.append(avatar, copy);
      button.addEventListener("click", () => send("select_conversation", { id: conversation.id }));
      list.append(button);
    });
    const status = $("dm-list-status");
    status.className = "sidebar-status";
    if (state.sync.state === "error") {
      status.classList.add("error");
      text(status, state.sync.error || "No se pudieron cargar tus DMs.");
    } else if (state.sync.state === "loading") {
      text(status, "Cargando conversaciones…");
    } else if (!state.conversations.length) {
      text(status, "No hay conversaciones privadas disponibles.");
    } else if (!conversations.length) {
      text(status, "No hay coincidencias.");
    } else {
      text(status, "");
    }
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) return "";
    return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(date);
  }

  function renderMessages() {
    if (lastSelectedConversationId !== state.selected_conversation_id) {
      lastSelectedConversationId = state.selected_conversation_id;
      historyRequestCursor = null;
      historyRequestInFlight = false;
      lastRenderedMessageCount = 0;
    }
    const list = $("message-list");
    const area = $("message-area");
    list.replaceChildren();
    const messages = state.messages || [];
    if (!state.selected_conversation) {
      list.append(emptyState("Selecciona una conversación", "Tus mensajes directos aparecerán aquí cuando estén disponibles."));
    } else if (!messages.length && state.sync.state === "loading") {
      list.append(emptyState("Cargando mensajes…", "Estamos sincronizando esta conversación."));
    } else if (!messages.length && state.sync.state === "error") {
      const errorState = emptyState("No se pudieron cargar los mensajes", state.sync.error || "Discord rechazó la carga de esta conversación.");
      errorState.classList.add("error");
      list.append(errorState);
    } else if (!messages.length) {
      list.append(emptyState("Esta conversación está vacía", "Cuando envíes o recibas un mensaje aparecerá aquí."));
    } else {
      let previous = null;
      let previousDay = null;
      messages.forEach((message) => {
        const day = new Date(message.timestamp).toDateString();
        const sameDayAsPrevious = previousDay === day;
        if (day !== previousDay) {
          const divider = document.createElement("div");
          divider.className = "message-day";
          divider.textContent = formatDate(message.timestamp);
          list.append(divider);
          previousDay = day;
        }
        const grouped = previous && previous.author.id === message.author.id && sameDayAsPrevious;
        const row = document.createElement("article");
        row.className = `message ${grouped ? "grouped" : ""} ${message.pending ? "pending" : ""} ${message.failed ? "failed" : ""}`;
        if (!grouped) {
          const avatar = document.createElement("div");
          setAvatar(avatar, message.author, "message-avatar");
          row.append(avatar);
        }
        const body = document.createElement("div");
        body.className = "message-body";
        if (!grouped) {
          const meta = document.createElement("div");
          meta.className = "message-meta";
          const author = document.createElement("strong");
          author.textContent = displayName(message.author, "Usuario");
          const time = document.createElement("time");
          time.textContent = formatTime(message.timestamp);
          meta.append(author, time);
          body.append(meta);
        }
        const content = document.createElement("p");
        content.className = "message-text";
        content.textContent = message.content;
        if (message.edited_timestamp) content.classList.add("edited");
        body.append(content);
        const attachments = renderAttachments(message);
        if (attachments) body.append(attachments);
        if (message.failed) {
          const retry = document.createElement("button");
          retry.className = "retry-button";
          retry.type = "button";
          retry.textContent = "Reintentar envío";
          retry.addEventListener("click", () => send("retry_message", { content: message.content }));
          body.append(retry);
        }
        row.append(body);
        list.append(row);
        previous = message;
      });
    }
    $("load-more-button").classList.toggle("hidden", !state.selected_conversation || !messages.length);
    $("load-more-button").disabled = state.loading_more;
    if (lastRenderedMessageCount !== messages.length) {
      if (historyRequestInFlight && !state.loading_more) {
        area.scrollTop = Math.max(0, area.scrollHeight - historyPreviousHeight);
        historyRequestInFlight = false;
      } else if (!historyRequestInFlight) {
        area.scrollTop = area.scrollHeight;
      }
      lastRenderedMessageCount = messages.length;
    } else if (historyRequestInFlight && !state.loading_more) {
      historyRequestInFlight = false;
    }
  }

  function requestHistory() {
    if (!state?.selected_conversation || state.loading_more || historyRequestInFlight) return;
    const before = state.messages?.[0]?.id;
    if (!before || before === historyRequestCursor) return;
    historyRequestCursor = before;
    historyRequestInFlight = true;
    historyPreviousHeight = $("message-area").scrollHeight;
    send("load_more", { conversation_id: state.selected_conversation.id, before });
  }

  function emptyState(title, description) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.innerHTML = `<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>`;
    return empty;
  }

  function renderComposer() {
    const enabled = Boolean(state.selected_conversation);
    $("composer-form").classList.toggle("hidden", !enabled);
    $("composer-status").className = `composer-status ${state.send_state.state === "failed" ? "error" : ""}`;
    let message = state.send_state.error || "";
    if (state.send_state.state === "sending") message = "Enviando…";
    text($("composer-status"), message);
    sendButtonState();
  }

  function renderNotice() {
    const notice = $("notice");
    notice.classList.toggle("hidden", !state.notice);
    text(notice, state.notice || "");
  }

  function renderModal() {
    $("add-friend-modal").classList.toggle("hidden", !state.show_add_friend);
    text($("friend-error"), state.add_friend_error || "");
    if (state.show_add_friend) $("friend-identifier").focus();
  }

  function render() {
    if (!state) return;
    renderLogin();
    if (state.auth !== "authenticated") return;
    renderAccount();
    renderConversationHeader();
    renderConnection();
    renderConversations();
    renderMessages();
    renderComposer();
    renderNotice();
    renderModal();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
  }

  window.mooncordReceive = (nextState) => { state = nextState; render(); };

  $("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    send("login", { email: $("email").value, password: $("password").value });
  });
  $("composer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state?.selected_conversation) return;
    const input = $("composer-input");
    send("send_message", { conversation_id: state.selected_conversation.id, content: input.value });
    input.value = "";
  });
  $("composer-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("composer-form").requestSubmit(); }
  });
  $("composer-input").addEventListener("input", (event) => { event.target.style.height = "auto"; event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`; });
  $("dm-search").addEventListener("input", render);
  $("logout-button").addEventListener("click", () => send("logout"));
  $("clear-cache-button").addEventListener("click", () => send("clear_cache"));
  $("diagnostics-button").addEventListener("click", () => send("export_diagnostics"));
  $("load-more-button").addEventListener("click", requestHistory);
  $("message-area").addEventListener("scroll", () => {
    if ($("message-area").scrollTop <= 28) requestHistory();
  }, { passive: true });
  $("add-friend-button").addEventListener("click", () => { if (state) { state.show_add_friend = true; renderModal(); } });
  $("close-modal-button").addEventListener("click", () => { if (state) { state.show_add_friend = false; renderModal(); } });
  $("friend-submit-button").addEventListener("click", () => send("add_friend", { identifier: $("friend-identifier").value }));
  $("friend-identifier").addEventListener("keydown", (event) => { if (event.key === "Enter") $("friend-submit-button").click(); });
})();
