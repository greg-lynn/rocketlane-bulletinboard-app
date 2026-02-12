const widgets = [
  {
    identifier: "customer-bulletin-board-home-right",
    location: ["customer_portal_widget"],
    name: "Bulletin Board (Home sidebar)",
    description:
      "Sticky-note bulletin board intended for the Home right sidebar (place under Personal Tasks).",
    icon: "dist/icon.svg",
    entrypoint: {
      html: "dist/index.html",
    },
  },
  {
    identifier: "customer-bulletin-board-full",
    location: ["left_nav"],
    name: "Bulletin Board (Full)",
    description: "Full bulletin board view (for admins/team members).",
    icon: "dist/icon.svg",
    entrypoint: {
      html: "dist/index.html",
    },
  },
  {
    identifier: "customer-bulletin-board-error-logs",
    location: ["left_nav"],
    name: "Bulletin Board Error Logs",
    description:
      "Detailed error logs for bulletin board failures, including fix guidance.",
    icon: "dist/error-icon.svg",
    entrypoint: {
      html: "dist/error-logs.html",
    },
  },
];

const {
  bbListNotes,
  bbUpsertNote,
  bbDeleteNote,
  bbClearNotes,
  bbGetUnreadCount,
  bbMarkRead,
} = require("./server-actions/bulletin-board");

const {
  bbLogError,
  bbListErrors,
  bbClearErrorLogs,
  bbMarkErrorResolved,
} = require("./server-actions/error-logs");

const serverActions = [
  {
    name: "bb_listNotes",
    description: "List bulletin board notes.",
    run: bbListNotes,
  },
  {
    name: "bb_upsertNote",
    description: "Create or update a bulletin board note.",
    run: bbUpsertNote,
  },
  {
    name: "bb_deleteNote",
    description: "Delete a bulletin board note.",
    run: bbDeleteNote,
  },
  {
    name: "bb_clearNotes",
    description: "Clear all bulletin board notes.",
    run: bbClearNotes,
  },
  {
    name: "bb_getUnreadCount",
    description: "Get unread bulletin board post count for the current user.",
    run: bbGetUnreadCount,
  },
  {
    name: "bb_markRead",
    description: "Mark bulletin board posts as read for the current user.",
    run: bbMarkRead,
  },
  {
    name: "bb_logError",
    description: "Log a bulletin board error with fix guidance.",
    run: bbLogError,
  },
  {
    name: "bb_listErrors",
    description: "List bulletin board error logs.",
    run: bbListErrors,
  },
  {
    name: "bb_clearErrorLogs",
    description: "Clear all bulletin board error logs.",
    run: bbClearErrorLogs,
  },
  {
    name: "bb_markErrorResolved",
    description: "Mark an error log entry as resolved.",
    run: bbMarkErrorResolved,
  },
];

module.exports = {
  version: "1.2.0",
  widgets,
  serverActions,
  clientEvents: "dist/client-events.js",
  eventHandlers: {},
  scheduledActions: [],
};
