import express from 'express';
import crypto from 'crypto';
import {
  saveDb,
  findDbByApiKeyAsync,
  getUnsealedAccount,
  isGenuineVerifiedAccount,
  readAccountBinary,
  readOfflineVaultBinaryAsync,
  writeAccountBinary,
  deleteAccountBinary,
  selectTargetAccount,
  normalizeTrustLevel,
  makeId,
} from './store.mjs';
import {
  downloadFileFromRemoteProvider,
  uploadFileToRemoteProvider,
  sealCredentials,
} from './cloudAdapters.mjs';
import { buildFolderPathMap, isLikelyTextMime } from './aiApi.mjs';
import {
  createWorkspace,
  commitWorkspace,
  checkoutWorkspace,
  listWorkspaces,
} from './repoEngine.mjs';

const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

function getOAuthConfigForProvider(db, providerId) {
  const envClientId = process.env[`${providerId.toUpperCase()}_CLIENT_ID`];
  const envSecret = process.env[`${providerId.toUpperCase()}_CLIENT_SECRET`];
  if (envClientId) {
    return { clientId: envClientId, clientSecret: envSecret || '' };
  }
  return db.oauthApps?.[providerId] || null;
}

function makeTokenUpdateHandler(db, account) {
  return (newCreds) => {
    account.sealedCredentials = sealCredentials(newCreds);
    saveDb(db.vaultId);
  };
}

function getAllowedScopeForKey(db, apiKeyObj) {
  const activeFolders = db.folders.filter((f) => !f.trashed);
  const activeFiles = db.files.filter((f) => !f.trashed);

  if (!apiKeyObj.allowedFolderIds || apiKeyObj.allowedFolderIds.length === 0) {
    return { folders: activeFolders, files: activeFiles, allowedIds: null };
  }

  const allowedIds = new Set(apiKeyObj.allowedFolderIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of activeFolders) {
      if (f.parentId && allowedIds.has(f.parentId) && !allowedIds.has(f.id)) {
        allowedIds.add(f.id);
        changed = true;
      }
    }
  }

  return {
    folders: activeFolders.filter((f) => allowedIds.has(f.id)),
    files: activeFiles.filter((f) => f.folderId && allowedIds.has(f.folderId)),
    allowedIds,
  };
}

function recordMcpAudit(db, keyObj, actionName, statusCode = 200) {
  keyObj.usageCount = (keyObj.usageCount || 0) + 1;
  keyObj.lastUsedAt = new Date().toISOString();
  db.aiAuditLog = db.aiAuditLog || [];
  db.aiAuditLog.unshift({
    id: makeId('aud'),
    keyId: keyObj.id,
    keyName: keyObj.name,
    method: 'MCP',
    endpoint: `/api/mcp#${actionName}`,
    status: statusCode,
    timestamp: keyObj.lastUsedAt,
  });
  if (db.aiAuditLog.length > 60) {
    db.aiAuditLog.length = 60;
  }
  saveDb(db.vaultId);
}

async function resolveFileText(db, file) {
  if (typeof file.textContent === 'string') return file.textContent;

  let buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
  if (!buf && (!file.accountId || file.accountId === 'offline_vault')) {
    buf = await readOfflineVaultBinaryAsync(db.vaultId, file.id);
  }
  if (!buf && (file.remoteId || file.remotePath)) {
    const acc = db.accounts.find((a) => a.id === file.accountId);
    if (acc && isGenuineVerifiedAccount(acc)) {
      buf = await downloadFileFromRemoteProvider(
        getUnsealedAccount(acc),
        file,
        (pid) => getOAuthConfigForProvider(db, pid),
        makeTokenUpdateHandler(db, acc)
      );
      if (buf) {
        writeAccountBinary(
          file.accountId,
          file.id,
          buf,
          db.vaultId,
          buf._exportedMimeType || file.mimeType
        );
      }
    }
  }
  if (buf) {
    const effMime = buf._exportedMimeType || file.mimeType || '';
    if (isLikelyTextMime(effMime, file.name) || effMime.startsWith('text/')) {
      const txt = buf.toString('utf8');
      if (buf.byteLength <= 2 * 1024 * 1024) {
        file.textContent = txt;
        saveDb(db.vaultId);
      }
      return txt;
    }
  }
  return null;
}

