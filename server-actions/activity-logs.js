const ACTIVITY_LOGS_KEY = "bb_activity_logs_v1";
const MAX_ACTIVITY_LOGS = 500;

function nowIso() {
  return new Date().toISOString();
}

function unwrapKvValue(value) {
  if (!value) {
    return null;
  }
  if (
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "value")
  ) {
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

function getUserContext(args) {
  const ctx = (args && args.context) || {};
  const user = ctx.user || ctx.actor || ctx.requestedBy || {};
  const account = ctx.account || ctx.company || {};
  const project = ctx.project || {};

  return {
    userId:
      coerceString(user.id) ||
      coerceString(user.userId) ||
      coerceString(user._id) ||
      coerceString(user.email) ||
      "unknown",
    userName:
      coerceString(user.fullName) ||
      coerceString(user.name) ||
      coerceString(user.displayName) ||
      coerceString(user.email) ||
      "Unknown user",
    accountId:
      coerceString(account.id) ||
      coerceString(account.accountId) ||
      coerceString(account.companyId) ||
      "",
    accountName:
      coerceString(account.name) ||
      coerceString(account.accountName) ||
      coerceString(account.companyName) ||
      "",
    projectId: coerceString(project.id) || coerceString(project.projectId) || "",
    projectName:
      coerceString(project.name) || coerceString(project.projectName) || "",
  };
}

async function readActivityPayload(r) {
  const raw = await r.kv.getAppValue(ACTIVITY_LOGS_KEY);
  const value = unwrapKvValue(raw);
  if (!value || typeof value !== "object") {
    return { logs: [], updatedAt: "" };
  }
  return {
    logs: Array.isArray(value.logs) ? value.logs : [],
    updatedAt: coerceString(value.updatedAt),
  };
}

async function writeActivityPayload(r, logs) {
  const payload = {
    logs: Array.isArray(logs) ? logs.slice(0, MAX_ACTIVITY_LOGS) : [],
    updatedAt: nowIso(),
  };
  await r.kv.setAppValue({
    key: ACTIVITY_LOGS_KEY,
    value: payload,
  });
  return payload;
}

function normalizeActivityInput(args, input) {
  const payload = input && typeof input === "object" ? input : {};
  const ctx = getUserContext(args);
  return {
    id: `act-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: nowIso(),
    type: coerceString(payload.type) || "activity",
    title: coerceString(payload.title) || "Bulletin board activity",
    message: coerceString(payload.message) || "Activity recorded.",
    details: coerceString(payload.details),
    severity: coerceString(payload.severity) || "info",
    context: {
      ...ctx,
      widgetId: coerceString(payload.widgetId),
      url: coerceString(payload.url),
    },
    meta:
      payload.meta && typeof payload.meta === "object"
        ? payload.meta
        : {},
  };
}

async function appendActivityLog(r, args, input) {
  const current = await readActivityPayload(r);
  const record = normalizeActivityInput(args, input);
  const logs = [record, ...current.logs].slice(0, MAX_ACTIVITY_LOGS);
  const persisted = await writeActivityPayload(r, logs);
  return {
    log: record,
    logs: persisted.logs,
    total: persisted.logs.length,
    updatedAt: persisted.updatedAt,
  };
}

async function bbLogActivity(r, args) {
  const payload = args && args.payload ? args.payload : {};
  const input = payload.log || payload;
  const out = await appendActivityLog(r, args, input);
  return {
    success: true,
    log: out.log,
    total: out.total,
    updatedAt: out.updatedAt,
  };
}

async function bbListActivityLogs(r) {
  const payload = await readActivityPayload(r);
  return {
    logs: payload.logs,
    total: payload.logs.length,
    updatedAt: payload.updatedAt,
  };
}

async function bbClearActivityLogs(r) {
  const payload = await writeActivityPayload(r, []);
  return {
    success: true,
    logs: [],
    total: 0,
    updatedAt: payload.updatedAt,
  };
}

module.exports = {
  appendActivityLog,
  bbLogActivity,
  bbListActivityLogs,
  bbClearActivityLogs,
};

