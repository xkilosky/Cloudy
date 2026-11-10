import crypto from 'crypto';
import path from 'path';
import {
  saveDb,
  getUnsealedAccount,
  isGenuineVerifiedAccount,
  readAccountBinary,
  readOfflineVaultBinaryAsync,
  writeAccountBinary,
  deleteAccountBinary,
  selectTargetAccount,
  makeId,
} from './store.mjs';
import {
  uploadFileToRemoteProvider,
  sealCredentials,
} from './cloudAdapters.mjs';

const MAX_FULL_SNAPSHOT_COMMITS = 25;
const MAX_SNAPSHOT_TEXT_BYTES = 512 * 1024; // 512 KB per text file inside commit JSON

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

export function slugifyRepoName(raw) {
  return (
    String(raw || 'workspace')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace'
  );
}

export function makeCommitHash(seed = '') {
  return crypto
    .createHash('sha1')
    .update(`${Date.now()}:${Math.random()}:${seed}`)
    .digest('hex')
    .slice(0, 7);
}

export function guessMimeTypeForPath(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.jsx': 'text/javascript',
    '.py': 'text/x-python',
    '.html': 'text/html',
    '.css': 'text/css',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml',
    '.sh': 'text/x-shellscript',
    '.sql': 'text/x-sql',
    '.toml': 'text/plain',
    '.env': 'text/plain',
    '.gitignore': 'text/plain',
  };
  return map[ext] || 'text/plain';
}