export function getToolsForTrustLevel(trustLevel) {
  const normalTools = [
    {
      name: 'list_tools',
      description:
        'Fetches the list of available tools from Cloudy; used at the start of a session to confirm permission to access storage, key trust level, and workspace (wpc) capabilities.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_wpc',
      description:
        "Lists all available workspaces (wpc) and their current versions, branches, latest commit hashes, and folder/file counts in the user's Cloudy storage.",
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_folders',
      description:
        'List accessible carpetas (folders) in the Cloudy vault with full paths and file counts.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_files',
      description:
        'List accessible files in the Cloudy vault, optionally filtered by folderId.',
      inputSchema: {
        type: 'object',
        properties: {
          folderId: {
            type: 'string',
            description: 'Optional carpeta ID (or "root") to filter files.',
          },
        },
      },
    },
    {
      name: 'search_vault',
      description:
        'Search across Cloudy vault file names, carpetas, tags, and full text content.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keywords or phrase to search for.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_file',
      description:
        'Read the full text or markdown content of a file in the Cloudy vault by fileId.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: 'The Cloudy file ID (e.g. "fil_welcome").',
          },
        },
        required: ['fileId'],
      },
    },
  ];

  const mediumTools = [
    {
      name: 'create_wpc',
      description:
        "Initializes a new project workspace (wpc) in the user's Cloudy storage, creating the physical folder structure (/Repos/<name>) in their Cloud Pool. Requires Repo name, Repo description, and Repo README.md content.",
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Repo name? (e.g. "Cloudy-Core" or "ai-agent").',
          },
          description: {
            type: 'string',
            description: 'Repo description? Short summary of what this repository project does.',
          },
          readme: {
            type: 'string',
            description:
              'Repo README? Full Markdown content to write into the root README.md of this repository.',
          },
          branch: {
            type: 'string',
            description: 'Default branch name (defaults to "main").',
          },
          template: {
            type: 'string',
            enum: ['blank', 'typescript', 'python_ai', 'web_app'],
            description:
              'Optional starter scaffold ("blank" default, "typescript", "python_ai", or "web_app").',
          },
          files: {
            type: 'array',
            description: 'Optional extra initial files to seed into the workspace.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Relative path inside the repo (e.g. "src/main.ts").' },
                content: { type: 'string', description: 'UTF-8 file content.' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['name', 'description', 'readme'],
      },
    },
    {
      name: 'commit',
      description:
        'Saves the current state of the sandbox/workspace to Cloudy as a versioned snapshot. Used after a successful build or completed feature; optionally writes or updates sandbox files before snapshotting.',
      inputSchema: {
        type: 'object',
        properties: {
          wpcId: {
            type: 'string',
            description: 'Workspace ID (e.g. "wpc_..."), slug, or repository name.',
          },
          message: {
            type: 'string',
            description: 'Commit summary message describing the changes.',
          },
          files: {
            type: 'array',
            description: 'Optional sandbox files to create or update before recording the snapshot.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Relative path inside the workspace (e.g. "src/app.ts").' },
                content: { type: 'string', description: 'Updated UTF-8 file content.' },
              },
              required: ['path', 'content'],
            },
          },
          deletePaths: {
            type: 'array',
            description: 'Optional relative file paths to delete from the workspace prior to snapshot.',
            items: { type: 'string' },
          },
        },
        required: ['wpcId', 'message'],
      },
    },
    {
      name: 'checkout',
      description:
        'Restores a previous version of the workspace (wpc) from Cloudy back into the sandbox/vault. Used to rollback broken code or undo recent changes.',
      inputSchema: {
        type: 'object',
        properties: {
          wpcId: {
            type: 'string',
            description: 'Workspace ID (e.g. "wpc_..."), slug, or repository name.',
          },
          target: {
            type: 'string',
            description:
              'Target commit hash (e.g. "8a4f21c"), version number (e.g. "1" or "v1"), or "HEAD" to restore latest committed snapshot.',
          },
        },
        required: ['wpcId'],
      },
    },
    {
      name: 'create_folder',
      description:
        'Create a new carpeta (folder) inside the Cloudy vault (requires Medium or Proved trust).',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the new carpeta.',
          },
          parentId: {
            type: 'string',
            description: 'Optional parent carpeta ID.',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'save_note',
      description:
        'Create and sync a Markdown, JSON, or text note into the Cloudy vault and connected Cloud Pool (requires Medium or Proved trust).',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'File name (e.g. "Research-Summary.md").',
          },
          content: {
            type: 'string',
            description: 'Full text/markdown content to save.',
          },
          folderId: {
            type: 'string',
            description: 'Optional carpeta ID where the note should be stored.',
          },
        },
        required: ['name', 'content'],
      },
    },
    {
      name: 'update_file',
      description:
        'Update the text content or rename an existing file in the Cloudy vault (requires Medium or Proved trust).',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: 'Existing file ID to update.',
          },
          content: {
            type: 'string',
            description: 'Updated text content.',
          },
          name: {
            type: 'string',
            description: 'Optional new file name.',
          },
        },
        required: ['fileId'],
      },
    },
  ];

  const provedTools = [
    {
      name: 'move_file',
      description:
        'Move or organize a file into another carpeta (requires Proved trust level).',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: 'ID of the file to move.',
          },
          folderId: {
            type: 'string',
            description: 'Target carpeta ID, or empty string for root vault.',
          },
        },
        required: ['fileId', 'folderId'],
      },
    },
    {
      name: 'delete_file',
      description:
        'Move a file to trash or delete it permanently (requires Proved trust level).',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: 'ID of the file to trash or delete.',
          },
          permanent: {
            type: 'boolean',
            description: 'If true, permanently deletes the file; defaults to false (moves to Trash).',
          },
        },
        required: ['fileId'],
      },
    },
    {
      name: 'vault_pool_status',
      description:
        'Inspect live connected Cloud Pool providers, total storage quota, used bytes, and routing rule (requires Proved trust level).',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  if (trustLevel === 'proved') {
    return [...normalTools, ...mediumTools, ...provedTools];
  }
  if (trustLevel === 'medium') {
    return [...normalTools, ...mediumTools];
  }
  return normalTools;
}

