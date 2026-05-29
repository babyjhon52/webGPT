const SESSION_KEY = "bmstugpt-session";

const fallbackModels = [
  { id: "qwen/qwen3.6-plus", name: "qwen3.6-plus" },
  { id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
];
const models = fallbackModels.slice();

const defaultSystemPrompt =
  "Ты полезный ассистент. Отвечай ясно, структурно и на русском языке.";

const elements = {
  authPage: document.querySelector("#authPage"),
  appShell: document.querySelector("#appShell"),
  sidebar: document.querySelector("#sidebar"),
  authForm: document.querySelector("#authForm"),
  authSubmit: document.querySelector("#authSubmit"),
  authError: document.querySelector("#authError"),
  authTabs: document.querySelectorAll("[data-auth-mode]"),
  registerOnlyFields: document.querySelectorAll("[data-register-only]"),
  loginInput: document.querySelector("#loginInput"),
  passwordInput: document.querySelector("#passwordInput"),
  nameInput: document.querySelector("#nameInput"),
  emailInput: document.querySelector("#emailInput"),
  accountShort: document.querySelector("#accountShort"),
  chatList: document.querySelector("#chatList"),
  chatBody: document.querySelector("#chatBody"),
  newChatButton: document.querySelector("#newChatButton"),
  themeButton: document.querySelector("#themeButton"),
  themeButtonText: document.querySelector("#themeButtonText"),
  settingsButton: document.querySelector("#settingsButton"),
  logoutButton: document.querySelector("#logoutButton"),
  mobileMenuButton: document.querySelector("#mobileMenuButton"),
  modelPicker: document.querySelector("#modelPicker"),
  modelButton: document.querySelector("#modelButton"),
  currentModelName: document.querySelector("#currentModelName"),
  modelMenu: document.querySelector("#modelMenu"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector(".send-button"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsForm: document.querySelector("#settingsForm"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  cancelSettingsButton: document.querySelector("#cancelSettingsButton"),
  settingsName: document.querySelector("#settingsName"),
  settingsLogin: document.querySelector("#settingsLogin"),
  settingsEmail: document.querySelector("#settingsEmail"),
  defaultModelSelect: document.querySelector("#defaultModelSelect"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  deleteChatModal: document.querySelector("#deleteChatModal"),
  deleteChatName: document.querySelector("#deleteChatName"),
  cancelDeleteChatButton: document.querySelector("#cancelDeleteChatButton"),
  confirmDeleteChatButton: document.querySelector("#confirmDeleteChatButton"),
  toast: document.querySelector("#toast"),
};

const state = loadSession();
let authMode = "login";
let toastTimer;
let pendingDeleteChatId = null;

init();

async function init() {
  applyTheme(state.theme);
  fillModelSelects();
  bindEvents();

  try {
    await loadModels();
  } catch {
    showToast("Модели загружены из локального списка");
  }

  if (await restoreSession()) {
    await showApp();
  } else {
    showAuth();
  }
}

function bindEvents() {
  elements.authTabs.forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });

  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.newChatButton.addEventListener("click", () => createChat());
  elements.themeButton.addEventListener("click", toggleTheme);
  elements.settingsButton.addEventListener("click", openSettings);
  elements.logoutButton.addEventListener("click", logout);
  elements.mobileMenuButton.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  elements.modelButton.addEventListener("click", () => {
    if (elements.modelButton.disabled) return;
    toggleModelMenu();
  });

  elements.modelMenu.addEventListener("click", async (event) => {
    const option = event.target.closest("[data-model-id]");
    if (!option) return;

    const chat = getCurrentChat();
    if (!chat) return;

    await updateChat(chat.id, {
      model_openrouter_id: option.dataset.modelId,
    });
    closeModelMenu();
  });

  elements.messageForm.addEventListener("submit", handleMessageSubmit);
  elements.messageInput.addEventListener("input", resizeComposer);
  elements.messageInput.addEventListener("keydown", handleMessageKeydown);

  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.cancelSettingsButton.addEventListener("click", closeSettings);
  elements.settingsModal.addEventListener("click", (event) => {
    if (event.target === elements.settingsModal) closeSettings();
  });
  elements.settingsForm.addEventListener("submit", handleSettingsSubmit);
  elements.cancelDeleteChatButton.addEventListener("click", closeDeleteChatDialog);
  elements.confirmDeleteChatButton.addEventListener("click", confirmDeleteChat);
  elements.deleteChatModal.addEventListener("click", (event) => {
    if (event.target === elements.deleteChatModal) closeDeleteChatDialog();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModelMenu();
      closeDeleteChatDialog();
      closeSettings();
      document.body.classList.remove("sidebar-open");
    }
  });

  document.addEventListener("click", (event) => {
    const isSidebarClick = elements.sidebar.contains(event.target);
    const isMenuClick = elements.mobileMenuButton.contains(event.target);
    const isModelPickerClick = elements.modelPicker.contains(event.target);

    if (!isModelPickerClick) closeModelMenu();

    if (document.body.classList.contains("sidebar-open") && !isSidebarClick && !isMenuClick) {
      document.body.classList.remove("sidebar-open");
    }
  });
}

function setAuthMode(mode) {
  authMode = mode;
  elements.authTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authMode === mode);
  });

  elements.registerOnlyFields.forEach((field) => {
    field.classList.toggle("is-hidden", mode !== "register");
  });

  elements.emailInput.required = mode === "register";
  elements.nameInput.required = mode === "register";
  elements.passwordInput.minLength = mode === "register" ? 6 : 0;
  elements.passwordInput.autocomplete =
    mode === "register" ? "new-password" : "current-password";
  elements.authSubmit.textContent = mode === "register" ? "Создать аккаунт" : "Войти";
  elements.authError.textContent = "";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const login = elements.loginInput.value.trim();
  const password = elements.passwordInput.value.trim();

  if (!login || !password) {
    setAuthError("Введите логин и пароль.");
    return;
  }

  if (authMode === "register") {
    if (password.length < 6) {
      setAuthError("Пароль должен быть не короче 6 символов.");
      return;
    }

    await registerUser(login, password);
    return;
  }

  await loginUser(login, password);
}

