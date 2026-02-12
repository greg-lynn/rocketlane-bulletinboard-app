const BOARD_KEY = "bb_board_v1";
const LAST_SEEN_PREFIX = "bb_last_seen_v1:";
const { appendErrorLog } = require("./error-logs");

function nowIso() {
  return new Date().toISOString();
}

function unwrapKvValue(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    return value.value;
  }
  return value;
}

function coerceString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function getUserFromContext(args) {
  const ctx = (args && args.context) || {};
  const user = ctx.user || ctx.actor || ctx.requestedBy || {};
  const id =
    coerceString(user.id) ||
    coerceString(user.userId) ||
    coerceString(user._id) ||
    coerceString(user.email) ||
    "unknown";
  const name =
    coerceString(user.fullName) ||
    coerceString(user.name) ||
    coerceString(user.displayName) ||
    coerceString(user.email) ||
    "Unknown user";
  return { id, name };
}

function normalizeIncomingNote(note, author) {
  const safe = note && typeof note === "object" ? note : {};
  const id = coerceString(safe.id) || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const createdAt = coerceString(safe.createdAt) || nowIso();
  const updatedAt = nowIso();
  return {
    id,
    title: coerceString(safe.title) || "Untitled note",
    content: coerceString(safe.content), // HTML string from editor
    color: coerceString(safe.color) || "yellow",
    pinned: Boolean(safe.pinned),
    createdAt,
    updatedAt,
    authorId: author.id,
    authorName: author.name,
  };
}

async function getBoard(r) {
  const raw = await r.kv.getAppValue(BOARD_KEY);
  const value = unwrapKvValue(raw);
  if (!value || typeof value !== "object") {
    return { revision: 0, updatedAt: "", notes: [] };
  }
  const notes = Array.isArray(value.notes) ? value.notes : [];
  return {
    revision: typeof value.revision === "number" ? value.revision : 0,
    updatedAt: coerceString(value.updatedAt),
    notes,
  };
}

async function setBoard(r, board) {
  const next = {
    revision: (board.revision || 0) + 1,
    updatedAt: nowIso(),
    notes: Array.isArray(board.notes) ? board.notes : [],
  };
  await r.kv.setAppValue({
    key: BOARD_KEY,
    value: next,
  });
  return next;
}

function parseLastSeen(raw) {
  const value = coerceString(unwrapKvValue(raw));
  if (!value) {
    return 0;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function noteTimestamp(note) {
  const t = new Date(note.updatedAt || note.createdAt || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function computeUnreadCount(board, user) {
  const lastSeenAtMs = user.lastSeenAtMs || 0;
  const unread = (board.notes || []).filter((n) => {
    if (!n) return false;
    if (String(n.authorId || "") === String(user.id || "")) {
      return false;
    }
    return noteTimestamp(n) > lastSeenAtMs;
  });
  return unread.length;
}

async function getLastSeenKey(r, userId) {
  const key = LAST_SEEN_PREFIX + userId;
  const raw = await r.kv.getAppValue(key);
  return { key, lastSeenAtMs: parseLastSeen(raw) };
}

async function setLastSeen(r, userId, isoString) {
  const key = LAST_SEEN_PREFIX + userId;
  await r.kv.setAppValue({
    key,
    value: coerceString(isoString) || nowIso(),
  });
}

async function buildResponse(r, args, boardOverride) {
  const author = getUserFromContext(args);
  const board = boardOverride || (await getBoard(r));
  const seen = await getLastSeenKey(r, author.id);
  const unreadCount = computeUnreadCount(board, { id: author.id, lastSeenAtMs: seen.lastSeenAtMs });
  return {
    notes: board.notes,
    unreadCount,
    revision: board.revision,
    updatedAt: board.updatedAt,
  };
}

async function bbListNotes(r, args) {
  const board = await getBoard(r);
  return buildResponse(r, args, board);
}

async function bbUpsertNote(r, args) {
  const author = getUserFromContext(args);
  const payload = args && args.payload ? args.payload : {};
  const incoming = payload.note;
  const board = await getBoard(r);
  const nextNote = normalizeIncomingNote(incoming, author);

  const existingIdx = board.notes.findIndex((n) => n && String(n.id) === String(nextNote.id));
  if (existingIdx >= 0) {
    // Keep original createdAt if it existed.
    const existing = board.notes[existingIdx];
    nextNote.createdAt = coerceString(existing && existing.createdAt) || nextNote.createdAt;
    board.notes[existingIdx] = nextNote;
  } else {
    board.notes.unshift(nextNote);
  }

  const saved = await setBoard(r, board);

  // Author just posted/updated; mark as read for them so they don't see their own post as unread.
  await setLastSeen(r, author.id, saved.updatedAt);

  return buildResponse(r, args, saved);
}

async function bbDeleteNote(r, args) {
  const payload = args && args.payload ? args.payload : {};
  const noteId = coerceString(payload.noteId);
  const board = await getBoard(r);
  board.notes = board.notes.filter((n) => n && String(n.id) !== String(noteId));
  const saved = await setBoard(r, board);
  return buildResponse(r, args, saved);
}

async function bbClearNotes(r, args) {
  const board = await getBoard(r);
  board.notes = [];
  const saved = await setBoard(r, board);
  return buildResponse(r, args, saved);
}

async function bbGetUnreadCount(r, args) {
  const author = getUserFromContext(args);
  const board = await getBoard(r);
  const seen = await getLastSeenKey(r, author.id);
  return {
    unreadCount: computeUnreadCount(board, { id: author.id, lastSeenAtMs: seen.lastSeenAtMs }),
    updatedAt: board.updatedAt,
    revision: board.revision,
  };
}

async function bbMarkRead(r, args) {
  const author = getUserFromContext(args);
  const payload = args && args.payload ? args.payload : {};
  const lastSeenAt = coerceString(payload.lastSeenAt) || nowIso();
  await setLastSeen(r, author.id, lastSeenAt);
  const board = await getBoard(r);
  return {
    notes: board.notes,
    unreadCount: 0,
    updatedAt: board.updatedAt,
    revision: board.revision,
  };
}

function withErrorLogging(actionName, fn) {
  return async (r, args) => {
    try {
      return await fn(r, args);
    } catch (error) {
      try {
        await appendErrorLog(r, args, {
          source: "bulletin-board-server",
          code: `${String(actionName).toUpperCase()}_FAILED`,
          severity: "error",
          title: `${actionName} failed`,
          message:
            (error && error.message) ||
            "A server-side bulletin board action failed unexpectedly.",
          details:
            "Server action execution failed while processing bulletin board data.",
          stack: error && error.stack ? String(error.stack) : "",
          fix: {
            summary:
              "The bulletin board backend could not complete this request.",
            steps: [
              "Refresh Rocketlane and retry the same action.",
              "Confirm the latest app ZIP is installed (frontend + server actions).",
              "Open 'Bulletin Board Error Logs' for details and resolution guidance.",
            ],
          },
        });
      } catch (_logError) {
        // Never mask the original failure because logging failed.
      }

      throw error;
    }
  };
}

module.exports = {
  bbListNotes: withErrorLogging("bb_listNotes", bbListNotes),
  bbUpsertNote: withErrorLogging("bb_upsertNote", bbUpsertNote),
  bbDeleteNote: withErrorLogging("bb_deleteNote", bbDeleteNote),
  bbClearNotes: withErrorLogging("bb_clearNotes", bbClearNotes),
  bbGetUnreadCount: withErrorLogging("bb_getUnreadCount", bbGetUnreadCount),
  bbMarkRead: withErrorLogging("bb_markRead", bbMarkRead),
};

