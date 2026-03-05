"use strict";

const DEFAULT_SOURCE_PROJECTS = ["Expert Advisor Program Invoices"];

function normalizeProjectName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isSourceProjectName(name, sourceProjectNames) {
  const normalized = normalizeProjectName(name);
  if (!normalized) {
    return false;
  }
  return sourceProjectNames.some((candidate) => {
    const target = normalizeProjectName(candidate);
    return (
      normalized === target ||
      normalized.includes(target) ||
      target.includes(normalized)
    );
  });
}

function pickFirst(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function ensureAbsoluteUrl(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (_error) {
    return "";
  }
}

function extractCollection(payload, preferredKeys) {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload;
  }

  const preferred = [];
  const pushIfArray = (value) => {
    if (Array.isArray(value)) {
      preferred.push(value);
    }
  };

  preferredKeys.forEach((key) => {
    if (payload && typeof payload === "object") {
      pushIfArray(payload[key]);
      if (payload.data && typeof payload.data === "object") {
        pushIfArray(payload.data[key]);
      }
      if (payload.response && typeof payload.response === "object") {
        pushIfArray(payload.response[key]);
      }
    }
  });

  if (preferred.length) {
    return preferred.sort((a, b) => b.length - a.length)[0];
  }

  return [];
}

async function requestJson(url, headers) {
  const response = await fetch(url, {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

async function requestCollection(baseUrl, headers, paths, preferredKeys) {
  const rows = [];
  const seen = new Set();
  const errors = [];

  for (let i = 0; i < paths.length; i += 1) {
    const url = ensureAbsoluteUrl(baseUrl, paths[i]);
    if (!url) {
      continue;
    }
    try {
      const payload = await requestJson(url, headers);
      const records = extractCollection(payload, preferredKeys);
      records.forEach((record) => {
        const key =
          pickFirst(
            record &&
              (record.id ||
                record._id ||
                record.projectId ||
                record.documentId ||
                record.fileId ||
                record.invoiceId ||
                record.invoiceNumber)
          ) ||
          JSON.stringify(record || {});
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        rows.push(record);
      });
    } catch (error) {
      errors.push(String(error && error.message ? error.message : error));
    }
  }

  return { rows, errors };
}

function normalizeProject(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const id = pickFirst(record.id || record._id || record.projectId);
  const name = pickFirst(
    record.name || record.projectName || record.projectTitle || record.title
  );
  if (!name) {
    return null;
  }
  const accountName = pickFirst(
    record.accountName ||
      record.companyName ||
      (record.account && record.account.name) ||
      (record.customer && record.customer.name)
  );
  return { id, name, accountName };
}

function extractEmails(value, output, depth) {
  if (depth > 5 || value == null) {
    return;
  }
  if (typeof value === "string") {
    const email = normalizeEmail(value);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      output.push(email);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => extractEmails(entry, output, depth + 1));
    return;
  }
  Object.keys(value).forEach((key) => extractEmails(value[key], output, depth + 1));
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const text = pickFirst(value);
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    result.push(text);
  });
  return result;
}

