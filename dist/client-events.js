"use strict";

(function bulletinBoardClientEvents() {
  const POLL_INTERVAL_MS = 30000;
  const MAX_BADGE = 99;
  const BADGE_ID = "rl-bb-unread-badge";
  const FALLBACK_BADGE_ID = "rl-bb-unread-fallback-badge";
  const NAV_ATTACH_OBSERVER_MS = 20000;
  const ERROR_LOG_THROTTLE_MS = 60000;

  let client = null;
  let lastUnreadCount = null;
  let lastErrorLogAt = 0;
  let navAttachObserver = null;
  let navAttachObserverTimer = null;

  init().catch((error) => {
    // Client events should never hard-fail the host page.
    console.warn("[bb client-events] init failed", error);
    logClientEventError({
      code: "CLIENT_EVENTS_INIT_FAILED",
      title: "Client events initialization failed",
      message: (error && error.message) || "Client events failed to initialize.",
      stack: error && error.stack ? String(error.stack) : "",
      details:
        "Unread-count polling and nav badge updates could not be initialized.",
    }).catch(() => {});
  });

  async function init() {
    client = await initRocketlaneClient();
    if (!client) {
      return;
    }

    await pollUnread(true);
    window.setInterval(() => {
      pollUnread(false).catch(() => {});
    }, POLL_INTERVAL_MS);

    window.addEventListener("focus", () => {
      pollUnread(false).catch(() => {});
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        pollUnread(false).catch(() => {});
      }
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

  async function pollUnread(isFirst) {
    const count = await getUnreadCount();
    if (count === null) {
      return;
    }

    const previous = lastUnreadCount;
    lastUnreadCount = count;
    const mounted = updateNavBadge(count);
    if (!mounted && count > 0) {
      updateFallbackBadge(count);
      ensureNavAttachObserver();
    } else {
      updateFallbackBadge(0);
      stopNavAttachObserver();
    }

    if (!isFirst && previous !== null && count > previous) {
      showToast(
        count === 1
          ? "New bulletin board post"
          : `${count} new bulletin board posts`
      );
    }
  }

  async function getUnreadCount() {
    if (!client || !client.data || typeof client.data.invoke !== "function") {
      return null;
    }

    try {
      const resp = await client.data.invoke("bb_getUnreadCount", {});
      const data =
        resp && Object.prototype.hasOwnProperty.call(resp, "response")
          ? resp.response
          : resp;
      const count = Number((data && data.unreadCount) || 0);
      return Number.isFinite(count) ? Math.max(0, count) : 0;
    } catch (error) {
      logClientEventError({
        code: "CLIENT_EVENTS_POLL_FAILED",
        title: "Unread poll failed",
        message:
          (error && error.message) ||
          "Failed to poll unread count for bulletin board posts.",
        stack: error && error.stack ? String(error.stack) : "",
        details:
          "The notification poll loop could not fetch unread updates from server actions.",
      }).catch(() => {});
      return null;
    }
  }

  function showToast(message) {
    if (!client || !client.interface || typeof client.interface.show !== "function") {
      return;
    }

    // Rocketlane supports `client.interface.show("notification", { type, message })`.
    client.interface
      .show("notification", {
        type: "info",
        message,
      })
      .catch(() => {});
  }

  function updateNavBadge(count) {
    const target = findNavTarget();
    let badge = document.getElementById(BADGE_ID);
    if (count <= 0) {
      removeBadge(BADGE_ID);
      removeBadge(FALLBACK_BADGE_ID);
      stopNavAttachObserver();
      return true;
    }

    if (!target) {
      removeBadge(BADGE_ID);
      return false;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.id = BADGE_ID;
      badge.setAttribute("aria-label", "Unread bulletin board posts");
      badge.style.position = "absolute";
      badge.style.top = "6px";
      badge.style.right = "6px";
      badge.style.minWidth = "18px";
      badge.style.height = "18px";
      badge.style.padding = "0 5px";
      badge.style.borderRadius = "999px";
      badge.style.background = "#d62c3b";
      badge.style.color = "#fff";
      badge.style.fontSize = "11px";
      badge.style.fontWeight = "800";
      badge.style.display = "inline-flex";
      badge.style.alignItems = "center";
      badge.style.justifyContent = "center";
      badge.style.pointerEvents = "none";
    }

    badge.textContent = count > MAX_BADGE ? `${MAX_BADGE}+` : String(count);

    // Ensure the target can anchor an absolute-positioned badge.
    const container = target.closest("a,button,[role=\"button\"],li,div") || target;
    const computedPosition = window.getComputedStyle(container).position;
    if (computedPosition === "static" || !computedPosition) {
      container.style.position = "relative";
    }

    if (badge.parentElement !== container) {
      container.appendChild(badge);
    }
    removeBadge(FALLBACK_BADGE_ID);
    return true;
  }

  function findNavTarget() {
    // Prefer strong hints first.
    const explicit = document.querySelector(
      '[href*="customer-bulletin-board"],[href*="rocketlane-bulletin-board"],[title*="bulletin" i],[aria-label*="bulletin" i],[data-tooltip*="bulletin" i]'
    );
    if (explicit && scoreTargetCandidate(explicit) > 0) {
      return explicit;
    }

    const candidates = Array.from(
      document.querySelectorAll(
        "a,button,[role=\"button\"],[title],[aria-label],[data-tooltip],[data-original-title]"
      )
    );
    let best = null;
    let bestScore = 0;
    candidates.forEach((el) => {
      const score = scoreTargetCandidate(el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    });
    return bestScore > 0 ? best : null;
  }

  function scoreTargetCandidate(el) {
    if (!el || !(el instanceof Element)) {
      return 0;
    }
    const text = getCandidateText(el);
    if (!text) {
      return 0;
    }

    let score = 0;
    if (text.includes("customer-bulletin-board")) score += 12;
    if (text.includes("rocketlane-bulletin-board")) score += 12;
    if (text.includes("bulletin board")) score += 10;
    if (text.includes("customer bulletin")) score += 8;
    if (text.includes("bulletin")) score += 5;
    if (text.includes("bb app")) score += 5;
    if (text.includes("sticky note")) score += 3;

    if (isNavLikeElement(el)) {
      score += 4;
    }

    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "a" || tag === "button" || String(el.getAttribute("role") || "") === "button") {
      score += 1;
    }

    return score;
  }

  function getCandidateText(el) {
    const chunks = [
      el.getAttribute("title"),
      el.getAttribute("aria-label"),
      el.getAttribute("data-tooltip"),
      el.getAttribute("data-original-title"),
      el.getAttribute("href"),
      el.id,
      typeof el.className === "string" ? el.className : "",
      String(el.textContent || "").slice(0, 180),
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase().trim())
      .filter(Boolean);
    return chunks.join(" ");
  }

  function isNavLikeElement(el) {
    return Boolean(
      el.closest(
        'nav,aside,[class*="nav"],[id*="nav"],[aria-label*="nav" i],[data-testid*="nav"]'
      )
    );
  }

  function removeBadge(id) {
    const node = document.getElementById(id);
    if (node && node.parentElement) {
      node.parentElement.removeChild(node);
    }
  }

  function updateFallbackBadge(count) {
    let badge = document.getElementById(FALLBACK_BADGE_ID);
    if (count <= 0) {
      removeBadge(FALLBACK_BADGE_ID);
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.id = FALLBACK_BADGE_ID;
      badge.setAttribute("aria-label", "Unread bulletin board posts");
      badge.style.position = "fixed";
      badge.style.top = "12px";
      badge.style.right = "12px";
      badge.style.minWidth = "32px";
      badge.style.height = "22px";
      badge.style.padding = "0 8px";
      badge.style.borderRadius = "999px";
      badge.style.background = "#d62c3b";
      badge.style.color = "#fff";
      badge.style.fontSize = "12px";
      badge.style.fontWeight = "800";
      badge.style.display = "inline-flex";
      badge.style.alignItems = "center";
      badge.style.justifyContent = "center";
      badge.style.pointerEvents = "none";
      badge.style.zIndex = "2147483000";
      badge.style.boxShadow = "0 8px 18px rgba(214, 44, 59, 0.32)";
    }

    const text = count > MAX_BADGE ? `${MAX_BADGE}+` : String(count);
    badge.textContent = `BB ${text}`;
    if (!badge.parentElement && document.body) {
      document.body.appendChild(badge);
    }
  }

  function ensureNavAttachObserver() {
    if (navAttachObserver || !document.body || typeof MutationObserver !== "function") {
      return;
    }

    navAttachObserver = new MutationObserver(() => {
      const count = Number(lastUnreadCount || 0);
      if (count <= 0) {
        stopNavAttachObserver();
        return;
      }
      if (updateNavBadge(count)) {
        stopNavAttachObserver();
      } else {
        updateFallbackBadge(count);
      }
    });
    navAttachObserver.observe(document.body, { childList: true, subtree: true });
    navAttachObserverTimer = window.setTimeout(() => {
      stopNavAttachObserver();
    }, NAV_ATTACH_OBSERVER_MS);
  }

  function stopNavAttachObserver() {
    if (navAttachObserver) {
      navAttachObserver.disconnect();
      navAttachObserver = null;
    }
    if (navAttachObserverTimer) {
      window.clearTimeout(navAttachObserverTimer);
      navAttachObserverTimer = null;
    }
  }

  async function logClientEventError(input) {
    const now = Date.now();
    if (now - lastErrorLogAt < ERROR_LOG_THROTTLE_MS) {
      return;
    }
    lastErrorLogAt = now;

    if (!client || !client.data || typeof client.data.invoke !== "function") {
      return;
    }

    const payload = input && typeof input === "object" ? input : {};
    await client.data.invoke("bb_logError", {
      log: {
        source: "bulletin-board-client-events",
        code: payload.code || "CLIENT_EVENTS_ERROR",
        severity: "warn",
        title: payload.title || "Bulletin board client events warning",
        message:
          payload.message ||
          "A client-events error occurred while tracking unread notifications.",
        details: payload.details || "",
        stack: payload.stack || "",
        fix: {
          summary:
            "Notification polling hit a transient issue. Refresh Rocketlane and verify server actions are available.",
          steps: [
            "Refresh Rocketlane and wait for client events to reinitialize.",
            "Confirm app server actions are deployed from the latest ZIP.",
            "If repeated, open Logs > Error Logs for full diagnostics.",
          ],
        },
      },
    });
  }
})();

