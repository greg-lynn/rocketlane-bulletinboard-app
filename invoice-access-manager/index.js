const { syncInvoicesFromSource } = require("./server-actions/sync-invoices-from-source");

const widgets = [
  {
    identifier: "invoice-access-manager",
    location: ["customer_portal_widget", "left_nav"],
    name: "Invoice Access Manager",
    description:
      "Import PDF invoices with role-based visibility for admins and PM-aligned collaborators.",
    icon: "dist/icon.svg",
    entrypoint: {
      html: "dist/index.html",
    },
  },
];

module.exports = {
  version: "1.0.0",
  widgets,
  serverActions: [
    {
      name: "syncInvoicesFromSource",
      description:
        "Fetch source projects, invoices, and team members from Rocketlane APIs.",
      run: syncInvoicesFromSource,
      triggers: ["FE"],
    },
  ],
  installationFields: () => [
    {
      name: "workspaceBaseUrl",
      description: "Workspace base URL (example: https://blink.rocketlane.com)",
      type: "text",
      required: false,
      rerenderAllFields: false,
      defaultValue: "https://blink.rocketlane.com",
      hidden: false,
      secure: false,
    },
    {
      name: "rocketlaneApiToken",
      description: "Rocketlane API key with project/document/team-member read access",
      type: "auth_api_key",
      required: false,
      rerenderAllFields: false,
      hidden: false,
      secure: true,
    },
  ],
  eventHandlers: {},
  scheduledActions: [],
};