function normalizeInvoiceRecord(record, project, fallbackAccountName) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const invoiceNumber =
    pickFirst(
      record.invoiceNumber ||
        record.invoiceNo ||
        record.invoiceId ||
        record.billNumber ||
        record.referenceNumber ||
        record.docNumber ||
        record.number
    ) || "";
  const invoiceName =
    pickFirst(
      record.invoiceName ||
        record.invoiceTitle ||
        record.name ||
        record.fileName ||
        record.title ||
        record.subject
    ) || "Invoice";
  const invoiceDate =
    pickFirst(
      record.invoiceDate ||
        record.issuedDate ||
        record.issuedOn ||
        record.approvedAt ||
        record.submittedAt ||
        record.createdAt ||
        record.updatedAt
    ) || new Date().toISOString();
  const pdfUrl = pickFirst(
    record.signedUrl ||
      record.downloadUrl ||
      record.fileUrl ||
      record.url ||
      record.href ||
      record.previewUrl ||
      record.attachmentUrl ||
      record.documentUrl ||
      (record.file && (record.file.signedUrl || record.file.downloadUrl || record.file.url))
  );

  const emails = [];
  extractEmails(record, emails, 0);
  const associatedEmails = dedupeStrings(emails.map((email) => normalizeEmail(email)));

  const associatedUserIds = dedupeStrings([
    record.userId,
    record.userID,
    record.ownerId,
    record.assigneeId,
    record.projectManagerId,
    record.expertAdvisorId,
    record.createdByUserId,
    record.submittedByUserId,
    record.approvedByUserId,
    record.createdBy && record.createdBy.id,
    record.createdBy && record.createdBy.userId,
    record.user && record.user.id,
    record.user && record.user.userId,
  ]);

  if (!invoiceNumber && !invoiceName) {
    return null;
  }

  return {
    id:
      pickFirst(
        record.id ||
          record._id ||
          record.invoiceId ||
          record.documentId ||
          record.fileId ||
          record.invoiceNumber
      ) || `${project.id || project.name}-${invoiceNumber || invoiceName}`,
    invoiceNumber: invoiceNumber || `INV-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    invoiceName,
    ownerName: pickFirst(
      record.projectManagerName ||
        record.expertAdvisorName ||
        record.pmName ||
        record.ownerName ||
        record.assigneeName ||
        (record.owner && record.owner.name)
    ) || "Unassigned",
    accountName: project.accountName || fallbackAccountName || "Rocketlane Account",
    invoiceDate,
    pdfUrl,
    associatedEmails,
    associatedUserIds,
    sourceProjectName: project.name,
  };
}

function normalizeMember(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const email = normalizeEmail(
    pickFirst(
      record.email ||
        record.userEmail ||
        record.workEmail ||
        (record.user && record.user.email) ||
        (record.profile && record.profile.email)
    )
  );
  const id = pickFirst(record.id || record.userId || record._id);
  if (!email && !id) {
    return null;
  }
  return {
    id,
    email,
    permission: pickFirst(
      record.permission ||
        record.permissionSet ||
        record.accountPermission ||
        (record.permissionSetObj && record.permissionSetObj.name)
    ),
    roleLabel: pickFirst(record.role || record.userRole || record.designation || record.title),
  };
}

module.exports = {
  syncInvoicesFromSource: async (request = {}, context = {}) => {
    const sourceProjectNames = Array.isArray(request.sourceProjectNames)
      ? request.sourceProjectNames.filter(Boolean)
      : DEFAULT_SOURCE_PROJECTS;

    const installation = context.installation || {};
    const iParams = installation.iparams || {};
    const secureParams = installation.secureParams || {};
    const workspaceCandidates = dedupeStrings([
      request.workspaceBaseUrl,
      ...(Array.isArray(request.workspaceCandidates) ? request.workspaceCandidates : []),
      iParams.workspaceBaseUrl,
      iParams.workspaceUrl,
      secureParams.workspaceBaseUrl,
      secureParams.workspaceUrl,
      "https://blink.rocketlane.com",
      "https://innovate-calgary.rocketlane.com",
    ]);
    const apiToken =
      request.apiToken ||
      secureParams.rocketlaneApiToken ||
      secureParams.apiToken ||
      secureParams.apiKey ||
      iParams.rocketlaneApiToken ||
      iParams.apiToken ||
      context.apiKey ||
      "";

    if (!workspaceCandidates.length || !apiToken) {
      return {
        ok: false,
        error:
          "Missing workspace/API key configuration. Set workspaceBaseUrl and rocketlaneApiToken in app installation settings.",
        invoices: [],
        sourceProjects: [],
        teamMembers: [],
      };
    }

    const headers = {
      Accept: "application/json",
      "api-key": apiToken,
    };

    const diagnostics = {
      workspaceCandidates,
      projectErrors: [],
      invoiceErrors: [],
      memberErrors: [],
      workspaceUsed: "",
    };

    let sourceProjects = [];
    let invoices = [];
    let members = [];

    for (let w = 0; w < workspaceCandidates.length; w += 1) {
      const baseUrl = workspaceCandidates[w];

      const projectsResult = await requestCollection(
        baseUrl,
        headers,
        [
          "/api/1.0/projects?size=500",
          "/api/1.0/projects?limit=500",
          "/api/1.0/projects",
        ],
        ["projects", "data", "content", "results", "items"]
      );

      diagnostics.projectErrors.push(...projectsResult.errors);
      const allProjects = projectsResult.rows
        .map(normalizeProject)
        .filter(Boolean)
        .filter((project) => isSourceProjectName(project.name, sourceProjectNames));

      if (!allProjects.length) {
        continue;
      }

      const collectedInvoices = [];
      for (let i = 0; i < allProjects.length; i += 1) {
        const project = allProjects[i];
        const paths = [];
        if (project.id) {
          paths.push(
            `/api/1.0/projects/${encodeURIComponent(project.id)}/invoices?size=500`,
            `/api/1.0/projects/${encodeURIComponent(project.id)}/documents?size=500`,
            `/api/1.0/projects/${encodeURIComponent(project.id)}/files?size=500`,
            `/api/1.0/invoices?projectId=${encodeURIComponent(project.id)}&size=500`,
            `/api/1.0/documents?projectId=${encodeURIComponent(project.id)}&size=500`,
            `/api/1.0/files?projectId=${encodeURIComponent(project.id)}&size=500`
          );
        } else {
          paths.push("/api/1.0/invoices?size=500", "/api/1.0/documents?size=500");
        }

        const invoiceResult = await requestCollection(
          baseUrl,
          headers,
          paths,
          ["invoices", "documents", "files", "tasks", "data", "content", "results", "items"]
        );
        diagnostics.invoiceErrors.push(...invoiceResult.errors);
        invoiceResult.rows.forEach((row) => {
          const normalized = normalizeInvoiceRecord(
            row,
            project,
            request.accountName || iParams.accountName || ""
          );
          if (normalized) {
            collectedInvoices.push(normalized);
          }
        });
      }

      const membersResult = await requestCollection(
        baseUrl,
        headers,
        [
          "/api/1.0/users?size=500",
          "/api/1.0/users?limit=500",
          "/api/1.0/account-users?size=500",
          "/api/1.0/accountUsers?size=500",
        ],
        ["users", "members", "teamMembers", "data", "results", "items"]
      );
      diagnostics.memberErrors.push(...membersResult.errors);
      const normalizedMembers = membersResult.rows.map(normalizeMember).filter(Boolean);

      if (allProjects.length || collectedInvoices.length || normalizedMembers.length) {
        diagnostics.workspaceUsed = baseUrl;
        sourceProjects = allProjects;
        invoices = collectedInvoices;
        members = normalizedMembers;
        break;
      }
    }

    const dedupedInvoices = [];
    const seen = new Set();
    invoices.forEach((invoice) => {
      const key =
        `${invoice.invoiceNumber}|${invoice.sourceProjectName}|${invoice.id}`.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      dedupedInvoices.push(invoice);
    });

    return {
      ok: true,
      sourceProjects,
      invoices: dedupedInvoices,
      teamMembers: dedupeStrings(members.map((m) => `${m.email}|${m.id}`))
        .map((key) => members.find((m) => `${m.email}|${m.id}` === key))
        .filter(Boolean),
      diagnostics,
    };
  },
};