function normalizeRelPath(rawPath = '') {
  return String(rawPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
}

export function buildStarterTemplate(name, description = '', template = 'blank') {
  const title = String(name || 'Workspace').trim();
  const desc =
    String(description || '').trim() ||
    `${title} — versioned Cloudy workspace backed by your Cloud Pool.`;

  const baseReadme = `# ${title}\n\n## Getting Started\n\n${desc}\n\n### Cloudy Workspace Commands (MCP)\n- \`list_wpc\` — Inspect workspace status & current version\n- \`commit\` — Save a versioned snapshot to Cloudy\n- \`checkout\` — Roll back or restore any snapshot version\n`;

  if (template === 'typescript') {
    return {
      folders: ['src', 'src/lib', 'docs'],
      files: [
        { path: 'README.md', content: baseReadme },
        {
          path: 'package.json',
          content: JSON.stringify(
            {
              name: slugifyRepoName(title),
              version: '0.1.0',
              type: 'module',
              scripts: { build: 'tsc', start: 'node dist/index.js' },
            },
            null,
            2
          ),
        },
        {
          path: 'tsconfig.json',
          content: JSON.stringify(
            {
              compilerOptions: {
                target: 'ES2022',
                module: 'NodeNext',
                strict: true,
                outDir: 'dist',
              },
              include: ['src'],
            },
            null,
            2
          ),
        },
        {
          path: 'src/index.ts',
          content: `export function main(): void {\n  console.log('${title} initialized on Cloudy');\n}\n\nmain();\n`,
        },
      ],
      tasks: [
        { id: makeId('tsk'), title: 'Initialize TypeScript workspace', done: true },
        { id: makeId('tsk'), title: 'Implement core module logic in src/', done: false },
        { id: makeId('tsk'), title: 'Commit first milestone snapshot', done: false },
      ],
    };
  }

  if (template === 'python_ai') {
    return {
      folders: ['agent', 'prompts', 'docs'],
      files: [
        { path: 'README.md', content: baseReadme },
        {
          path: 'requirements.txt',
          content: '# Add Python packages here\nhttpx>=0.27.0\n',
        },
        {
          path: 'agent/main.py',
          content: `"""${title} — AI Agent Workspace"""\n\ndef run() -> None:\n    print("${title} agent ready")\n\nif __name__ == "__main__":\n    run()\n`,
        },
        {
          path: 'prompts/system.md',
          content: `# System Prompt\n\nYou are working inside the **${title}** Cloudy workspace.\n`,
        },
      ],
      tasks: [
        { id: makeId('tsk'), title: 'Set up Python agent structure', done: true },
        { id: makeId('tsk'), title: 'Configure system prompt & tools', done: false },
        { id: makeId('tsk'), title: 'Test & commit working build', done: false },
      ],
    };
  }

  if (template === 'web_app') {
    return {
      folders: ['src', 'src/components', 'public'],
      files: [
        { path: 'README.md', content: baseReadme },
        {
          path: 'index.html',
          content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>${title}</title>\n  </head>\n  <body>\n    <div id="app"></div>\n    <script type="module" src="/src/main.js"></script>\n  </body>\n</html>\n`,
        },
        {
          path: 'src/main.js',
          content: `document.querySelector('#app').innerHTML = '<h1>${title}</h1>';\n`,
        },
      ],
      tasks: [
        { id: makeId('tsk'), title: 'Scaffold web app workspace', done: true },
        { id: makeId('tsk'), title: 'Build UI components', done: false },
        { id: makeId('tsk'), title: 'Commit release snapshot', done: false },
      ],
    };
  }

  return {
    folders: ['src', 'docs'],
    files: [{ path: 'README.md', content: baseReadme }],
    tasks: [
      { id: makeId('tsk'), title: 'Initialize Cloudy workspace', done: true },
      { id: makeId('tsk'), title: 'Add project source files', done: false },
      { id: makeId('tsk'), title: 'Commit first versioned snapshot', done: false },
    ],
  };
}

function ensureReposParentFolder(db) {
  let reposRoot = db.folders.find(
    (f) => !f.trashed && !f.parentId && f.name.toLowerCase() === 'repos'
  );
  if (!reposRoot) {
    const now = new Date().toISOString();
    reposRoot = {
      id: makeId('fld'),
      name: 'Repos',
      parentId: null,
      offlinePinned: true,
      starred: true,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    };
    db.folders.unshift(reposRoot);
  }
  return reposRoot;
}

export function getDescendantTreeForRoot(db, rootFolderId) {
  const activeFolders = (db.folders || []).filter((f) => !f.trashed);
  const activeFiles = (db.files || []).filter((f) => !f.trashed);

  const folderById = new Map(activeFolders.map((f) => [f.id, f]));
  const relPathByFolderId = new Map([[rootFolderId, '']]);

  let changed = true;
  while (changed) {
    changed = false;
    for (const f of activeFolders) {
      if (
        f.parentId &&
        relPathByFolderId.has(f.parentId) &&
        !relPathByFolderId.has(f.id)
      ) {
        const parentRel = relPathByFolderId.get(f.parentId);
        relPathByFolderId.set(f.id, parentRel ? `${parentRel}/${f.name}` : f.name);
        changed = true;
      }
    }
  }

  const descendantFolders = [];
  for (const [fid, rel] of relPathByFolderId.entries()) {
    if (fid === rootFolderId) continue;
    const fObj = folderById.get(fid);
    if (fObj) descendantFolders.push({ folder: fObj, relPath: rel });
  }
  descendantFolders.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const descendantFiles = [];
  for (const fl of activeFiles) {
    if (fl.folderId && relPathByFolderId.has(fl.folderId)) {
      const folderRel = relPathByFolderId.get(fl.folderId);
      const relPath = folderRel ? `${folderRel}/${fl.name}` : fl.name;
      descendantFiles.push({ file: fl, relPath });
    }
  }
  descendantFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return { relPathByFolderId, descendantFolders, descendantFiles };
}

export function ensureSubfolderChain(db, rootFolderId, relDirPath) {
  const clean = normalizeRelPath(relDirPath);
  if (!clean) return rootFolderId;

  const parts = clean.split('/');
  let currentParentId = rootFolderId;
  const now = new Date().toISOString();

  for (const seg of parts) {
    let existing = db.folders.find(
      (f) =>
        !f.trashed &&
        f.parentId === currentParentId &&
        f.name.toLowerCase() === seg.toLowerCase()
    );
    if (!existing) {
      existing = {
        id: makeId('fld'),
        name: seg,
        parentId: currentParentId,
        offlinePinned: true,
        starred: false,
        trashed: false,
        createdAt: now,
        updatedAt: now,
      };
      db.folders.push(existing);
    }
    currentParentId = existing.id;
  }

  return currentParentId;
}

async function writePhysicalWorkspaceFile(
  db,
  targetFolderId,
  fileName,
  buf,
  mimeType,
  textContent,
  syncCloud = true
) {
  const existing = db.files.find(
    (f) =>
      !f.trashed &&
      f.folderId === targetFolderId &&
      f.name.toLowerCase() === fileName.toLowerCase()
  );
  const now = new Date().toISOString();

  if (existing) {
    writeAccountBinary(existing.accountId, existing.id, buf, db.vaultId, mimeType);
    existing.size = buf.byteLength;
    existing.mimeType = mimeType || existing.mimeType;
    existing.textContent = textContent;
    existing.updatedAt = now;

    if (syncCloud) {
      const owningAcc = db.accounts.find((a) => a.id === existing.accountId);
      if (owningAcc && isGenuineVerifiedAccount(owningAcc)) {
        try {
          const remoteMeta = await uploadFileToRemoteProvider(
            getUnsealedAccount(owningAcc),
            existing.name,
            buf,
            existing.mimeType,
            (pid) => getOAuthConfigForProvider(db, pid),
            makeTokenUpdateHandler(db, owningAcc),
            { remoteId: existing.remoteId, remotePath: existing.remotePath }
          );
          if (remoteMeta) {
            existing.remoteId = remoteMeta.remoteId || existing.remoteId;
            existing.remotePath = remoteMeta.remotePath || existing.remotePath;
            existing.webUrl = remoteMeta.webUrl || existing.webUrl;
          }
        } catch {
          // Local/vault binary is already persisted safely
        }
      }
    }
    return existing;
  }

  const id = makeId('fil');
  let accountId = 'offline_vault';
  let providerId = 'offline_vault';
  let providerName = 'Offline Vault';
  let mirrorAccountId = null;
  let remoteMeta = null;

  if (
    syncCloud &&
    db.accounts.some((a) => a.status === 'connected' && isGenuineVerifiedAccount(a))
  ) {
    try {
      const { primary, mirror } = selectTargetAccount(db, buf.byteLength, mimeType);
      remoteMeta = await uploadFileToRemoteProvider(
        getUnsealedAccount(primary),
        fileName,
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
    } catch {
      // Fallback to offline_vault if remote upload temporarily fails
    }
  }

  writeAccountBinary(accountId, id, buf, db.vaultId, mimeType);

  const created = {
    id,
    name: fileName,
    folderId: targetFolderId,
    mimeType,
    kind: fileName.toLowerCase().endsWith('.md') ? 'note' : 'file',
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
    tags: ['repo-wpc'],
    textContent,
    createdAt: now,
    updatedAt: now,
  };
  db.files.unshift(created);
  return created;
}

function markAncestorsCommitMeta(itemCommitMeta, relPath, meta) {
  const parts = normalizeRelPath(relPath).split('/');
  itemCommitMeta[parts.join('/')] = meta;
  for (let i = 1; i < parts.length; i++) {
    const dirRel = parts.slice(0, i).join('/');
    itemCommitMeta[dirRel] = meta;
  }
}

async function readTextForSnapshot(db, file) {
  if (typeof file.textContent === 'string') {
    return file.textContent.length <= MAX_SNAPSHOT_TEXT_BYTES
      ? file.textContent
      : file.textContent.slice(0, MAX_SNAPSHOT_TEXT_BYTES);
  }
  let buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
  if (!buf && (!file.accountId || file.accountId === 'offline_vault')) {
    buf = await readOfflineVaultBinaryAsync(db.vaultId, file.id);
  }
  if (buf && buf.byteLength <= MAX_SNAPSHOT_TEXT_BYTES) {
    const mime = (file.mimeType || '').toLowerCase();
    if (
      mime.startsWith('text/') ||
      mime.includes('json') ||
      mime.includes('javascript') ||
      mime.includes('typescript') ||
      mime.includes('xml') ||
      mime.includes('yaml')
    ) {
      return buf.toString('utf8');
    }
  }
  return null;
}

export function findWorkspace(db, identifier) {
  db.repos = Array.isArray(db.repos) ? db.repos : [];
  if (!identifier) return null;
  const needle = String(identifier).trim();
  const lower = needle.toLowerCase();
  return (
    db.repos.find(
      (r) =>
        r.id === needle ||
        r.slug === lower ||
        r.name.toLowerCase() === lower
    ) || null
  );
}

export function enrichWorkspaceSummary(db, repo) {
  const { descendantFolders, descendantFiles } = getDescendantTreeForRoot(
    db,
    repo.rootFolderId
  );
  const totalBytes = descendantFiles.reduce(
    (sum, item) => sum + Number(item.file?.size || 0),
    0
  );
  return {
    ...repo,
    rootPath: `/Repos/${repo.name}`,
    foldersCount: descendantFolders.length,
    filesCount: descendantFiles.length,
    totalBytes,
  };
}

export function listWorkspaces(db, allowedFolderIds = null) {
  db.repos = Array.isArray(db.repos) ? db.repos : [];
  let allowedSet = null;
  if (Array.isArray(allowedFolderIds) && allowedFolderIds.length > 0) {
    allowedSet = new Set(allowedFolderIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of db.folders || []) {
        if (!f.trashed && f.parentId && allowedSet.has(f.parentId) && !allowedSet.has(f.id)) {
          allowedSet.add(f.id);
          changed = true;
        }
      }
    }
  }

  return db.repos
    .filter((r) => (!allowedSet ? true : allowedSet.has(r.rootFolderId)))
    .map((r) => enrichWorkspaceSummary(db, r));
}

// --- TOOL 2: create_wpc ---
export async function createWorkspace(db, params = {}) {
  db.repos = Array.isArray(db.repos) ? db.repos : [];
  const rawName = String(params.name || '').trim();
  if (!rawName) {
    throw new Error('Workspace "name" is required.');
  }

  const slug = slugifyRepoName(rawName);
  const existing = db.repos.find(
    (r) => r.slug === slug || r.name.toLowerCase() === rawName.toLowerCase()
  );
  if (existing) {
    const enrichedExisting = enrichWorkspaceSummary(db, existing);
    return {
      alreadyExisted: true,
      workspace: enrichedExisting,
      repo: enrichedExisting,
    };
  }

  const now = new Date().toISOString();
  const branch = String(params.branch || 'main').trim() || 'main';
  const author = String(params.author || params.authorName || 'Cloudy User').trim();
  const description = String(params.description || '').trim();
  const templateId = String(params.template || 'typescript').trim();

  // Create physical /Repos/<name> folder structure in the user's Cloud Pool vault
  const reposParent = ensureReposParentFolder(db);
  const rootFolder = {
    id: makeId('fld'),
    name: rawName,
    parentId: reposParent.id,
    offlinePinned: true,
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };
  db.folders.unshift(rootFolder);

  const tpl = buildStarterTemplate(rawName, description, templateId);
  const foldersToCreate = Array.isArray(params.folders)
    ? params.folders
    : tpl.folders;
  const customSeedFiles = Array.isArray(params.files)
    ? params.files
    : Array.isArray(params.initialFiles)
      ? params.initialFiles
      : null;
  const filesToCreate =
    customSeedFiles && customSeedFiles.length > 0
      ? [...tpl.files, ...customSeedFiles]
      : tpl.files;

  const initHash = makeCommitHash(rawName);
  const initMessage = String(params.commitMessage || 'init: initial setup').trim();
  const itemCommitMeta = {};

  for (const relDir of foldersToCreate) {
    const cleanDir = normalizeRelPath(relDir);
    if (!cleanDir) continue;
    ensureSubfolderChain(db, rootFolder.id, cleanDir);
    markAncestorsCommitMeta(itemCommitMeta, cleanDir, {
      message: initMessage,
      hash: initHash,
      updatedAt: now,
    });
  }

  for (const fSpec of filesToCreate) {
    const cleanRel = normalizeRelPath(fSpec.path || fSpec.name || '');
    if (!cleanRel) continue;
    const parts = cleanRel.split('/');
    const fileName = parts.pop();
    const relDir = parts.join('/');
    const folderId = ensureSubfolderChain(db, rootFolder.id, relDir);
    const contentStr = String(fSpec.content ?? '');
    const buf =
      fSpec.encoding === 'base64'
        ? Buffer.from(contentStr, 'base64')
        : Buffer.from(contentStr, 'utf8');
    const mime = fSpec.mimeType || guessMimeTypeForPath(fileName);
    await writePhysicalWorkspaceFile(
      db,
      folderId,
      fileName,
      buf,
      mime,
      fSpec.encoding === 'base64' ? null : contentStr,
      params.syncCloud !== false
    );
    markAncestorsCommitMeta(itemCommitMeta, cleanRel, {
      message: initMessage,
      hash: initHash,
      updatedAt: now,
    });
  }

  const { descendantFolders, descendantFiles } = getDescendantTreeForRoot(
    db,
    rootFolder.id
  );

  const snapshotFiles = [];
  for (const { file, relPath } of descendantFiles) {
    snapshotFiles.push({
      path: relPath,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      textContent: await readTextForSnapshot(db, file),
      lastCommitMessage: initMessage,
      lastCommitHash: initHash,
      updatedAt: file.updatedAt,
    });
  }

  const initialCommit = {
    hash: initHash,
    version: 1,
    branch,
    message: initMessage,
    author,
    createdAt: now,
    foldersCount: descendantFolders.length,
    filesCount: snapshotFiles.length,
    folders: descendantFolders.map((d) => d.relPath),
    files: snapshotFiles,
  };

  const repo = {
    id: makeId('wpc'),
    name: rawName,
    slug,
    description:
      description || `${rawName} workspace backed by Cloudy storage pool`,
    branch,
    branches: [branch],
    rootFolderId: rootFolder.id,
    currentVersion: 1,
    headCommitHash: initHash,
    headCommitMessage: initMessage,
    headCommittedAt: now,
    roadmapTitle: params.roadmapTitle || 'v1.0 Roadmap',
    tasks: Array.isArray(params.tasks) ? params.tasks : tpl.tasks,
    itemCommitMeta,
    commits: [initialCommit],
    createdAt: now,
    updatedAt: now,
  };

  db.repos.unshift(repo);
  saveDb(db.vaultId);

  const enrichedNew = enrichWorkspaceSummary(db, repo);
  return {
    alreadyExisted: false,
    workspace: enrichedNew,
    repo: enrichedNew,
    initialCommit,
  };
}

// --- TOOL 3: commit ---
export async function commitWorkspace(db, params = {}) {
  const repo = findWorkspace(
    db,
    params.wpcId || params.repoId || params.name || params.workspace
  );
  if (!repo) {
    throw new Error(
      'Workspace not found. Call list_wpc or create_wpc first.'
    );
  }

  const now = new Date().toISOString();
  const message =
    String(params.message || '').trim() ||
    `chore: snapshot v${(repo.currentVersion || 1) + 1}`;
  const branch = String(params.branch || repo.branch || 'main').trim() || 'main';
  const author = String(params.author || params.authorName || 'Cloudy Agent').trim();
  const commitHash = makeCommitHash(`${repo.id}:${message}`);

  if (!Array.isArray(repo.branches)) repo.branches = ['main'];
  if (!repo.branches.includes(branch)) repo.branches.push(branch);
  repo.branch = branch;
  repo.itemCommitMeta = repo.itemCommitMeta || {};

  // Apply deleted paths if provided by sandbox agent
  const rawDeletes = Array.isArray(params.deletedPaths)
    ? params.deletedPaths
    : Array.isArray(params.deletePaths)
      ? params.deletePaths
      : [];
  if (rawDeletes.length > 0) {
    const delSet = new Set(rawDeletes.map((p) => normalizeRelPath(p)));
    const { descendantFiles } = getDescendantTreeForRoot(db, repo.rootFolderId);
    for (const { file, relPath } of descendantFiles) {
      if (delSet.has(relPath)) {
        deleteAccountBinary(
          file.accountId,
          file.id,
          file.mirrorAccountId,
          db.vaultId
        );
        db.files = db.files.filter((f) => f.id !== file.id);
        delete repo.itemCommitMeta[relPath];
      }
    }
  }

  // Apply new/modified sandbox folders if provided
  if (Array.isArray(params.folders)) {
    for (const relDir of params.folders) {
      const cleanDir = normalizeRelPath(relDir);
      if (!cleanDir) continue;
      ensureSubfolderChain(db, repo.rootFolderId, cleanDir);
      markAncestorsCommitMeta(repo.itemCommitMeta, cleanDir, {
        message,
        hash: commitHash,
        updatedAt: now,
      });
    }
  }

  // Apply new/modified sandbox files if provided
  if (Array.isArray(params.files) && params.files.length > 0) {
    for (const fSpec of params.files) {
      const cleanRel = normalizeRelPath(fSpec.path || fSpec.name || '');
      if (!cleanRel) continue;
      const parts = cleanRel.split('/');
      const fileName = parts.pop();
      const relDir = parts.join('/');
      const folderId = ensureSubfolderChain(db, repo.rootFolderId, relDir);
      const rawContent = String(fSpec.content ?? '');
      const isB64 = fSpec.encoding === 'base64';
      const buf = isB64
        ? Buffer.from(rawContent, 'base64')
        : Buffer.from(rawContent, 'utf8');
      const mime = fSpec.mimeType || guessMimeTypeForPath(fileName);

      await writePhysicalWorkspaceFile(
        db,
        folderId,
        fileName,
        buf,
        mime,
        isB64 ? null : rawContent,
        params.syncCloud !== false
      );
      markAncestorsCommitMeta(repo.itemCommitMeta, cleanRel, {
        message,
        hash: commitHash,
        updatedAt: now,
      });
    }
  }

  const { descendantFolders, descendantFiles } = getDescendantTreeForRoot(
    db,
    repo.rootFolderId
  );

  // Any file or folder added directly via Drive/Repo UI without commit meta gets stamped now
  for (const { relPath } of descendantFolders) {
    if (!repo.itemCommitMeta[relPath]) {
      repo.itemCommitMeta[relPath] = {
        message,
        hash: commitHash,
        updatedAt: now,
      };
    }
  }

  const snapshotFiles = [];
  for (const { file, relPath } of descendantFiles) {
    if (!repo.itemCommitMeta[relPath]) {
      markAncestorsCommitMeta(repo.itemCommitMeta, relPath, {
        message,
        hash: commitHash,
        updatedAt: now,
      });
    }
    const meta = repo.itemCommitMeta[relPath];
    snapshotFiles.push({
      path: relPath,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      textContent: await readTextForSnapshot(db, file),
      lastCommitMessage: meta?.message || message,
      lastCommitHash: meta?.hash || commitHash,
      updatedAt: file.updatedAt,
    });
  }

  const nextVersion = (repo.currentVersion || repo.commits?.length || 0) + 1;
  const commitObj = {
    hash: commitHash,
    version: nextVersion,
    branch,
    message,
    author,
    createdAt: now,
    foldersCount: descendantFolders.length,
    filesCount: snapshotFiles.length,
    folders: descendantFolders.map((d) => d.relPath),
    files: snapshotFiles,
  };

  repo.commits = [commitObj, ...(repo.commits || [])];
  // Trim heavy text bodies on very old commits beyond MAX_FULL_SNAPSHOT_COMMITS while keeping metadata
  if (repo.commits.length > MAX_FULL_SNAPSHOT_COMMITS) {
    repo.commits = repo.commits.map((c, idx) =>
      idx < MAX_FULL_SNAPSHOT_COMMITS
        ? c
        : { ...c, files: undefined, folders: undefined }
    );
  }

  repo.currentVersion = nextVersion;
  repo.headCommitHash = commitHash;
  repo.headCommitMessage = message;
  repo.headCommittedAt = now;
  repo.updatedAt = now;

  saveDb(db.vaultId);

  const enrichedCommitted = enrichWorkspaceSummary(db, repo);
  return {
    workspace: enrichedCommitted,
    repo: enrichedCommitted,
    commit: commitObj,
  };
}

// --- TOOL 4: checkout ---
export async function checkoutWorkspace(db, params = {}) {
  const repo = findWorkspace(
    db,
    params.wpcId || params.repoId || params.name || params.workspace
  );
  if (!repo) {
    throw new Error('Workspace not found. Call list_wpc first.');
  }

  const commits = Array.isArray(repo.commits) ? repo.commits : [];
  if (commits.length === 0) {
    throw new Error('Workspace has no commits to checkout.');
  }

  const rev = String(
    params.target || params.revision || params.commitHash || params.version || 'HEAD'
  ).trim();

  let targetCommit = null;
  if (!rev || rev.toUpperCase() === 'HEAD') {
    targetCommit = commits[0];
  } else if (/^HEAD~(\d+)$/i.test(rev)) {
    const offset = Number(rev.match(/^HEAD~(\d+)$/i)[1]);
    targetCommit = commits[Math.min(offset, commits.length - 1)];
  } else if (/^v?(\d+)$/i.test(rev)) {
    const vNum = Number(rev.replace(/^v/i, ''));
    targetCommit = commits.find((c) => c.version === vNum);
  } else {
    targetCommit = commits.find(
      (c) =>
        c.hash === rev ||
        c.hash.startsWith(rev.toLowerCase()) ||
        c.branch === rev
    );
  }

  if (!targetCommit) {
    throw new Error(`Snapshot revision "${rev}" not found in workspace "${repo.name}".`);
  }
  if (!Array.isArray(targetCommit.files)) {
    throw new Error(
      `Snapshot "${targetCommit.hash}" is older than the retention window and does not hold full file bodies.`
    );
  }

  // Restore physical tree inside repo.rootFolderId
  const { descendantFolders, descendantFiles } = getDescendantTreeForRoot(
    db,
    repo.rootFolderId
  );

  const targetFileSet = new Set(
    targetCommit.files.map((f) => normalizeRelPath(f.path))
  );
  const targetFolderSet = new Set(
    (targetCommit.folders || []).map((d) => normalizeRelPath(d))
  );
  for (const f of targetCommit.files) {
    const parts = normalizeRelPath(f.path).split('/');
    for (let i = 1; i < parts.length; i++) {
      targetFolderSet.add(parts.slice(0, i).join('/'));
    }
  }

  // Remove files not in target snapshot
  for (const { file, relPath } of descendantFiles) {
    if (!targetFileSet.has(relPath)) {
      deleteAccountBinary(
        file.accountId,
        file.id,
        file.mirrorAccountId,
        db.vaultId
      );
      db.files = db.files.filter((fl) => fl.id !== file.id);
    }
  }

  // Remove folders not in target snapshot (deepest first)
  const sortedDescFolders = [...descendantFolders].sort(
    (a, b) => b.relPath.length - a.relPath.length
  );
  for (const { folder, relPath } of sortedDescFolders) {
    if (!targetFolderSet.has(relPath)) {
      db.folders = db.folders.filter((fl) => fl.id !== folder.id);
    }
  }

  // Recreate target folders
  for (const dirRel of targetFolderSet) {
    ensureSubfolderChain(db, repo.rootFolderId, dirRel);
  }

  // Restore target files & item commit metadata
  const nextMeta = {};
  const restoredFilesPayload = [];

  for (const snapFile of targetCommit.files) {
    const cleanRel = normalizeRelPath(snapFile.path);
    const parts = cleanRel.split('/');
    const fileName = parts.pop();
    const relDir = parts.join('/');
    const folderId = ensureSubfolderChain(db, repo.rootFolderId, relDir);
    const contentStr = String(snapFile.textContent ?? '');
    const buf = Buffer.from(contentStr, 'utf8');
    const mime = snapFile.mimeType || guessMimeTypeForPath(fileName);

    await writePhysicalWorkspaceFile(
      db,
      folderId,
      fileName,
      buf,
      mime,
      contentStr,
      params.syncCloud !== false
    );

    markAncestorsCommitMeta(nextMeta, cleanRel, {
      message: snapFile.lastCommitMessage || targetCommit.message,
      hash: snapFile.lastCommitHash || targetCommit.hash,
      updatedAt: snapFile.updatedAt || targetCommit.createdAt,
    });

    restoredFilesPayload.push({
      path: cleanRel,
      name: fileName,
      mimeType: mime,
      size: buf.byteLength,
      content: contentStr,
    });
  }

  const now = new Date().toISOString();
  repo.itemCommitMeta = nextMeta;
  repo.currentVersion = targetCommit.version;
  repo.branch = targetCommit.branch || repo.branch;
  repo.headCommitHash = targetCommit.hash;
  repo.headCommitMessage = targetCommit.message;
  repo.headCommittedAt = targetCommit.createdAt;
  repo.updatedAt = now;

  saveDb(db.vaultId);

  const enrichedCheckedOut = enrichWorkspaceSummary(db, repo);
  return {
    workspace: enrichedCheckedOut,
    repo: enrichedCheckedOut,
    restoredCommit: targetCommit,
    folders: Array.from(targetFolderSet).sort(),
    files: restoredFilesPayload,
  };
}
