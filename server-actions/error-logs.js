const ERROR_LOGS_KEY = "bb_error_logs_v1";
const MAX_ERROR_LOGS = 300;

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

function coerceSeverity(value) {
  const normalized = coerceString(value).toLowerCase();
  if (normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "error";
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => coerceString(item))
    .filter(Boolean)
    .slice(0, 15);
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

function buildFixGuidance(code, message) {
  const normalizedCode = coerceString(code).toUpperCase();
  const normalizedMessage = coerceString(message).toLowerCase();

  if (
    normalizedCode.includes("SDK") ||
    normalizedCode.includes("INIT") ||
    normalizedMessage.includes("sdk") ||
    normalizedMessage.includes("init")
  ) {
    return {
      summary:
        "Rocketlane SDK did not initialize. The app likely loaded outside a supported Rocketlane context or with an invalid build.",
      steps: [
        "Re-open the app from inside Rocketlane (not directly in a browser tab).",
        "Confirm the deployed package was built with `npm run package:rli`.",
        "Re-upload the latest app ZIP and refresh the Rocketlane page.",
      ],
    };
  }

  if (
    normalizedCode.includes("KV") ||
    normalizedMessage.includes("key-value") ||
    normalizedMessage.includes("kv")
  ) {
    return {
      summary:
        "The app failed while reading or writing the Rocketlane Key-Value store.",
      steps: [
        "Check Rocketlane app permissions and ensure server actions are enabled.",
        "Retry the operation after a few seconds (temporary service blips can happen).",
        "If repeated, re-deploy the app package to ensure server actions are up to date.",
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
        "A network or connectivity issue interrupted the request.",
      steps: [
        "Verify internet connectivity and retry.",
        "Refresh Rocketlane and attempt the same action again.",
        "If your org uses strict firewalls, allow Rocketlane app API traffic.",
      ],
    };
  }

  if (
    normalizedCode.includes("INVALID") ||
    normalizedCode.includes("PAYLOAD") ||
    normalizedMessage.includes("invalid")
  ) {
    return {
      summary:
        "The request payload was invalid or incomplete for this operation.",
      steps: [
        "Re-open the note and ensure required fields (title/content) are present.",
        "Retry with a simpler edit first, then apply advanced formatting.",
        "Update to the latest app version and re-test.",
      ],
    };
  }

  return {
    summary:
      "An unexpected application error occurred while processing the request.",
    steps: [
      "Refresh Rocketlane and retry the action.",
      "If it repeats, open this error in the Error Logs app and share the details with your admin.",
      "Re-upload the latest app build to ensure frontend and server code are in sync.",
    ],
  };
}

function normalizeFixGuidance(fix, code, message) {
  if (fix && typeof fix === "object") {
    const summary = coerceString(fix.summary);
    const steps = normalizeArray(fix.steps);
    if (summary) {
      return {
        summary,
        steps: steps.length ? steps : buildFixGuidance(code, message).steps,
      };
    }
  }

  if (typeof fix === "string" && fix.trim()) {
    return {
      summary: fix.trim(),
      steps: buildFixGuidance(code, message).steps,
    };
  }

  return buildFixGuidance(code, message);
}

function buildErrorRecord(args, input) {
  const payload = input && typeof input === "object" ? input : {};
  const userCtx = getUserContext(args);
  const code = coerceString(payload.code) || "UNKNOWN_ERROR";
  const message =
    coerceString(payload.message) || "An unknown error occurred in bulletin board app.";
  const stack = coerceString(payload.stack);
  const details = coerceString(payload.details);
  const source = coerceString(payload.source) || "bulletin-board";
  const title =
    coerceString(payload.title) ||
    `${source.replace(/[-_]/g, " ")} error`.replace(/\b\w/g, (c) =>
      c.toUpperCase()
    );
  const fix = normalizeFixGuidance(payload.fix, code, message);

  return {
    id: `err-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: nowIso(),
    severity: coerceSeverity(payload.severity),
    source,
    code,
    title,
    message,
    details,
    stack,
    fix,
    context: {
      ...userCtx,
      widgetId: coerceString(payload.widgetId),
      url: coerceString(payload.url),
    },
    resolvedAt: "",
    resolvedBy: "",
    resolutionNote: "",
    meta:
      payload.meta && typeof payload.meta === "object"
        ? payload.meta
        : {},
  };
}

async function readErrorLogPayload(r) {
  const raw = await r.kv.getAppValue(ERROR_LOGS_KEY);
  const value = unwrapKvValue(raw);
  if (!value || typeof value !== "object") {
    return { logs: [], updatedAt: "" };
  }
  return {
    logs: Array.isArray(value.logs) ? value.logs : [],
    updatedAt: coerceString(value.updatedAt),
  };
}

async function writeErrorLogPayload(r, logs) {
  const payload = {
    logs: Array.isArray(logs) ? logs.slice(0, MAX_ERROR_LOGS) : [],
    updatedAt: nowIso(),
  };
  await r.kv.setAppValue({
    key: ERROR_LOGS_KEY,
    value: payload,
  });
  return payload;
}

function summarizeSeverities(logs) {
  return logs.reduce(
    (acc, item) => {
      const severity = coerceSeverity(item && item.severity);
      acc[severity] += 1;
      return acc;
    },
    { info: 0, warn: 0, error: 0 }
  );
}

async function appendErrorLog(r, args, input) {
  const current = await readErrorLogPayload(r);
  const record = buildErrorRecord(args, input);
  const nextLogs = [record, ...current.logs].slice(0, MAX_ERROR_LOGS);
  const persisted = await writeErrorLogPayload(r, nextLogs);
  return {
    record,
    logs: persisted.logs,
    updatedAt: persisted.updatedAt,
    summary: summarizeSeverities(persisted.logs),
  };
}

async function bbLogError(r, args) {
  const payload = args && args.payload ? args.payload : {};
  const input = payload.log || payload;
  const result = await appendErrorLog(r, args, input);
  return {
    success: true,
    log: result.record,
    total: result.logs.length,
    summary: result.summary,
    updatedAt: result.updatedAt,
  };
}

async function bbListErrors(r) {
  const payload = await readErrorLogPayload(r);
  return {
    logs: payload.logs,
    total: payload.logs.length,
    summary: summarizeSeverities(payload.logs),
    updatedAt: payload.updatedAt,
  };
}

async function bbClearErrorLogs(r) {
  await writeErrorLogPayload(r, []);
  return {
    success: true,
    logs: [],
    total: 0,
    summary: { info: 0, warn: 0, error: 0 },
    updatedAt: nowIso(),
  };
}

async function bbMarkErrorResolved(r, args) {
  const payload = args && args.payload ? args.payload : {};
  const errorId = coerceString(payload.errorId);
  if (!errorId) {
    throw new Error("errorId is required");
  }

  const note = coerceString(payload.resolutionNote);
  const userCtx = getUserContext(args);
  const current = await readErrorLogPayload(r);
  const nextLogs = current.logs.map((item) => {
    if (!item || String(item.id) !== String(errorId)) {
      return item;
    }
    return {
      ...item,
      resolvedAt: nowIso(),
      resolvedBy: userCtx.userName,
      resolutionNote: note,
    };
  });
  const persisted = await writeErrorLogPayload(r, nextLogs);
  return {
    success: true,
    logs: persisted.logs,
    total: persisted.logs.length,
    summary: summarizeSeverities(persisted.logs),
    updatedAt: persisted.updatedAt,
  };
}

module.exports = {
  appendErrorLog,
  buildFixGuidance,
  bbLogError,
  bbListErrors,
  bbClearErrorLogs,
  bbMarkErrorResolved,
};