function extractMcpApiKey(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    const bearer = auth.slice(7).trim();
    if (bearer.startsWith('cldy_sk_')) return bearer;
  }
  const headerKey = String(req.headers['x-api-key'] || '').trim();
  if (headerKey) return headerKey;
  const queryKey = String(req.query.key || req.query.api_key || '').trim();
  if (queryKey) return queryKey;
  return '';
}

async function executeMcpToolCall(db, aiKey, trustLevel, toolName, args = {}) {
  const { folders, files, allowedIds } = getAllowedScopeForKey(db, aiKey);
  const pathMap = buildFolderPathMap(db.folders);
  const allowedToolNames = new Set(
    getToolsForTrustLevel(trustLevel).map((t) => t.name)
  );

  if (!allowedToolNames.has(toolName)) {
    recordMcpAudit(db, aiKey, `denied:${toolName}`, 403);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Permission denied: tool "${toolName}" is not permitted for key "${aiKey.name}" (current Key Trust Level: ${trustLevel.toUpperCase()}). Upgrade the key trust level in Cloudy → AI API to use this tool.`,
        },
      ],
    };
  }

  if (toolName === 'list_tools') {
    const toolsList = getToolsForTrustLevel(trustLevel).map((t) => ({
      name: t.name,
      description: t.description,
      required: t.inputSchema?.required || [],
    }));
    const payload = {
      ok: true,
      storagePermissionConfirmed: true,
      vaultId: db.vaultId,
      keyName: aiKey.name,
      trustLevel,
      scope: aiKey.scope || (trustLevel === 'normal' ? 'read' : 'read_write'),
      connectedCloudsCount: (db.accounts || []).length,
      workspacesCount: (db.repos || []).length,
      toolsCount: toolsList.length,
      tools: toolsList,
    };
    recordMcpAudit(db, aiKey, 'list_tools', 200);
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
  }

  if (toolName === 'list_wpc') {
    const allWorkspaces = listWorkspaces(db);
    const visibleWorkspaces = allowedIds
      ? allWorkspaces.filter((w) => w.rootFolderId && allowedIds.has(w.rootFolderId))
      : allWorkspaces;
    const summary = visibleWorkspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      description: w.description,
      branch: w.branch,
      rootFolderId: w.rootFolderId,
      rootPath: w.rootPath,
      currentVersion: w.currentVersion,
      headCommitHash: w.headCommitHash,
      headCommitMessage: w.headCommitMessage,
      commitsCount: (w.commits || []).length,
      foldersCount: w.foldersCount,
      filesCount: w.filesCount,
      totalBytes: w.totalBytes,
      updatedAt: w.updatedAt,
    }));
    recordMcpAudit(db, aiKey, 'list_wpc', 200);
    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
    };
  }

  if (toolName === 'create_wpc') {
    if (allowedIds) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Creating a new workspace (/Repos/<name>) requires an unscoped key or a key scoped to the /Repos root carpeta.',
          },
        ],
      };
    }
    const rawName = String(args?.name || '').trim();
    const rawDesc = String(args?.description || '').trim();
    const rawReadme = String(args?.readme || '').trim();
    const missingPrompts = [];
    if (!rawName) missingPrompts.push({ field: 'name', question: 'Repo name?' });
    if (!rawDesc) {
      missingPrompts.push({ field: 'description', question: 'Repo description?' });
    }
    if (!rawReadme) {
      missingPrompts.push({
        field: 'readme',
        question: 'Repo README? (Markdown content for README.md)',
      });
    }
    if (missingPrompts.length > 0) {
      recordMcpAudit(db, aiKey, 'create_wpc:prompt_required_fields', 200);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: false,
                needsInput: true,
                message:
                  'To initialize this Cloudy Repo workspace, please answer the following and call create_wpc again:',
                questions: missingPrompts,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      const created = await createWorkspace(db, {
        name: rawName,
        description: rawDesc,
        readme: rawReadme,
        branch: args?.branch || 'main',
        template: args?.template || 'blank',
        initialFiles: Array.isArray(args?.files) ? args.files : null,
        authorName: aiKey.name || 'MCP Agent',
      });
      const repo = created.repo;
      await saveDb(db.vaultId);
      recordMcpAudit(db, aiKey, 'create_wpc', 201);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                alreadyExisted: created.alreadyExisted,
                wpcId: repo.id,
                name: repo.name,
                slug: repo.slug,
                branch: repo.branch,
                rootFolderId: repo.rootFolderId,
                rootPath: repo.rootPath,
                currentVersion: repo.currentVersion,
                headCommitHash: repo.headCommitHash,
                headCommitMessage: repo.headCommitMessage,
                filesCount: repo.filesCount,
                foldersCount: repo.foldersCount,
                totalBytes: repo.totalBytes,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      recordMcpAudit(db, aiKey, 'create_wpc', 400);
      return {
        isError: true,
        content: [{ type: 'text', text: err.message || 'Failed to create workspace.' }],
      };
    }
  }

  if (toolName === 'commit') {
    try {
      const result = await commitWorkspace(db, {
        wpcId: args?.wpcId,
        message: args?.message,
        authorName: aiKey.name || 'MCP Agent',
        files: Array.isArray(args?.files) ? args.files : null,
        deletePaths: Array.isArray(args?.deletePaths) ? args.deletePaths : null,
      });
      await saveDb(db.vaultId);
      recordMcpAudit(db, aiKey, 'commit', 201);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                wpcId: result.repo.id,
                name: result.repo.name,
                version: result.commit.version,
                commitHash: result.commit.hash,
                message: result.commit.message,
                filesCount: result.commit.filesCount,
                foldersCount: result.commit.foldersCount,
                createdAt: result.commit.createdAt,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      recordMcpAudit(db, aiKey, 'commit', 400);
      return {
        isError: true,
        content: [{ type: 'text', text: err.message || 'Commit failed.' }],
      };
    }
  }

  if (toolName === 'checkout') {
    try {
      const result = await checkoutWorkspace(db, {
        wpcId: args?.wpcId,
        target: args?.target,
        authorName: aiKey.name || 'MCP Agent',
      });
      await saveDb(db.vaultId);
      recordMcpAudit(db, aiKey, 'checkout', 200);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                wpcId: result.repo.id,
                name: result.repo.name,
                restoredVersion: result.restoredCommit.version,
                restoredCommitHash: result.restoredCommit.hash,
                restoredMessage: result.restoredCommit.message,
                filesSnapshot: (result.restoredCommit.files || []).map((s) => ({
                  path: s.path,
                  size: s.size,
                  content: s.textContent,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      recordMcpAudit(db, aiKey, 'checkout', 400);
      return {
        isError: true,
        content: [{ type: 'text', text: err.message || 'Checkout failed.' }],
      };
    }
  }

  if (toolName === 'list_folders') {
    const out = folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      path: pathMap.get(f.id) || `/${f.name}`,
      fileCount: files.filter((fl) => fl.folderId === f.id).length,
    }));
    recordMcpAudit(db, aiKey, 'list_folders', 200);
    return {
      content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
    };
  }

  if (toolName === 'list_files') {
    const folderFilter = args?.folderId ? String(args.folderId) : null;
    const filtered = folderFilter
      ? files.filter((f) =>
          folderFilter === 'root' ? !f.folderId : f.folderId === folderFilter
        )
      : files;
    const out = filtered.map((f) => ({
      id: f.id,
      name: f.name,
      folderId: f.folderId,
      folderPath: f.folderId ? pathMap.get(f.folderId) || '/' : '/',
      mimeType: f.mimeType,
      size: f.size,
      providerName: f.providerName,
      updatedAt: f.updatedAt,
    }));
    recordMcpAudit(db, aiKey, 'list_files', 200);
    return {
      content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
    };
  }

  if (toolName === 'search_vault') {
    const rawQuery = String(args?.query || '').trim();
    const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];

    for (const f of files) {
      const folderPath = f.folderId ? pathMap.get(f.folderId) || '/' : '/';
      const hayName = `${f.name} ${folderPath} ${(f.tags || []).join(' ')}`.toLowerCase();
      const hayBody = (f.textContent || '').toLowerCase();

      if (terms.length === 0) {
        scored.push({ file: f, folderPath, score: 1 });
        continue;
      }
      let score = 0;
      for (const t of terms) {
        if (hayName.includes(t)) score += 5;
        if (hayBody.includes(t)) score += 2;
      }
      if (score > 0) scored.push({ file: f, folderPath, score });
    }
    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, 20).map(({ file, folderPath, score }) => ({
      id: file.id,
      name: file.name,
      folderId: file.folderId,
      folderPath,
      mimeType: file.mimeType,
      size: file.size,
      score,
      snippet: (file.textContent || '').slice(0, 500),
    }));
    recordMcpAudit(db, aiKey, 'search_vault', 200);
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  }

  if (toolName === 'read_file') {
    const fileId = String(args?.fileId || '').trim();
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      recordMcpAudit(db, aiKey, 'read_file', 404);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `File "${fileId}" not found or outside permitted carpetas.`,
          },
        ],
      };
    }
    const text = await resolveFileText(db, file);
    recordMcpAudit(db, aiKey, 'read_file', 200);
    return {
      content: [
        {
          type: 'text',
          text:
            text ??
            `[Binary file: ${file.name} (${file.mimeType}, ${file.size} bytes) stored on ${file.providerName}]`,
        },
      ],
    };
  }

  if (toolName === 'create_folder') {
    const name = String(args?.name || '').trim();
    if (!name) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Folder "name" is required.' }],
      };
    }
    const parentId = args?.parentId ? String(args.parentId) : null;
    if (allowedIds && (!parentId || !allowedIds.has(parentId))) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Parent carpeta is outside the folder scope permitted for this key.',
          },
        ],
      };
    }
    const now = new Date().toISOString();
    const folder = {
      id: makeId('fld'),
      name,
      parentId,
      offlinePinned: true,
      starred: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    };
    db.folders.unshift(folder);
    saveDb(db.vaultId);
    recordMcpAudit(db, aiKey, 'create_folder', 201);
    return {
      content: [{ type: 'text', text: JSON.stringify(folder, null, 2) }],
    };
  }

  if (toolName === 'save_note') {
    const rawName = String(args?.name || '').trim();
    if (!rawName) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Field "name" is required.' }],
      };
    }
    const name = rawName.includes('.') ? rawName : `${rawName}.md`;
    const content = String(args?.content ?? '');
    const folderId = args?.folderId ? String(args.folderId) : null;
    if (allowedIds && (!folderId || !allowedIds.has(folderId))) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Target folderId is outside the permitted carpetas for this key.',
          },
        ],
      };
    }

    const mimeType = name.endsWith('.json') ? 'application/json' : 'text/markdown';
    const buf = Buffer.from(content, 'utf8');
    const id = makeId('fil');

    let accountId = 'offline_vault';
    let providerId = 'offline_vault';
    let providerName = 'Offline Vault';
    let mirrorAccountId = null;
    let remoteMeta = null;

    if (
      db.accounts.some((a) => a.status === 'connected' && isGenuineVerifiedAccount(a))
    ) {
      const { primary, mirror } = selectTargetAccount(db, buf.byteLength, mimeType);
      remoteMeta = await uploadFileToRemoteProvider(
        getUnsealedAccount(primary),
        name,
        buf,
        mimeType,
        (pid) => getOAuthConfigForProvider(db, pid),
        makeTokenUpdateHandler(db, primary)
      );
      accountId = primary.id;
      providerId = primary.providerId;
      providerName = primary.providerName;
      mirrorAccountId = mirror ? mirror.id : null;
      if (mirror) writeAccountBinary(mirror.id, id, buf, db.vaultId, mimeType);
    }
    writeAccountBinary(accountId, id, buf, db.vaultId, mimeType);

    const now = new Date().toISOString();
    const newFile = {
      id,
      name,
      folderId,
      mimeType,
      kind: 'note',
      size: buf.byteLength,
      accountId,
      providerId,
      providerName,
      remoteId: remoteMeta?.remoteId || null,
      remotePath: remoteMeta?.remotePath || null,
      webUrl: remoteMeta?.webUrl || null,
      mirrorAccountId,
      offlinePinned: true,
      starred: false,
      trashed: false,
      tags: ['mcp-created'],
      textContent: content,
      createdAt: now,
      updatedAt: now,
    };
    db.files.unshift(newFile);
    saveDb(db.vaultId);
    recordMcpAudit(db, aiKey, 'save_note', 201);
    return {
      content: [{ type: 'text', text: JSON.stringify(newFile, null, 2) }],
    };
  }

  if (toolName === 'update_file') {
    const fileId = String(args?.fileId || '').trim();
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      return {
        isError: true,
        content: [{ type: 'text', text: `File "${fileId}" not found or not permitted.` }],
      };
    }
    if (typeof args?.name === 'string' && args.name.trim()) {
      file.name = args.name.trim();
    }
    if (typeof args?.content === 'string') {
      const buf = Buffer.from(args.content, 'utf8');
      writeAccountBinary(file.accountId, file.id, buf, db.vaultId, file.mimeType);
      file.textContent = args.content;
      file.size = buf.byteLength;

      const owningAcc = db.accounts.find((a) => a.id === file.accountId);
      if (owningAcc && isGenuineVerifiedAccount(owningAcc)) {
        const remoteMeta = await uploadFileToRemoteProvider(
          getUnsealedAccount(owningAcc),
          file.name,
          buf,
          file.mimeType || 'text/plain',
          (pid) => getOAuthConfigForProvider(db, pid),
          makeTokenUpdateHandler(db, owningAcc),
          { remoteId: file.remoteId, remotePath: file.remotePath }
        );
        if (remoteMeta) {
          file.remoteId = remoteMeta.remoteId || file.remoteId;
          file.remotePath = remoteMeta.remotePath || file.remotePath;
          file.webUrl = remoteMeta.webUrl || file.webUrl;
        }
      }
    }
    file.updatedAt = new Date().toISOString();
    saveDb(db.vaultId);
    recordMcpAudit(db, aiKey, 'update_file', 200);
    return {
      content: [{ type: 'text', text: JSON.stringify(file, null, 2) }],
    };
  }

  if (toolName === 'move_file') {
    const fileId = String(args?.fileId || '').trim();
    const targetFolderId =
      args?.folderId && args.folderId !== 'root' ? String(args.folderId) : null;
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      return {
        isError: true,
        content: [{ type: 'text', text: `File "${fileId}" not found.` }],
      };
    }
    if (allowedIds && (!targetFolderId || !allowedIds.has(targetFolderId))) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Target folderId is outside permitted carpetas for this key.',
          },
        ],
      };
    }
    file.folderId = targetFolderId;
    file.updatedAt = new Date().toISOString();
    saveDb(db.vaultId);
    recordMcpAudit(db, aiKey, 'move_file', 200);
    return {
      content: [{ type: 'text', text: JSON.stringify(file, null, 2) }],
    };
  }

  if (toolName === 'delete_file') {
    const fileId = String(args?.fileId || '').trim();
    const permanent = Boolean(args?.permanent);
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      return {
        isError: true,
        content: [{ type: 'text', text: `File "${fileId}" not found.` }],
      };
    }
    if (permanent) {
      deleteAccountBinary(file.accountId, file.id, file.mirrorAccountId, db.vaultId);
      db.files = db.files.filter((f) => f.id !== fileId);
    } else {
      file.trashed = true;
      file.updatedAt = new Date().toISOString();
    }
    saveDb(db.vaultId);
    recordMcpAudit(db, aiKey, permanent ? 'delete_file' : 'trash_file', 200);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            fileId,
            action: permanent ? 'deleted_permanently' : 'moved_to_trash',
          }),
        },
      ],
    };
  }

  if (toolName === 'vault_pool_status') {
    const totalQuotaBytes = db.accounts.reduce((s, a) => s + (a.quotaBytes || 0), 0);
    const totalUsedBytes = db.accounts.reduce((s, a) => s + (a.usedBytes || 0), 0);
    const summary = {
      vaultId: db.vaultId,
      allocationRule: db.settings?.allocationRule || 'most_free',
      connectedCloudsCount: db.accounts.length,
      totalQuotaBytes,
      totalUsedBytes,
      accounts: db.accounts.map((a) => ({
        id: a.id,
        providerName: a.providerName,
        accountLabel: a.accountLabel,
        quotaBytes: a.quotaBytes,
        usedBytes: a.usedBytes,
        status: a.status,
      })),
    };
    recordMcpAudit(db, aiKey, 'vault_pool_status', 200);
    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
    };
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `Unknown tool "${toolName}".` }],
  };
}

async function handleSingleRpcMessage(msg, db, aiKey, trustLevel) {
  if (!msg || typeof msg !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid JSON-RPC request' },
    };
  }

  const { id, method, params = {} } = msg;

  // Notifications have no id and produce no response object
  if (id === undefined) {
    return null;
  }

  if (method === 'initialize') {
    const requestedVersion = String(params?.protocolVersion || '');
    const negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
      ? requestedVersion
      : DEFAULT_PROTOCOL_VERSION;

    recordMcpAudit(db, aiKey, 'initialize', 200);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: negotiatedVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: 'cloudy-xkilo-vault-mcp',
          version: '2.0.0',
        },
        instructions: `Connected to Cloudy Vault (${aiKey.name} · Trust Level: ${trustLevel.toUpperCase()}). Use tools to search, read, and manage permitted carpetas and files.`,
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: getToolsForTrustLevel(trustLevel),
      },
    };
  }

  if (method === 'tools/call') {
    const toolName = String(params?.name || '');
    const args = params?.arguments || {};
    try {
      const toolResult = await executeMcpToolCall(
        db,
        aiKey,
        trustLevel,
        toolName,
        args
      );
      return {
        jsonrpc: '2.0',
        id,
        result: toolResult,
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Tool error: ${String(err?.message || err)}` }],
        },
      };
    }
  }

  if (method === 'resources/list') {
    const { files } = getAllowedScopeForKey(db, aiKey);
    const resources = files.slice(0, 50).map((f) => ({
      uri: `cloudy://file/${f.id}`,
      name: f.name,
      mimeType: f.mimeType || 'text/plain',
      description: `${f.providerName} (${f.size} bytes)`,
    }));
    return {
      jsonrpc: '2.0',
      id,
      result: { resources },
    };
  }

  if (method === 'resources/read') {
    const uri = String(params?.uri || '');
    const fileId = uri.replace(/^cloudy:\/\/file\//, '').trim();
    const { files } = getAllowedScopeForKey(db, aiKey);
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32002, message: `Resource not found: ${uri}` },
      };
    }
    const text = (await resolveFileText(db, file)) ?? '';
    recordMcpAudit(db, aiKey, 'resources/read', 200);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        contents: [
          {
            uri,
            mimeType: file.mimeType || 'text/plain',
            text,
          },
        ],
      },
    };
  }

  if (method === 'prompts/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        prompts: [
          {
            name: 'vault-context-assistant',
            description:
              'Search Cloudy carpetas and synthesize an answer grounded in your vault files.',
            arguments: [
              {
                name: 'topic',
                description: 'Topic or question to research in Cloudy vault.',
                required: true,
              },
            ],
          },
        ],
      },
    };
  }

  if (method === 'prompts/get') {
    const topic = String(params?.arguments?.topic || 'vault overview');
    return {
      jsonrpc: '2.0',
      id,
      result: {
        description: `Research "${topic}" across Cloudy vault`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Use search_vault and read_file to inspect my Cloudy vault regarding "${topic}", then provide a concise summary citing file names.`,
            },
          },
        ],
      },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

export function createMcpRouter() {
  const router = express.Router();

  router.use(async (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, X-API-Key, Content-Type, Accept, Mcp-Session-Id, Last-Event-ID'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    const token = extractMcpApiKey(req);
    if (!token) {
      return res.status(401).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message:
            'Missing Cloudy AI key. Append ?key=cldy_sk_... to the MCP URL or send Authorization: Bearer cldy_sk_...',
        },
      });
    }

    const found = await findDbByApiKeyAsync(token);
    if (!found) {
      return res.status(403).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32003,
          message: 'Invalid, paused, or revoked Cloudy AI key.',
        },
      });
    }

    req.cloudyDb = found.db;
    req.aiKey = found.matched;
    req.aiKeyToken = token;
    req.trustLevel = normalizeTrustLevel(found.matched.trustLevel, found.matched.scope);
    next();
  });

  // GET /api/mcp — Discovery JSON OR Legacy MCP SSE Endpoint Stream
  router.get('/', (req, res) => {
    const accept = String(req.headers.accept || '').toLowerCase();
    const tools = getToolsForTrustLevel(req.trustLevel);

    if (accept.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      const postEndpoint = `${req.baseUrl}?key=${encodeURIComponent(req.aiKeyToken)}`;
      res.write(`event: endpoint\ndata: ${postEndpoint}\n\n`);
      const keepAlive = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          clearInterval(keepAlive);
        }
      }, 15000);
      req.on('close', () => clearInterval(keepAlive));
      return;
    }

    res.json({
      ok: true,
      mcpFastConnect: true,
      server: 'cloudy-xkilo-vault-mcp',
      version: '2.0.0',
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      transport: 'streamable-http',
      keyName: req.aiKey.name,
      trustLevel: req.trustLevel,
      toolsCount: tools.length,
      tools: tools.map((t) => t.name),
    });
  });

  // POST /api/mcp — Streamable HTTP JSON-RPC 2.0 Handler (Single & Batch)
  router.post('/', async (req, res) => {
    try {
      const sessionId =
        req.headers['mcp-session-id'] ||
        `mcp_${crypto.randomBytes(8).toString('hex')}`;
      res.setHeader('Mcp-Session-Id', String(sessionId));

      const payload = req.body;
      if (Array.isArray(payload)) {
        const responses = [];
        for (const item of payload) {
          const out = await handleSingleRpcMessage(
            item,
            req.cloudyDb,
            req.aiKey,
            req.trustLevel
          );
          if (out) responses.push(out);
        }
        if (responses.length === 0) return res.status(202).end();
        return res.json(responses);
      }

      const response = await handleSingleRpcMessage(
        payload,
        req.cloudyDb,
        req.aiKey,
        req.trustLevel
      );
      if (!response) {
        return res.status(202).end();
      }
      return res.json(response);
    } catch (err) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: String(err?.message || err) },
      });
    }
  });

  // DELETE /api/mcp — Graceful Streamable HTTP Session Termination
  router.delete('/', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return router;
}