async function registerUser(login, password) {
  const email = elements.emailInput.value.trim();
  if (!email) {
    setAuthError("Введите почту.");
    return;
  }

  try {
    const data = await api("/auth/register", {
      method: "POST",
      body: {
        username: login,
        email,
        password,
      },
    });

    setCurrentUser(data.user);
    state.defaultModel = models[0].id;
    state.systemPrompt = defaultSystemPrompt;
    await loadChats();
    if (state.chats.length === 0) await createChat(false);
    await showApp();
    showToast("Аккаунт создан");
  } catch (error) {
    setAuthError(error.message);
  }
}

async function loginUser(login, password) {
  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: {
        username: login,
        password,
      },
    });

    setCurrentUser(data.user);
    await loadChats();
    if (state.chats.length === 0) await createChat(false);
    await showApp();
  } catch (error) {
    setAuthError(error.message);
  }
}

async function restoreSession() {
  try {
    const user = await api("/auth/me");
    setCurrentUser(user);
    return true;
  } catch {
    clearSessionState();
    return false;
  }
}

function setAuthError(message) {
  elements.authError.textContent = message;
}

function showAuth() {
  elements.appShell.classList.add("is-hidden");
  elements.authPage.classList.remove("is-hidden");
  setAuthMode("login");
  elements.authForm.reset();
  elements.loginInput.focus();
}

async function showApp() {
  elements.authPage.classList.add("is-hidden");
  elements.appShell.classList.remove("is-hidden");
  await loadChats();
  renderApp();
}

function renderApp() {
  if (!state.currentUser) {
    showAuth();
    return;
  }

  elements.accountShort.textContent = state.currentUser.username;
  renderChatList();
  renderActiveChat();
}

