const STORAGE_KEY = "owngpt-front-state";

const models = [
  { id: "qwen/qwen3.6-plus", name: "qwen3.6-plus" },
  { id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
];

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

const state = loadState();
let authMode = "login";
let toastTimer;
let pendingDeleteChatId = null;

init();

function init() {
  fillModelSelects();
  normalizeStoredModels();
  bindEvents();

  if (state.currentUserId && getCurrentUser()) {
    showApp();
  } else {
    showAuth();
  }
}

function bindEvents() {
  elements.authTabs.forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });

  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.newChatButton.addEventListener("click", createChat);
  elements.settingsButton.addEventListener("click", openSettings);
  elements.logoutButton.addEventListener("click", logout);
  elements.mobileMenuButton.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  elements.modelButton.addEventListener("click", () => {
    if (elements.modelButton.disabled) return;
    toggleModelMenu();
  });

  elements.modelMenu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-model-id]");
    if (!option) return;

    const chat = getCurrentChat();
    if (!chat) return;

    chat.model = option.dataset.modelId;
    chat.updatedAt = new Date().toISOString();
    saveState();
    closeModelMenu();
    renderApp();
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

    if (!isModelPickerClick) {
      closeModelMenu();
    }

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
  elements.passwordInput.autocomplete =
    mode === "register" ? "new-password" : "current-password";
  elements.authSubmit.textContent = mode === "register" ? "Создать аккаунт" : "Войти";
  elements.authError.textContent = "";
}

function handleAuthSubmit(event) {
  event.preventDefault();
  const login = elements.loginInput.value.trim();
  const password = elements.passwordInput.value.trim();

  if (!login || !password) {
    setAuthError("Введите логин и пароль.");
    return;
  }

  if (authMode === "register") {
    registerUser(login, password);
    return;
  }

  loginUser(login, password);
}

function registerUser(login, password) {
  const existingUser = state.users.find((user) => user.login === login);
  if (existingUser) {
    setAuthError("Такой логин уже зарегистрирован.");
    return;
  }

  const user = {
    id: createId("user"),
    login,
    password,
    name: elements.nameInput.value.trim() || login,
    email: elements.emailInput.value.trim(),
    createdAt: new Date().toISOString(),
    defaultModel: models[0].id,
    systemPrompt: defaultSystemPrompt,
  };

  state.users.push(user);
  state.currentUserId = user.id;
  state.chats[user.id] = [];
  createChat(false);
  saveState();
  showApp();
  showToast("Аккаунт создан");
}

function loginUser(login, password) {
  const user = state.users.find((item) => item.login === login);
  if (!user || user.password !== password) {
    setAuthError("Неверный логин или пароль. Можно перейти к регистрации.");
    return;
  }

  state.currentUserId = user.id;
  ensureUserChats(user.id);
  if (!state.activeChatId[user.id]) createChat(false);
  saveState();
  showApp();
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

function showApp() {
  elements.authPage.classList.add("is-hidden");
  elements.appShell.classList.remove("is-hidden");
  ensureUserChats(state.currentUserId);
  renderApp();
}

function renderApp() {
  const user = getCurrentUser();
  if (!user) {
    showAuth();
    return;
  }

  elements.accountShort.textContent = user.name || user.login;
  renderChatList();
  renderActiveChat();
}

function renderChatList() {
  const chats = getChats();
  const activeId = getActiveChatId();
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
      item.classList.toggle("is-active", chat.id === activeId);

      const mainButton = document.createElement("button");
      mainButton.className = "chat-item-main";
      mainButton.type = "button";
      mainButton.addEventListener("click", () => {
        state.activeChatId[state.currentUserId] = chat.id;
        document.body.classList.remove("sidebar-open");
        saveState();
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

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (message.role !== "user") {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = getModelName(modelId);
    bubble.append(meta);
  }

  const text = document.createElement("p");
  text.className = "message-text";
  text.textContent = message.content;

  bubble.append(text);
  wrapper.append(bubble);
  return wrapper;
}

function handleMessageKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

  event.preventDefault();
  elements.messageForm.requestSubmit();
}

function handleMessageSubmit(event) {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text) return;

  let chat = getCurrentChat();
  if (!chat) {
    createChat(false);
    chat = getCurrentChat();
  }

  chat.messages.push(createMessage("user", text));

  if (chat.title === "Новый чат") {
    chat.title = text.length > 42 ? `${text.slice(0, 42)}...` : text;
  }

  chat.updatedAt = new Date().toISOString();
  elements.messageInput.value = "";
  resizeComposer();
  renderApp();

  window.setTimeout(() => {
    chat.messages.push(createMessage("assistant", generateAssistantReply(text)));
    chat.updatedAt = new Date().toISOString();
    saveState();
    renderApp();
  }, 320);

  saveState();
}

function generateAssistantReply() {
  return "Здесь будет ответ модели.";
}

function createChat(shouldRender = true) {
  const user = getCurrentUser();
  if (!user) return;

  ensureUserChats(user.id);

  const chat = {
    id: createId("chat"),
    title: "Новый чат",
    model: normalizeModelId(user.defaultModel),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      createMessage(
        "assistant",
        `Привет, ${user.name || user.login}! Я готов к диалогу.`
      ),
    ],
  };

  state.chats[user.id].push(chat);
  state.activeChatId[user.id] = chat.id;
  saveState();

  if (shouldRender) {
    renderApp();
    elements.messageInput.focus();
  }
}

