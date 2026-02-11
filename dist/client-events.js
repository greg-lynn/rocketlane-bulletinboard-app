"use strict";

(function bulletinBoardClientEvents() {
  const POLL_INTERVAL_MS = 30000;
  const MAX_BADGE = 99;
  const BADGE_ID = "rl-bb-unread-badge";

  let client = null;
  let lastUnreadCount = null;

  init().catch((error) => {
    // Client events should never hard-fail the host page.
    console.warn("[bb client-events] init failed", error);
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

    updateNavBadge(count);

    if (!isFirst && lastUnreadCount !== null && count > lastUnreadCount) {
      showToast(
        count === 1
          ? "New bulletin board post"
          : `${count} new bulletin board posts`
      );
    }

    lastUnreadCount = count;
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
    } catch (_error) {
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
    if (!target) {
      return;
    }

    let badge = document.getElementById(BADGE_ID);
    if (count <= 0) {
      if (badge && badge.parentElement) {
        badge.parentElement.removeChild(badge);
      }
      return;
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

    if (!badge.parentElement) {
      container.appendChild(badge);
    }
  }

  function findNavTarget() {
    // Rocketlane's left-nav icons typically expose a tooltip via title/aria-label.
    const byTitle = document.querySelector(
      '[title*="Bulletin"][title*="Board"],[aria-label*="Bulletin"][aria-label*="Board"]'
    );
    if (byTitle) {
      return byTitle;
    }

    // Fallback: look for any link/button mentioning bulletin board.
    const candidates = Array.from(
      document.querySelectorAll("a,button,[role=\"button\"]")
    );
    return (
      candidates.find((el) =>
        String(el.textContent || "")
          .toLowerCase()
          .includes("bulletin board")
      ) || null
    );
  }
})();

