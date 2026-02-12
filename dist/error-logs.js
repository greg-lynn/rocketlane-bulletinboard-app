"use strict";

(function errorLogsApp() {
  const POLL_INTERVAL_MS = 30000;

  const state = {
    client: null,
    logs: [],
    summary: { info: 0, warn: 0, error: 0 },
    search: "",
    severity: "all",
    status: "all",
    loading: true,
  };

  const refs = {};

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      console.error("Error Logs app init failed", error);
      setStatus(
        "Failed to initialize. Fix: reload Rocketlane and ensure the latest app ZIP is deployed."
      );
    });
  });

  async function init() {
    cacheRefs();
    bindEvents();
    state.client = await initRocketlaneClient();
    await refreshLogs();
    window.setInterval(() => {
      refreshLogs().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  function cacheRefs() {
    refs.searchInput = document.getElementById("searchInput");
    refs.severityFilter = document.getElementById("severityFilter");
    refs.statusFilter = document.getElementById("statusFilter");
    refs.refreshBtn = document.getElementById("refreshBtn");
    refs.clearBtn = document.getElementById("clearBtn");
    refs.summary = document.getElementById("summary");
    refs.statusLine = document.getElementById("statusLine");
    refs.logs = document.getElementById("logs");
    refs.empty = document.getElementById("empty");
  }

  function bindEvents() {
    refs.searchInput.addEventListener("input", (event) => {
      state.search = String(event.target.value || "").toLowerCase().trim();
      render();
    });
    refs.severityFilter.addEventListener("change", (event) => {
      state.severity = event.target.value;
      render();
    });
    refs.statusFilter.addEventListener("change", (event) => {
      state.status = event.target.value;
      render();
    });
    refs.refreshBtn.addEventListener("click", () => {
      refreshLogs().catch(() => {});
    });
    refs.clearBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("Clear all bulletin board error logs?");
      if (!confirmed) {
        return;
      }
      await invokeAction("bb_clearErrorLogs", {});
      await refreshLogs();
    });
  }

  async function initRocketlaneClient() {
    if (window.rliSdk && typeof window.rliSdk.init === "function") {
      try {
        return await window.rliSdk.init({});
      } catch (_error) {
        // fall through
      }
    }

    if (window.rocketlaneApp && typeof window.rocketlaneApp.init === "function") {
      try {
        return await window.rocketlaneApp.init();
      } catch (_error2) {
        // fall through
      }
    }

    return null;
  }

  async function invokeAction(name, payload) {
    if (!state.client || !state.client.data || typeof state.client.data.invoke !== "function") {
      throw new Error(
        "Server actions are unavailable. Fix: install this app in Rocketlane (not as a local file)."
      );
    }
    const resp = await state.client.data.invoke(name, payload || {});
    return resp && Object.prototype.hasOwnProperty.call(resp, "response")
      ? resp.response
      : resp;
  }

  async function refreshLogs() {
    state.loading = true;
    setStatus("Loading logs…");

    try {
      const data = await invokeAction("bb_listErrors", {});
      state.logs = Array.isArray(data && data.logs) ? data.logs : [];
      state.summary =
        data && data.summary
          ? data.summary
          : summarizeSeverities(state.logs);
      state.loading = false;
      render();
      setStatus(
        `Loaded ${state.logs.length} log(s). Last refresh: ${formatTime(
          new Date().toISOString()
        )}`
      );
    } catch (error) {
      state.loading = false;
      setStatus(
        "Unable to load logs. Fix: confirm the app was uploaded from artifacts/rocketlane-bulletin-board-app.rli.zip and refresh Rocketlane."
      );
      console.error("Failed to load logs", error);
      render();
    }
  }

  function render() {
    renderSummary();
    renderLogs();
  }

  function renderSummary() {
    refs.summary.innerHTML = "";
    const items = [
      { key: "error", label: "Errors" },
      { key: "warn", label: "Warnings" },
      { key: "info", label: "Info" },
    ];
    items.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = `chip ${item.key}`;
      chip.innerHTML = `${item.label}: <b>${Number(state.summary[item.key] || 0)}</b>`;
      refs.summary.appendChild(chip);
    });
  }

  function renderLogs() {
    refs.logs.innerHTML = "";
    const logs = getVisibleLogs();
    refs.empty.hidden = logs.length > 0;

    logs.forEach((log) => {
      const card = document.createElement("article");
      card.className = "log-card" + (log.resolvedAt ? " resolved" : "");

      const top = document.createElement("div");
      top.className = "log-top";

      const left = document.createElement("div");
      const sev = document.createElement("span");
      sev.className = `severity ${normalizeSeverity(log.severity)}`;
      sev.textContent = normalizeSeverity(log.severity).toUpperCase();
      const code = document.createElement("span");
      code.className = "code";
      code.textContent = String(log.code || "UNKNOWN");
      left.appendChild(sev);
      left.appendChild(document.createTextNode(" "));
      left.appendChild(code);
      top.appendChild(left);

      if (!log.resolvedAt) {
        const resolveBtn = document.createElement("button");
        resolveBtn.type = "button";
        resolveBtn.className = "btn btn-subtle";
        resolveBtn.textContent = "Mark resolved";
        resolveBtn.addEventListener("click", async () => {
          await invokeAction("bb_markErrorResolved", {
            errorId: log.id,
            resolutionNote: "Resolved from Error Logs app",
          });
          await refreshLogs();
        });
        top.appendChild(resolveBtn);
      }

      const title = document.createElement("h3");
      title.className = "title";
      title.textContent = String(log.title || "Unknown issue");

      const message = document.createElement("p");
      message.className = "message";
      message.textContent = String(log.message || "");

      const fixBox = document.createElement("section");
      fixBox.className = "fix-box";
      const fixTitle = document.createElement("h4");
      fixTitle.textContent = "How to fix";
      fixBox.appendChild(fixTitle);
      const fixSummary = document.createElement("p");
      fixSummary.textContent = String(
        (log.fix && log.fix.summary) || "No fix guidance provided."
      );
      fixBox.appendChild(fixSummary);
      const steps = Array.isArray(log.fix && log.fix.steps) ? log.fix.steps : [];
      if (steps.length) {
        const ol = document.createElement("ol");
        steps.forEach((step) => {
          const li = document.createElement("li");
          li.textContent = String(step);
          ol.appendChild(li);
        });
        fixBox.appendChild(ol);
      }

      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Technical details";
      details.appendChild(summary);
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(
        {
          details: log.details || "",
          stack: log.stack || "",
          context: log.context || {},
          meta: log.meta || {},
        },
        null,
        2
      );
      details.appendChild(pre);

      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = [
        `Source: ${String(log.source || "n/a")}`,
        `Created: ${formatTime(log.createdAt)}`,
        log.context && log.context.userName
          ? `User: ${log.context.userName}`
          : "",
        log.resolvedAt ? `Resolved: ${formatTime(log.resolvedAt)}` : "Status: Open",
      ]
        .filter(Boolean)
        .join(" • ");

      card.appendChild(top);
      card.appendChild(title);
      card.appendChild(message);
      card.appendChild(fixBox);
      card.appendChild(details);
      card.appendChild(meta);
      refs.logs.appendChild(card);
    });
  }

  function getVisibleLogs() {
    return state.logs.filter((log) => {
      if (state.severity !== "all" && normalizeSeverity(log.severity) !== state.severity) {
        return false;
      }
      if (state.status === "open" && log.resolvedAt) {
        return false;
      }
      if (state.status === "resolved" && !log.resolvedAt) {
        return false;
      }
      if (!state.search) {
        return true;
      }
      const haystack = [
        log.title,
        log.message,
        log.code,
        log.source,
        log.details,
        log.fix && log.fix.summary,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(state.search);
    });
  }

  function normalizeSeverity(severity) {
    const value = String(severity || "error").toLowerCase();
    if (value === "info" || value === "warn" || value === "error") {
      return value;
    }
    return "error";
  }

  function summarizeSeverities(logs) {
    return logs.reduce(
      (acc, item) => {
        acc[normalizeSeverity(item && item.severity)] += 1;
        return acc;
      },
      { info: 0, warn: 0, error: 0 }
    );
  }

  function setStatus(text) {
    refs.statusLine.textContent = text;
  }

  function formatTime(iso) {
    if (!iso) {
      return "n/a";
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return "n/a";
    }
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
})();

