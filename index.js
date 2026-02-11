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
];

module.exports = {
  version: "1.0.0",
  widgets,
  serverActions: [],
  eventHandlers: {},
  scheduledActions: [],
};
