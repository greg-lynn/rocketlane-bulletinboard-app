"use strict";

(function bootstrapBulletinBoard() {
  const STORAGE_PREFIX = "rocketlane-bulletin-board";
  const NOTE_COLORS = [
    { id: "yellow", label: "Sunny", hex: "#fff8a6" },
    { id: "blue", label: "Ocean", hex: "#cce8ff" },
    { id: "green", label: "Mint", hex: "#d8f5d2" },
    { id: "pink", label: "Rose", hex: "#ffd7ea" },
    { id: "purple", label: "Lavender", hex: "#ecd8ff" },
  ];
  const LOCAL_ERROR_LOG_KEY = "bb_local_error_logs_v1";
  const MAX_LOCAL_ERRORS = 80;

  const state = {
    client: null,
    context: null,
    storageKey: "",
    widgetId: "",
    layoutMode: "full", // "full" | "sidebar"
    persistence: "local", // "local" | "server"
    unreadCount: 0,
    errorCount: 0,
    notes: [],
    selectedNoteId: null,
    searchQuery: "",
    filter: "all",
    saveTimer: null,
  };

  const refs = {};

  document.addEventListener("DOMContentLoaded", () => {
    initializeApp().catch((error) => {
      console.error("Unable to initialize app", error);
      if (refs.connectionBadge) {
        refs.connectionBadge.textContent = "Initialization failed";
      }
      reportClientError({
        code: "APP_INIT_FAILED",
        source: "bulletin-board-ui",
        title: "Bulletin board initialization failed",
        message:
          (error && error.message) ||
          "The app failed during startup initialization.",
        stack: error && error.stack ? String(error.stack) : "",
        details:
          "Initialization did not complete. This can happen if SDK context fails or required resources are unavailable.",
      }).catch(() => {});
    });
  });

  async function initializeApp() {
    cacheDomReferences();
    bindEvents();
    buildColorPicker();

    const query = new URLSearchParams(window.location.search);
    state.widgetId = detectWidgetId(query);
    state.layoutMode = determineLayoutMode(state.widgetId, query);
    applyLayoutMode(state.layoutMode);

    const runtime = await initializeRuntime();
    state.client = runtime.client;
    state.context = runtime.context;
    state.storageKey = createStorageKey(runtime.context);

    updateHeader(runtime);
    installGlobalErrorHandlers();
    state.persistence = determinePersistenceMode(state.client);
    await loadNotes();

    if (state.notes.length === 0 && shouldSeedDemo(query)) {
      await seedDemoNotes();
    }

    if (state.notes.length === 0) {
      await createDefaultWelcomeNote();
    }

    if (!state.selectedNoteId && state.notes.length > 0) {
      state.selectedNoteId = state.notes[0].id;
    }

    renderAll();
    scheduleReadTracking();
  }

  function detectWidgetId(query) {
    return (
      query.get("widgetId") ||
      query.get("widgetIdentifier") ||
      query.get("widget") ||
      ""
    );
  }

  function determineLayoutMode(widgetId, query) {
    const explicit = String(query.get("layout") || "").toLowerCase();
    if (explicit === "sidebar" || explicit === "rail") {
      return "sidebar";
    }

    // Use the widget identifier to switch to a compact layout for the
    // Home right-sidebar placement (typically configured under Personal Tasks).
    if (widgetId === "customer-bulletin-board-home-right") {
      return "sidebar";
    }

    // Auto-detect a right-rail embed: narrow iframe/container.
    // This doesn't guarantee placement, but ensures the UI fits there.
    if (window.innerWidth > 0 && window.innerWidth <= 640) {
      return "sidebar";
    }

    return "full";
  }

  function applyLayoutMode(mode) {
    document.body.classList.toggle("layout-sidebar", mode === "sidebar");
    document.body.classList.toggle("layout-full", mode !== "sidebar");
  }

  function cacheDomReferences() {
    refs.boardScope = document.getElementById("boardScope");
    refs.connectionBadge = document.getElementById("connectionBadge");
    refs.unreadBadge = document.getElementById("unreadBadge");
    refs.addNoteButton = document.getElementById("addNoteButton");
    refs.seedDemoButton = document.getElementById("seedDemoButton");
    refs.clearBoardButton = document.getElementById("clearBoardButton");
    refs.searchInput = document.getElementById("searchInput");
    refs.filterSelect = document.getElementById("filterSelect");
    refs.boardStats = document.getElementById("boardStats");
    refs.notesGrid = document.getElementById("notesGrid");
    refs.notesEmptyState = document.getElementById("notesEmptyState");
    refs.editorEmptyState = document.getElementById("editorEmptyState");
    refs.editorPanel = document.getElementById("editorPanel");
    refs.noteTitleInput = document.getElementById("noteTitleInput");
    refs.noteBodyInput = document.getElementById("noteBodyInput");
    refs.colorPicker = document.getElementById("colorPicker");
    refs.saveState = document.getElementById("saveState");
    refs.pinNoteButton = document.getElementById("pinNoteButton");
    refs.deleteNoteButton = document.getElementById("deleteNoteButton");
  }

  function bindEvents() {
    refs.addNoteButton.addEventListener("click", onAddNote);
    refs.seedDemoButton.addEventListener("click", async () => {
      await seedDemoNotes();
      renderAll();
    });
    refs.clearBoardButton.addEventListener("click", onClearBoard);
    refs.searchInput.addEventListener("input", (event) => {
      state.searchQuery = event.target.value.trim();
      renderNotesGrid();
      renderStats();
    });
    refs.filterSelect.addEventListener("change", (event) => {
      state.filter = event.target.value;
      renderNotesGrid();
      renderStats();
    });

    refs.noteTitleInput.addEventListener("input", onTitleInput);
    refs.noteBodyInput.addEventListener("input", onBodyInput);
    refs.noteBodyInput.addEventListener("paste", onEditorPaste);

    refs.pinNoteButton.addEventListener("click", onTogglePinFromEditor);
    refs.deleteNoteButton.addEventListener("click", onDeleteFromEditor);

    refs.colorPicker.addEventListener("click", onColorSwatchClick);

    document.querySelectorAll(".format-button").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const command = button.getAttribute("data-command");
        if (command) {
          executeFormattingCommand(command);
        }
      });
    });
  }

  async function initializeRuntime() {
    const query = new URLSearchParams(window.location.search);
    const fallback = getContextFromQuery(query);

    try {
      const client = await initRocketlaneClient();
      if (!client) {
        return {
          client: null,
          connected: false,
          context: fallback,
        };
      }

      // Prefer the context() API when available (used by RocketlaneApp SDK).
      const contextObj = await safeGetContext(client);
      if (contextObj) {
        return {
          client,
          connected: true,
          context: mergeContextFromContextObj(fallback, contextObj),
        };
      }

      // Fallback to data method when context() is unavailable.
      const [account, user, project] = await Promise.all([
        safeGetClientData(client, "account"),
        safeGetClientData(client, "user"),
        safeGetClientData(client, "project"),
      ]);

      return {
        client,
        connected: true,
        context: mergeContextData(fallback, account, user, project),
      };
    } catch (error) {
      console.warn("Rocketlane SDK unavailable, using local preview mode.", error);
      return {
        client: null,
        connected: false,
        context: fallback,
      };
    }
  }

  async function initRocketlaneClient() {
    // Newer Marketplace SDK.
    if (window.rliSdk && typeof window.rliSdk.init === "function") {
      try {
        return await window.rliSdk.init({});
      } catch (_error) {
        // fall through
      }
    }

    // Older/basic template SDK.
    if (window.rocketlaneApp && typeof window.rocketlaneApp.init === "function") {
      try {
        return await window.rocketlaneApp.init();
      } catch (_error2) {
        // fall through
      }
    }

    return null;
  }

  async function safeGetContext(client) {
    if (!client || typeof client.context !== "function") {
      return null;
    }
    try {
      return await client.context();
    } catch (_error) {
      return null;
    }
  }

  function mergeContextFromContextObj(fallback, ctx) {
    return {
      accountId:
        pickFirst(
          (ctx.company && (ctx.company.id || ctx.company.companyId)) ||
            (ctx.account && (ctx.account.id || ctx.account.accountId)) ||
            ctx.accountId
        ) || fallback.accountId,
      accountName:
        pickFirst(
          (ctx.company &&
            (ctx.company.companyName || ctx.company.name || ctx.company.displayName)) ||
            (ctx.account &&
              (ctx.account.name || ctx.account.accountName || ctx.account.displayName)) ||
            ctx.accountName
        ) || fallback.accountName,
      userId:
        pickFirst(ctx.user && (ctx.user.id || ctx.user.userId || ctx.user.email)) ||
        fallback.userId,
      userName:
        pickFirst(ctx.user && (ctx.user.fullName || ctx.user.name || ctx.user.email)) ||
        fallback.userName,
      projectId:
        pickFirst(
          ctx.project && (ctx.project.id || ctx.project.projectId || ctx.project._id)
        ) || fallback.projectId,
      projectName:
        pickFirst(ctx.project && (ctx.project.projectName || ctx.project.name)) ||
        fallback.projectName,
    };
  }

  async function safeGetClientData(client, objectName) {
    if (!client || !client.data || typeof client.data.get !== "function") {
      return null;
    }

    try {
      return await client.data.get(objectName);
    } catch (_error) {
      const aliases = {
        account: "GET_ACCOUNT_DATA",
        user: "GET_USER_DATA",
        project: "GET_PROJECT_DATA",
      };
      const key = aliases[objectName];
      const identifier =
        client.data.dataIdentifiers &&
        key &&
        client.data.dataIdentifiers[key];

      if (!identifier) {
        return null;
      }

      try {
        return await client.data.get(identifier);
      } catch (_error2) {
        return null;
      }
    }
  }

  function mergeContextData(fallback, account, user, project) {
    return {
      accountId:
        pickFirst(account && (account.id || account.accountId || account._id)) ||
        fallback.accountId,
      accountName:
        pickFirst(
          account &&
            (account.name ||
              account.accountName ||
              account.displayName ||
              account.companyName)
        ) || fallback.accountName,
      userId:
        pickFirst(user && (user.id || user.userId || user._id)) || fallback.userId,
      userName:
        pickFirst(
          user && (user.name || user.fullName || user.displayName || user.email)
        ) || fallback.userName,
      projectId:
        pickFirst(project && (project.id || project.projectId || project._id)) ||
        fallback.projectId,
      projectName:
        pickFirst(project && (project.name || project.projectName)) ||
        fallback.projectName,
    };
  }

  function getContextFromQuery(query) {
    return {
      accountId: query.get("accountId") || "",
      accountName: query.get("account") || "Rocketlane Workspace",
      userId: query.get("userId") || "",
      userName: query.get("user") || "Rocketlane User",
      projectId: query.get("projectId") || "",
      projectName: query.get("project") || "",
    };
  }

  function updateHeader(runtime) {
    const context = runtime.context;
    const view =
      context.projectName ||
      (state.layoutMode === "sidebar" ? "Home (right sidebar)" : "Customer home");

    if (state.layoutMode === "sidebar") {
      refs.boardScope.textContent =
        "Configured for Home right sidebar (place under Personal Tasks)";
    } else {
      refs.boardScope.textContent =
        "Scope: " + context.accountName + " / " + view + " bulletin board";
    }

    if (runtime.connected) {
      refs.connectionBadge.className = "badge badge-ok";
      refs.connectionBadge.textContent = "Connected to Rocketlane";
    } else {
      refs.connectionBadge.className = "badge badge-local";
      refs.connectionBadge.textContent = "Local preview mode";
    }
  }

  function createStorageKey(context) {
    const accountScope = slug(context.accountId || context.accountName || "workspace");
    const viewScope = slug(
      context.projectId || context.projectName || "customer-home-view"
    );
    return STORAGE_PREFIX + ":" + accountScope + ":" + viewScope;
  }

  function determinePersistenceMode(client) {
    return canInvokeServerActions(client) ? "server" : "local";
  }

  function canInvokeServerActions(client) {
    return (
      client &&
      client.data &&
      typeof client.data.invoke === "function"
    );
  }

  function buildClientFixGuidance(code, message) {
    const normalizedCode = String(code || "").toUpperCase();
    const normalizedMessage = String(message || "").toLowerCase();

    if (
      normalizedCode.includes("SDK") ||
      normalizedCode.includes("INIT") ||
      normalizedMessage.includes("sdk")
    ) {
      return {
        summary:
          "Reload Rocketlane and open the app from inside Rocketlane (not as a standalone local file).",
        steps: [
          "Refresh the Rocketlane page.",
          "If this keeps happening, re-upload the latest app ZIP.",
          "Check the Error Logs app for technical context.",
        ],
      };
    }

    if (
      normalizedCode.includes("NETWORK") ||
      normalizedMessage.includes("network") ||
      normalizedMessage.includes("timeout")
    ) {
      return {
        summary:
          "Check connectivity and retry. This is usually a temporary network issue.",
        steps: [
          "Confirm internet access.",
          "Retry the same action.",
          "If repeated, verify firewall/proxy allows Rocketlane app requests.",
        ],
      };
    }

    if (
      normalizedCode.includes("KV") ||
      normalizedCode.includes("SERVER_ACTION") ||
      normalizedCode.includes("ACTION")
    ) {
      return {
        summary:
          "A backend app action failed. Re-upload the latest app package and try again.",
        steps: [
          "Run `npm run package:rli` and upload the new ZIP.",
          "Refresh Rocketlane and retry.",
          "Use Bulletin Board Error Logs to inspect detailed failure metadata.",
        ],
      };
    }

    return {
      summary:
        "Refresh Rocketlane and retry. If it repeats, review this error in the Error Logs app.",
      steps: [
        "Refresh the page.",
        "Retry the action.",
        "Open Bulletin Board Error Logs for detailed fix guidance.",
      ],
    };
  }

  function setUserFacingError(message, fixSummary) {
    if (!refs.saveState) {
      return;
    }
    const friendly = String(message || "An error occurred.");
    const fix = String(fixSummary || "").trim();
    refs.saveState.textContent = fix
      ? `Error: ${friendly} Fix: ${fix}`
      : `Error: ${friendly}`;
  }

  function writeLocalErrorFallback(record) {
    try {
      const raw = window.localStorage.getItem(LOCAL_ERROR_LOG_KEY);
      const existing = raw ? JSON.parse(raw) : [];
      const next = [record, ...(Array.isArray(existing) ? existing : [])].slice(
        0,
        MAX_LOCAL_ERRORS
      );
      window.localStorage.setItem(LOCAL_ERROR_LOG_KEY, JSON.stringify(next));
      state.errorCount = next.length;
    } catch (_error) {
      // ignore local fallback write issues
    }
  }

  async function reportClientError(input) {
    const payload = input && typeof input === "object" ? input : {};
    const guidance = payload.fix || buildClientFixGuidance(payload.code, payload.message);
    const record = {
      source: payload.source || "bulletin-board-ui",
      code: payload.code || "CLIENT_RUNTIME_ERROR",
      severity: payload.severity || "error",
      title: payload.title || "Bulletin Board client error",
      message:
        payload.message ||
        "An unexpected issue occurred in the bulletin board interface.",
      details: payload.details || "",
      stack: payload.stack || "",
      fix: guidance,
      widgetId: state.widgetId || "",
      url: window.location.href,
      meta: payload.meta || {},
    };

    setUserFacingError(record.message, guidance.summary);

    if (
      canInvokeServerActions(state.client) &&
      state.client &&
      state.client.data &&
      typeof state.client.data.invoke === "function"
    ) {
      try {
        await state.client.data.invoke("bb_logError", { log: record });
        return;
      } catch (_error2) {
        // continue to local fallback
      }
    }

    writeLocalErrorFallback({
      ...record,
      createdAt: new Date().toISOString(),
      context: state.context || {},
    });
  }

  function installGlobalErrorHandlers() {
    if (state._errorHandlersInstalled) {
      return;
    }
    state._errorHandlersInstalled = true;

    window.addEventListener("error", (event) => {
      reportClientError({
        code: "WINDOW_ERROR",
        source: "bulletin-board-ui",
        title: "Unhandled runtime error",
        message: event && event.message ? event.message : "Unhandled runtime error",
        stack: event && event.error && event.error.stack ? event.error.stack : "",
        details:
          "A browser runtime exception was thrown while rendering or interacting with the app.",
      }).catch(() => {});
    });

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event ? event.reason : null;
      const message =
        (reason && reason.message) ||
        (typeof reason === "string" ? reason : "Unhandled promise rejection");
      const stack = reason && reason.stack ? String(reason.stack) : "";
      reportClientError({
        code: "UNHANDLED_PROMISE_REJECTION",
        source: "bulletin-board-ui",
        title: "Unhandled async error",
        message,
        stack,
        details:
          "An asynchronous operation rejected without being handled in the app code path.",
      }).catch(() => {});
    });
  }

  async function invokeAction(name, payload) {
    if (!canInvokeServerActions(state.client)) {
      return null;
    }

    try {
      const resp = await state.client.data.invoke(name, payload || {});
      // Rocketlane SDK responses wrap payload in { response }.
      return resp && Object.prototype.hasOwnProperty.call(resp, "response")
        ? resp.response
        : resp;
    } catch (error) {
      console.warn("Server action failed:", name, error);
      if (name !== "bb_logError") {
        await reportClientError({
          code: "SERVER_ACTION_INVOKE_FAILED",
          source: "bulletin-board-ui",
          title: `Server action failed: ${name}`,
          message:
            (error && error.message) ||
            "A server action failed to execute in Rocketlane.",
          stack: error && error.stack ? String(error.stack) : "",
          details:
            `Action "${name}" failed while handling a bulletin board request.`,
          meta: { actionName: name, payload: payload || {} },
        });
      }
      return null;
    }
  }

  function applyNotesResponse(data) {
    if (!data) {
      return;
    }

    if (Array.isArray(data.notes)) {
      state.notes = data.notes.map((note) => normalizeNote(note));
    }

    const unread =
      typeof data.unreadCount === "number"
        ? data.unreadCount
        : typeof data.unread === "number"
          ? data.unread
          : 0;
    state.unreadCount = Math.max(0, Number(unread) || 0);
  }

  async function loadNotes() {
    if (state.persistence === "server") {
      const data = await invokeAction("bb_listNotes", {});
      if (data) {
        applyNotesResponse(data);
        return;
      }

      // If the server action fails for any reason, fall back to local mode.
      state.persistence = "local";
    }

    const raw = window.localStorage.getItem(state.storageKey);
    if (!raw) {
      state.notes = [];
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        state.notes = [];
        return;
      }

      state.notes = parsed.map((note) => normalizeNote(note));
    } catch (error) {
      console.warn("Unable to parse saved notes", error);
      state.notes = [];
      await reportClientError({
        code: "LOCAL_PARSE_FAILED",
        source: "bulletin-board-ui",
        title: "Local cache parse failed",
        message:
          "Saved bulletin board data could not be parsed from local cache.",
        stack: error && error.stack ? String(error.stack) : "",
        details:
          "The local browser cache for bulletin board notes appears corrupted.",
      });
    }
  }

  async function persistNotes() {
    if (state.persistence === "server") {
      const note = getSelectedNote();
      if (!note) {
        return;
      }

      const data = await invokeAction("bb_upsertNote", { note });
      if (data) {
        applyNotesResponse(data);
        renderUnreadBadge();
        renderNotesGrid();
        renderStats();
        setSaveState("Saved " + formatTime(new Date().toISOString()));
        return;
      }
      setUserFacingError(
        "Unable to save the note right now.",
        "Retry in a few seconds. If it persists, check Bulletin Board Error Logs."
      );
      return;
    }

    window.localStorage.setItem(state.storageKey, JSON.stringify(state.notes));
    setSaveState("Saved " + formatTime(new Date().toISOString()));
  }

  function scheduleReadTracking() {
    if (state.persistence !== "server") {
      return;
    }
    if (state._readTrackingInstalled) {
      return;
    }
    state._readTrackingInstalled = true;

    // Mark as read shortly after opening the board.
    window.setTimeout(() => {
      markReadNow().catch(() => {});
    }, 2500);

    window.addEventListener("focus", () => {
      markReadNow().catch(() => {});
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        markReadNow().catch(() => {});
      }
    });
  }

  async function markReadNow() {
    if (state.persistence !== "server") {
      return;
    }

    const data = await invokeAction("bb_markRead", {
      lastSeenAt: new Date().toISOString(),
    });
    if (data) {
      applyNotesResponse(data);
      renderUnreadBadge();
      renderStats();
    }
  }

  function queueSave() {
    setSaveState("Saving...");
    if (state.saveTimer) {
      window.clearTimeout(state.saveTimer);
    }

    state.saveTimer = window.setTimeout(() => {
      persistNotes().catch((error) => {
        console.warn("Save failed", error);
        setSaveState("Save failed (will retry)");
      });
    }, 240);
  }

  function setSaveState(text) {
    refs.saveState.textContent = text;
  }

  async function createDefaultWelcomeNote() {
    const note = normalizeNote({
      title: "Welcome to your customer bulletin board",
      pinned: true,
      color: "yellow",
      content:
        "<p>This sticky board is ready for your Rocketlane home page updates.</p>" +
        "<ul><li>Share announcements</li><li>Track open action items</li></ul>" +
        "<p>Use the toolbar for bullet and numbered lists like Gmail.</p>",
    });

    state.notes = [note];
    state.selectedNoteId = note.id;
    await persistNotes();
  }

  async function seedDemoNotes() {
    if (state.persistence === "server") {
      // Avoid writing demo data into a shared board.
      setSaveState("Demo notes are disabled in connected mode");
      return;
    }

    const now = Date.now();
    const demo = [
      {
        title: "Go-live countdown",
        pinned: true,
        color: "yellow",
        updatedAt: new Date(now - 1000 * 60 * 4).toISOString(),
        content:
          "<p>Final checks for launch:</p>" +
          "<ol><li>Confirm SSO handoff</li><li>Validate training links</li><li>Publish kickoff update</li></ol>",
      },
      {
        title: "Customer asks this week",
        color: "blue",
        updatedAt: new Date(now - 1000 * 60 * 30).toISOString(),
        content:
          "<p>Top requests from customer standup:</p>" +
          "<ul><li>Add billing FAQ in portal</li><li>Share onboarding checklist</li><li>Post ETA for migration</li></ul>",
      },
      {
        title: "Ops reminders",
        color: "green",
        updatedAt: new Date(now - 1000 * 60 * 70).toISOString(),
        content:
          "<p>Keep these visible:</p>" +
          "<ul><li>Daily sync at 10:00 AM</li><li>Escalation channel monitored</li><li>Weekly recap every Friday</li></ul>",
      },
      {
        title: "Template for announcements",
        color: "pink",
        updatedAt: new Date(now - 1000 * 60 * 95).toISOString(),
        content:
          "<p><strong>Update:</strong> <em>What changed?</em></p>" +
          "<p><strong>Impact:</strong> Who is affected?</p>" +
          "<p><strong>Next step:</strong></p>" +
          "<ol><li>Owner</li><li>Timeline</li><li>Follow-up link</li></ol>",
      },
    ];

    state.notes = demo.map((item) => normalizeNote(item));
    state.selectedNoteId = state.notes[0] ? state.notes[0].id : null;
    await persistNotes();
  }

  async function onAddNote() {
    const next = normalizeNote({
      title: "Untitled note",
      color: NOTE_COLORS[0].id,
      content: "",
    });
    state.notes.unshift(next);
    state.selectedNoteId = next.id;
    await persistNotes();
    renderAll();
    refs.noteTitleInput.focus();
    refs.noteTitleInput.select();
  }

  async function onClearBoard() {
    if (!state.notes.length) {
      return;
    }

    const confirmed = window.confirm(
      "Clear all sticky notes for this board scope? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    if (state.persistence === "server") {
      setSaveState("Clearing...");
      const data = await invokeAction("bb_clearNotes", {});
      if (data) {
        applyNotesResponse(data);
        state.selectedNoteId = null;
        renderAll();
        return;
      }
      setSaveState("Clear failed");
      return;
    }

    state.notes = [];
    state.selectedNoteId = null;
    await persistNotes();
    renderAll();
  }

  function onTitleInput(event) {
    const note = getSelectedNote();
    if (!note) {
      return;
    }

    note.title = event.target.value.slice(0, 120);
    note.updatedAt = new Date().toISOString();
    queueSave();
    renderNotesGrid();
    renderStats();
  }

  function onBodyInput() {
    const note = getSelectedNote();
    if (!note) {
      return;
    }

    note.content = normalizeEditorHtml(refs.noteBodyInput.innerHTML);
    note.updatedAt = new Date().toISOString();
    queueSave();
    renderNotesGrid();
    renderStats();
  }

  function onEditorPaste(event) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData("text");
    document.execCommand("insertText", false, text);
  }

  async function onTogglePinFromEditor() {
    const note = getSelectedNote();
    if (!note) {
      return;
    }

    note.pinned = !note.pinned;
    note.updatedAt = new Date().toISOString();
    await persistNotes();
    renderAll();
  }

  async function onDeleteFromEditor() {
    const note = getSelectedNote();
    if (!note) {
      return;
    }

    const confirmed = window.confirm(
      'Delete note "' + (note.title || "Untitled note") + '"?'
    );
    if (!confirmed) {
      return;
    }

    if (state.persistence === "server") {
      setSaveState("Deleting...");
      const data = await invokeAction("bb_deleteNote", { noteId: note.id });
      if (data) {
        applyNotesResponse(data);
        const visible = getVisibleNotes();
        state.selectedNoteId = visible[0] ? visible[0].id : null;
        renderAll();
        return;
      }
      setSaveState("Delete failed");
      return;
    }

    state.notes = state.notes.filter((item) => item.id !== note.id);
    const visible = getVisibleNotes();
    state.selectedNoteId = visible[0] ? visible[0].id : null;
    await persistNotes();
    renderAll();
  }

  async function onColorSwatchClick(event) {
    const button = event.target.closest(".color-swatch");
    if (!button) {
      return;
    }

    const nextColor = button.getAttribute("data-color");
    const note = getSelectedNote();
    if (!note || !nextColor) {
      return;
    }

    note.color = nextColor;
    note.updatedAt = new Date().toISOString();
    await persistNotes();
    renderAll();
  }

  function executeFormattingCommand(command) {
    refs.noteBodyInput.focus();
    let worked = false;
    try {
      worked = document.execCommand(command, false, null);
    } catch (_error) {
      worked = false;
    }

    // Fallback: some embedded environments disable list execCommand behavior.
    if (
      worked === false &&
      (command === "insertUnorderedList" || command === "insertOrderedList")
    ) {
      const listType = command === "insertUnorderedList" ? "ul" : "ol";
      worked = insertListFallback(listType);
    }

    if (worked === false) {
      setSaveState(
        "Formatting command not supported in this context. Try reloading the app."
      );
      reportClientError({
        code: "LIST_FORMAT_COMMAND_FAILED",
        source: "bulletin-board-ui",
        title: "List formatting command failed",
        message:
          "The editor could not apply list formatting in the current embed context.",
        details:
          `Command "${command}" returned false and fallback handling did not succeed.`,
      }).catch(() => {});
      return;
    }
    refs.noteBodyInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function insertListFallback(listType) {
    try {
      const editor = refs.noteBodyInput;
      const selection = window.getSelection();
      const list = document.createElement(listType);
      const li = document.createElement("li");
      li.textContent = "List item";
      list.appendChild(li);

      if (!selection || selection.rangeCount === 0) {
        editor.appendChild(list);
      } else {
        const range = selection.getRangeAt(0);
        // Ensure insertion happens inside the editor area.
        if (!editor.contains(range.commonAncestorContainer)) {
          editor.appendChild(list);
        } else {
          range.deleteContents();
          range.insertNode(list);
        }
      }

      const nextRange = document.createRange();
      nextRange.selectNodeContents(li);
      nextRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function renderAll() {
    renderUnreadBadge();
    renderNotesGrid();
    renderEditor();
    renderStats();

    if (refs.seedDemoButton) {
      refs.seedDemoButton.classList.toggle("hidden", state.persistence === "server");
    }
  }

  function renderUnreadBadge() {
    if (!refs.unreadBadge) {
      return;
    }

    const count = Math.max(0, Number(state.unreadCount) || 0);
    if (count <= 0) {
      refs.unreadBadge.textContent = "";
      refs.unreadBadge.classList.add("hidden");
      return;
    }

    refs.unreadBadge.textContent = count > 99 ? "99+" : String(count);
    refs.unreadBadge.classList.remove("hidden");
  }

  function renderStats() {
    const total = state.notes.length;
    const pinned = state.notes.filter((note) => note.pinned).length;
    const visible = getVisibleNotes().length;

    refs.boardStats.textContent =
      visible +
      " visible / " +
      total +
      " total notes (" +
      pinned +
      " pinned)";
  }

  function renderNotesGrid() {
    const notes = getVisibleNotes();
    refs.notesGrid.innerHTML = "";

    if (!notes.length) {
      refs.notesEmptyState.classList.remove("hidden");
      return;
    }

    refs.notesEmptyState.classList.add("hidden");

    notes.forEach((note, index) => {
      const card = document.createElement("article");
      card.className = "note-card note-color-" + note.color;
      if (note.id === state.selectedNoteId) {
        card.classList.add("selected");
      }
      card.style.setProperty("--tilt", tiltFor(note.id, index) + "deg");
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "Open note " + (note.title || "Untitled"));

      card.addEventListener("click", () => {
        state.selectedNoteId = note.id;
        renderAll();
        markReadNow().catch(() => {});
      });

      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          state.selectedNoteId = note.id;
          renderAll();
          markReadNow().catch(() => {});
        }
      });

      const header = document.createElement("div");
      header.className = "note-header";

      const title = document.createElement("p");
      title.className = "note-title";
      title.textContent = note.title || "Untitled note";
      header.appendChild(title);

      if (note.pinned) {
        const pin = document.createElement("span");
        pin.className = "pin-chip";
        pin.textContent = "Pinned";
        header.appendChild(pin);
      }

      const preview = document.createElement("p");
      preview.className = "note-preview";
      preview.textContent = summarize(note.content, 170);

      const meta = document.createElement("p");
      meta.className = "note-meta";
      meta.textContent = "Updated " + formatTime(note.updatedAt);

      card.appendChild(header);
      card.appendChild(preview);
      card.appendChild(meta);
      refs.notesGrid.appendChild(card);
    });
  }

  function renderEditor() {
    const note = getSelectedNote();

    if (!note) {
      refs.editorPanel.classList.add("hidden");
      refs.editorEmptyState.classList.remove("hidden");
      return;
    }

    refs.editorEmptyState.classList.add("hidden");
    refs.editorPanel.classList.remove("hidden");

    if (refs.noteTitleInput.value !== note.title) {
      refs.noteTitleInput.value = note.title;
    }

    if (document.activeElement !== refs.noteBodyInput) {
      refs.noteBodyInput.innerHTML = note.content || "";
    }

    refs.pinNoteButton.textContent = note.pinned ? "Unpin" : "Pin";
    renderColorPickerSelection(note.color);
    setSaveState("Saved");
  }

  function buildColorPicker() {
    refs.colorPicker.innerHTML = "";
    NOTE_COLORS.forEach((color) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "color-swatch";
      swatch.style.background = color.hex;
      swatch.setAttribute("data-color", color.id);
      swatch.setAttribute("title", color.label);
      swatch.setAttribute("aria-label", "Set color " + color.label);
      refs.colorPicker.appendChild(swatch);
    });
  }

  function renderColorPickerSelection(colorId) {
    refs.colorPicker.querySelectorAll(".color-swatch").forEach((swatch) => {
      const isSelected = swatch.getAttribute("data-color") === colorId;
      swatch.classList.toggle("selected", isSelected);
    });
  }

  function getVisibleNotes() {
    const search = state.searchQuery.toLowerCase();
    let notes = state.notes.slice();

    if (state.filter === "pinned") {
      notes = notes.filter((note) => note.pinned);
    }

    const sorted = notes.sort((a, b) => {
      if (state.filter !== "recent" && a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return timestampValue(b.updatedAt) - timestampValue(a.updatedAt);
    });

    if (!search) {
      return sorted;
    }

    return sorted.filter((note) => {
      const haystack = (note.title + " " + stripHtml(note.content)).toLowerCase();
      return haystack.includes(search);
    });
  }

  function getSelectedNote() {
    return state.notes.find((note) => note.id === state.selectedNoteId) || null;
  }

  function normalizeNote(note) {
    const createdAt = note && note.createdAt ? note.createdAt : new Date().toISOString();
    const updatedAt = note && note.updatedAt ? note.updatedAt : createdAt;

    return {
      id: (note && note.id) || createId(),
      title: (note && String(note.title || "").trim()) || "Untitled note",
      content: normalizeEditorHtml((note && note.content) || ""),
      color: resolveColor((note && note.color) || NOTE_COLORS[0].id),
      pinned: Boolean(note && note.pinned),
      createdAt,
      updatedAt,
    };
  }

  function resolveColor(colorId) {
    return NOTE_COLORS.some((item) => item.id === colorId)
      ? colorId
      : NOTE_COLORS[0].id;
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return (
      "note-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16)
    );
  }

  function normalizeEditorHtml(html) {
    const cleaned = String(html || "").replace(/^\s+|\s+$/g, "");
    if (!cleaned || cleaned === "<br>" || cleaned === "<div><br></div>") {
      return "";
    }
    return cleaned;
  }

  function summarize(html, maxLength) {
    const text = stripHtml(html).replace(/\s+/g, " ").trim();
    if (!text) {
      return "No content yet.";
    }
    return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
  }

  function stripHtml(html) {
    const container = document.createElement("div");
    container.innerHTML = html || "";
    return container.textContent || container.innerText || "";
  }

  function tiltFor(id, index) {
    let hash = 0;
    const source = String(id) + ":" + String(index);
    for (let i = 0; i < source.length; i += 1) {
      hash = (hash << 5) - hash + source.charCodeAt(i);
      hash |= 0;
    }
    const raw = ((Math.abs(hash) % 8) - 4) * 0.55;
    return raw.toFixed(2);
  }

  function formatTime(isoString) {
    if (!isoString) {
      return "just now";
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "just now";
    }
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function timestampValue(isoString) {
    const value = new Date(isoString).getTime();
    return Number.isNaN(value) ? 0 : value;
  }

  function shouldSeedDemo(query) {
    const value = query.get("demo");
    return value === "1" || value === "true";
  }

  function slug(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "default";
  }

  function pickFirst(value) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || "";
    }
    if (typeof value === "number") {
      return String(value);
    }
    return "";
  }
})();