function renderChatList() {
  const chats = state.chats;
  elements.chatList.innerHTML = "";

  if (chats.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-item-preview";
    empty.textContent = "Чатов пока нет";
    elements.chatList.append(empty);
    return;
  }

  chats
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach((chat) => {
      const item = document.createElement("article");
      item.className = "chat-item";
      item.classList.toggle("is-active", chat.id === state.activeChatId);

      const mainButton = document.createElement("button");
      mainButton.className = "chat-item-main";
      mainButton.type = "button";
      mainButton.addEventListener("click", () => {
        state.activeChatId = chat.id;
        document.body.classList.remove("sidebar-open");
        saveSession();
        renderApp();
      });

      const title = document.createElement("span");
      title.className = "chat-item-title";
      title.textContent = chat.title;

      const preview = document.createElement("span");
      preview.className = "chat-item-preview";
      preview.textContent = getChatPreview(chat);

      const meta = document.createElement("span");
      meta.className = "chat-item-meta";
      meta.textContent = `${getModelName(chat.model)} · ${formatChatTime(chat.updatedAt)}`;

      mainButton.append(title, preview, meta);

      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-chat-button";
      deleteButton.type = "button";
      deleteButton.title = "Удалить чат";
      deleteButton.setAttribute("aria-label", `Удалить чат ${chat.title}`);
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", () => deleteChat(chat.id));

      item.append(mainButton, deleteButton);
      elements.chatList.append(item);
    });
}

function renderActiveChat() {
  const chat = getCurrentChat();

  if (!chat) {
    elements.chatBody.innerHTML = `
      <section class="empty-state">
        <h3>Создайте первый чат</h3>
      </section>
    `;
    elements.messageInput.disabled = true;
    elements.sendButton.disabled = true;
    elements.modelButton.disabled = true;
    return;
  }

  elements.messageInput.disabled = false;
  elements.sendButton.disabled = false;
  elements.modelButton.disabled = false;
  updateModelPicker(chat.model);

  const list = document.createElement("div");
  list.className = "message-list";

  chat.messages.forEach((message) => {
    list.append(createMessageElement(message, chat.model));
  });

  elements.chatBody.innerHTML = "";
  elements.chatBody.append(list);
  elements.chatBody.scrollTop = elements.chatBody.scrollHeight;
}

function createMessageElement(message, modelId) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${message.role}`;
  wrapper.classList.toggle("is-pending", Boolean(message.pending));

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (message.role !== "user") {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = getModelName(modelId);
    bubble.append(meta);
  }

  if (message.pending) {
    const loader = document.createElement("div");
    loader.className = "message-loader";
    loader.setAttribute("aria-label", "Ожидание ответа");
    bubble.append(loader);
  } else {
    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = message.content;
    bubble.append(text);
  }

  wrapper.append(bubble);
  return wrapper;
}

function handleMessageKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

  event.preventDefault();
  elements.messageForm.requestSubmit();
}

async function handleMessageSubmit(event) {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text) return;

  let chat = getCurrentChat();
  if (!chat) {
    chat = await createChat(false);
  }
  if (!chat) return;

  elements.messageInput.value = "";
  resizeComposer();
  addPendingMessages(chat, text);
  renderApp();

  try {
    const data = await api(`/chats/${chat.id}/messages`, {
      method: "POST",
      body: {
        content: text,
      },
    });

    upsertChat(normalizeChat(data.chat));
    state.activeChatId = data.chat.id;
    saveSession();
    renderApp();
  } catch (error) {
    removePendingAssistantMessage(chat.id);
    renderApp();
    setAuthError("");
    showToast(error.message);
  }
}

function addPendingMessages(chat, text) {
  const now = new Date().toISOString();

  if (chat.title === "Новый чат") {
    chat.title = text.length > 42 ? `${text.slice(0, 42)}...` : text;
  }

  chat.updatedAt = now;
  chat.messages.push({
    id: createPendingId("user"),
    role: "user",
    content: text,
    createdAt: now,
  });
  chat.messages.push({
    id: createPendingId("assistant"),
    role: "assistant",
    content: "",
    createdAt: now,
    pending: true,
  });
}

function removePendingAssistantMessage(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) return;

  chat.messages = chat.messages.filter(
    (message) => !(message.role === "assistant" && message.pending)
  );
}

function createPendingId(role) {
  return `pending-${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createChat(shouldRender = true) {
  if (!state.currentUser) return null;

  try {
    const chat = normalizeChat(
      await api("/chats", {
        method: "POST",
        body: {
          model_openrouter_id: state.defaultModel,
          system_prompt: state.systemPrompt,
        },
      })
    );

    upsertChat(chat);
    state.activeChatId = chat.id;
    saveSession();

    if (shouldRender) {
      renderApp();
      elements.messageInput.focus();
    }

    return chat;
  } catch (error) {
    showToast(error.message);
    return null;
  }
}

function deleteChat(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) return;

  pendingDeleteChatId = chatId;
  elements.deleteChatName.textContent = chat.title;
  elements.deleteChatModal.classList.remove("is-hidden");
  elements.confirmDeleteChatButton.focus();
}