function deleteChat(chatId) {
  const chat = getChats().find((item) => item.id === chatId);
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

function confirmDeleteChat() {
  if (!pendingDeleteChatId) return;

  const userId = state.currentUserId;
  const chatId = pendingDeleteChatId;
  state.chats[userId] = getChats().filter((chat) => chat.id !== chatId);

  if (state.activeChatId[userId] === chatId) {
    state.activeChatId[userId] = state.chats[userId][0]?.id || null;
  }

  closeDeleteChatDialog();
  saveState();
  renderApp();
  showToast("Чат удален");
}

function openSettings() {
  const user = getCurrentUser();
  if (!user) return;

  elements.settingsName.value = user.name || "";
  elements.settingsLogin.value = user.login;
  elements.settingsEmail.value = user.email || "";
  elements.defaultModelSelect.value = normalizeModelId(user.defaultModel);
  elements.systemPromptInput.value = user.systemPrompt || defaultSystemPrompt;
  elements.settingsModal.classList.remove("is-hidden");
  elements.settingsName.focus();
}

function closeSettings() {
  elements.settingsModal.classList.add("is-hidden");
}

function handleSettingsSubmit(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  user.name = elements.settingsName.value.trim() || user.login;
  user.email = elements.settingsEmail.value.trim();
  user.defaultModel = elements.defaultModelSelect.value;
  user.systemPrompt = elements.systemPromptInput.value.trim() || defaultSystemPrompt;
  saveState();
  closeSettings();
  renderApp();
  showToast("Настройки сохранены");
}

function logout() {
  state.currentUserId = null;
  saveState();
  showAuth();
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

function resizeComposer() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${elements.messageInput.scrollHeight}px`;
}

function getCurrentUser() {
  return state.users.find((user) => user.id === state.currentUserId);
}

function getChats() {
  if (!state.currentUserId) return [];
  ensureUserChats(state.currentUserId);
  return state.chats[state.currentUserId];
}

function getCurrentChat() {
  const activeId = getActiveChatId();
  return getChats().find((chat) => chat.id === activeId);
}

function getActiveChatId() {
  return state.activeChatId[state.currentUserId];
}

function ensureUserChats(userId) {
  if (!state.chats[userId]) state.chats[userId] = [];
  if (!state.activeChatId[userId] && state.chats[userId][0]) {
    state.activeChatId[userId] = state.chats[userId][0].id;
  }
}

function getChatPreview(chat) {
  const lastMessage = chat.messages[chat.messages.length - 1];
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

function normalizeStoredModels() {
  state.users.forEach((user) => {
    user.defaultModel = normalizeModelId(user.defaultModel);
  });

  Object.values(state.chats).forEach((chats) => {
    chats.forEach((chat) => {
      chat.model = normalizeModelId(chat.model);
    });
  });

  saveState();
}

function createMessage(role, content) {
  return {
    id: createId("msg"),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove("is-hidden");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.add("is-hidden");
  }, 2200);
}

function loadState() {
  const fallback = {
    users: [],
    chats: {},
    activeChatId: {},
    currentUserId: null,
  };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