function closeDeleteChatDialog() {
  pendingDeleteChatId = null;
  elements.deleteChatModal.classList.add("is-hidden");
}

async function confirmDeleteChat() {
  if (!pendingDeleteChatId || !state.currentUser) return;

  const chatId = pendingDeleteChatId;
  try {
    await api(`/chats/${chatId}`, {
      method: "DELETE",
    });

    state.chats = state.chats.filter((chat) => chat.id !== chatId);
    if (state.activeChatId === chatId) {
      state.activeChatId = state.chats[0]?.id || null;
    }

    closeDeleteChatDialog();
    saveSession();
    renderApp();
    showToast("Чат удален");
  } catch (error) {
    closeDeleteChatDialog();
    showToast(error.message);
  }
}

function openSettings() {
  if (!state.currentUser) return;

  elements.settingsName.value = state.currentUser.username;
  elements.settingsLogin.value = state.currentUser.username;
  elements.settingsEmail.value = state.currentUser.email;
  elements.defaultModelSelect.value = normalizeModelId(state.defaultModel);
  elements.systemPromptInput.value = state.systemPrompt || defaultSystemPrompt;
  elements.settingsModal.classList.remove("is-hidden");
  elements.settingsName.focus();
}

function closeSettings() {
  elements.settingsModal.classList.add("is-hidden");
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  if (!state.currentUser) return;

  state.defaultModel = normalizeModelId(elements.defaultModelSelect.value);
  state.systemPrompt = elements.systemPromptInput.value.trim() || defaultSystemPrompt;

  const chat = getCurrentChat();
  if (chat) {
    await updateChat(chat.id, {
      model_openrouter_id: state.defaultModel,
      system_prompt: state.systemPrompt,
    });
  }

  saveSession();
  closeSettings();
  renderApp();
  showToast("Настройки сохранены");
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    // Local logout should still work if the session is already gone.
  }

  clearSessionState();
  showAuth();
}

function clearSessionState() {
  state.currentUser = null;
  state.chats = [];
  state.activeChatId = null;
  saveSession();
}

function fillModelSelects() {
  const options = models
    .map((model) => `<option value="${model.id}">${model.name}</option>`)
    .join("");
  elements.defaultModelSelect.innerHTML = options;

  elements.modelMenu.innerHTML = models
    .map(
      (model) => `
        <button class="model-option" type="button" role="option" data-model-id="${model.id}">
          ${model.name}
        </button>
      `
    )
    .join("");
}

function toggleModelMenu() {
  const isOpen = !elements.modelMenu.classList.contains("is-hidden");
  if (isOpen) {
    closeModelMenu();
  } else {
    elements.modelMenu.classList.remove("is-hidden");
    elements.modelButton.setAttribute("aria-expanded", "true");
  }
}

function closeModelMenu() {
  elements.modelMenu.classList.add("is-hidden");
  elements.modelButton.setAttribute("aria-expanded", "false");
}

function updateModelPicker(modelId) {
  const normalizedModelId = normalizeModelId(modelId);
  elements.currentModelName.textContent = getModelName(normalizedModelId);

  elements.modelMenu.querySelectorAll("[data-model-id]").forEach((option) => {
    const isSelected = option.dataset.modelId === normalizedModelId;
    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-selected", String(isSelected));
  });
}

async function loadModels() {
  const modelData = await api("/models");
  models.splice(
    0,
    models.length,
    ...modelData.map((model) => ({
      id: model.openrouter_id,
      name: model.display_name,
    }))
  );
  state.defaultModel = normalizeModelId(state.defaultModel);
  fillModelSelects();
  saveSession();
}

async function loadChats() {
  if (!state.currentUser) return;

  const chats = await api("/chats");
  state.chats = chats.map(normalizeChat);

  if (!state.activeChatId || !state.chats.some((chat) => chat.id === state.activeChatId)) {
    state.activeChatId = state.chats[0]?.id || null;
  }

  saveSession();
}

async function updateChat(chatId, updates) {
  if (!state.currentUser) return null;

  try {
    const chat = normalizeChat(
      await api(`/chats/${chatId}`, {
        method: "PATCH",
        body: {
          ...updates,
        },
      })
    );
    upsertChat(chat);
    saveSession();
    renderApp();
    return chat;
  } catch (error) {
    showToast(error.message);
    return null;
  }
}

async function api(path, options = {}) {
  const fetchOptions = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };

  if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(`/api/v1${path}`, fetchOptions);
  const data = await readApiJson(response);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(data, "Ошибка запроса."));
  }

  return data;
}

async function readApiJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function getApiErrorMessage(data, fallback) {
  if (typeof data.detail === "string") return data.detail;

  if (Array.isArray(data.detail)) {
    return data.detail
      .map((item) => item.msg)
      .filter(Boolean)
      .join(" ");
  }

  return fallback;
}

function normalizeChat(chat) {
  return {
    id: chat.id,
    userId: chat.user_id,
    title: chat.title,
    model: normalizeModelId(chat.model_openrouter_id),
    systemPrompt: chat.system_prompt || "",
    createdAt: chat.created_at,
    updatedAt: chat.updated_at,
    messages: (chat.messages || []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    })),
  };
}

function upsertChat(chat) {
  const index = state.chats.findIndex((item) => item.id === chat.id);
  if (index === -1) {
    state.chats.push(chat);
  } else {
    state.chats[index] = chat;
  }
}

function resizeComposer() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${elements.messageInput.scrollHeight}px`;
}

function getCurrentChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId);
}

function getChatPreview(chat) {
  const lastMessage = chat.messages[chat.messages.length - 1];
  if (lastMessage?.pending) return "Ожидание ответа...";
  return lastMessage?.content || "Пустой чат";
}

function formatChatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "сейчас";

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getModelName(modelId) {
  return models.find((model) => model.id === modelId)?.name || models[0].name;
}

function normalizeModelId(modelId) {
  return models.some((model) => model.id === modelId) ? modelId : models[0].id;
}

function normalizeTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  const normalizedTheme = normalizeTheme(theme);
  document.documentElement.dataset.theme = normalizedTheme;
  document.body.dataset.theme = normalizedTheme;

  if (elements.themeButtonText) {
    elements.themeButtonText.textContent =
      normalizedTheme === "light" ? "Темная тема" : "Светлая тема";
  }
}

function setTheme(theme) {
  state.theme = normalizeTheme(theme);
  applyTheme(state.theme);
  saveSession();
}

function toggleTheme() {
  setTheme(state.theme === "light" ? "dark" : "light");
}

function setCurrentUser(user) {
  state.currentUser = {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.created_at,
  };
  saveSession();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove("is-hidden");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.add("is-hidden");
  }, 2200);
}

function loadSession() {
  const fallback = {
    currentUser: null,
    chats: [],
    activeChatId: null,
    defaultModel: fallbackModels[0].id,
    systemPrompt: defaultSystemPrompt,
    theme: "dark",
  };

  try {
    const stored = localStorage.getItem(SESSION_KEY);
    const session = stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
    session.theme = normalizeTheme(session.theme);
    return session;
  } catch {
    return fallback;
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(state));
}
