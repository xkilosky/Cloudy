import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch,
  GitCommit,
  Folder,
  Plus,
  Code2,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  RotateCcw,
  Check,
  Copy,
  Trash2,
  LayoutGrid,
  BookOpen,
  Search,
  Sparkles,
  FilePlus2,
  FolderPlus,
  History,
  ExternalLink,
  X,
  Save,
  Terminal,
  CheckSquare,
  Square,
} from 'lucide-react';
import type {
  AuthUser,
  FileItem,
  FolderItem,
  RepoTask,
  RepoWorkspace,
  VaultState,
} from '../types';
import { formatBytes } from '../lib/format';
import { apiFetch } from '../lib/vaultClient';

interface RepoViewProps {
  vault: VaultState;
  authUser: AuthUser | null;
  isOffline: boolean;
  onRefreshVault: () => Promise<void>;
  onOpenInFilesExplorer: (folderId: string | null) => void;
  onOpenFilePreview: (file: FileItem) => void;
  onCreateFolderInVault: (name: string, parentId: string | null) => Promise<FolderItem | void>;
  onShowToast: (msg: string) => void;
}

function formatShortAgo(iso: string | null | undefined): string {
  if (!iso) return 'now';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 45_000) return 'now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${Math.max(1, months)}mo ago`;
}

function getFileBadgeInfo(fileName: string): {
  label: string;
  className: string;
} {
  const lower = fileName.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return {
        label: ext.toUpperCase(),
        className: 'bg-[#3178C6]/18 text-[#6CB6FF] border-[#3178C6]/35',
      };
    case 'js':
    case 'jsx':
    case 'mjs':
      return {
        label: ext === 'mjs' ? 'MJS' : ext.toUpperCase(),
        className: 'bg-[#F0DB4F]/16 text-[#F5DE6C] border-[#F0DB4F]/30',
      };
    case 'py':
      return {
        label: 'PY',
        className: 'bg-[#3572A5]/20 text-[#79B8FF] border-[#3572A5]/35',
      };
    case 'json':
      return {
        label: 'JSON',
        className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      };
    case 'md':
      return {
        label: 'MD',
        className: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
      };
    case 'css':
    case 'scss':
      return {
        label: 'CSS',
        className: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      };
    case 'html':
      return {
        label: 'HTML',
        className: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
      };
    case 'sql':
      return {
        label: 'SQL',
        className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    default:
      return {
        label: (ext.slice(0, 4) || 'FILE').toUpperCase(),
        className: 'bg-elevated text-ink-secondary border-line-strong',
      };
  }
}

function renderSimpleMarkdown(md: string): React.ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const formatInline = (text: string): React.ReactNode[] => {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 rounded-md bg-elevated border border-line font-mono text-[12px] text-accent"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return (
          <strong key={idx} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  lines.forEach((line, idx) => {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${idx}`}
            className="my-2.5 p-3.5 rounded-xl bg-canvas border border-line overflow-x-auto font-mono text-[12px] text-ink-secondary leading-relaxed"
          >
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<div key={`sp-${idx}`} className="h-2" />);
      return;
    }

    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1
          key={`h1-${idx}`}
          className="text-lg sm:text-xl font-bold text-ink tracking-tight pb-1.5 border-b border-line/70 mt-1"
        >
          {formatInline(trimmed.slice(2))}
        </h1>
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2
          key={`h2-${idx}`}
          className="text-[15px] sm:text-base font-semibold text-ink tracking-tight mt-3"
        >
          {formatInline(trimmed.slice(3))}
        </h2>
      );
      return;
    }

    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${idx}`} className="text-sm font-semibold text-ink mt-2">
          {formatInline(trimmed.slice(4))}
        </h3>
      );
      return;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div
          key={`li-${idx}`}
          className="flex items-start gap-2 text-[13.5px] text-ink-secondary leading-relaxed pl-1"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 shrink-0" />
          <span>{formatInline(trimmed.slice(2))}</span>
        </div>
      );
      return;
    }

    elements.push(
      <p key={`p-${idx}`} className="text-[13.5px] text-ink-secondary leading-relaxed">
        {formatInline(trimmed)}
      </p>
    );
  });

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre
        key="code-unclosed"
        className="my-2.5 p-3.5 rounded-xl bg-canvas border border-line overflow-x-auto font-mono text-[12px] text-ink-secondary"
      >
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
  }

  return <div className="space-y-1.5">{elements}</div>;
}

const TEMPLATES: Array<{
  id: 'typescript' | 'python_ai' | 'web_app' | 'blank';
  label: string;
  desc: string;
  badge: string;
}> = [
  {
    id: 'typescript',
    label: 'TypeScript Project',
    desc: 'src/index.ts, package.json, tsconfig.json & README.md',
    badge: 'TS',
  },
  {
    id: 'python_ai',
    label: 'Python AI Agent',
    desc: 'src/agent.py, requirements.txt & MCP README.md',
    badge: 'PY',
  },
  {
    id: 'web_app',
    label: 'Web App Starter',
    desc: 'index.html, src/styles.css, src/main.js & README.md',
    badge: 'WEB',
  },
  {
    id: 'blank',
    label: 'Minimal Repo',
    desc: 'Clean workspace initialized with README.md',
    badge: 'MD',
  },
];

export const RepoView: React.FC<RepoViewProps> = ({
  vault,
  authUser,
  isOffline,
  onRefreshVault,
  onOpenInFilesExplorer,
  onOpenFilePreview,
  onCreateFolderInVault,
  onShowToast,
}) => {
  const repos: RepoWorkspace[] = useMemo(
    () => (Array.isArray(vault.repos) ? vault.repos : []),
    [vault.repos]
  );

  const ownerHandle = useMemo(() => {
    if (authUser?.displayName) {
      return authUser.displayName.trim().replace(/\s+/g, '-').toLowerCase();
    }
    if (authUser?.email) {
      return authUser.email.split('@')[0].toLowerCase();
    }
    return 'cloudy-vault';
  }, [authUser]);

  const ownerInitial = useMemo(
    () => (authUser?.displayName || authUser?.email || 'C').charAt(0).toUpperCase(),
    [authUser]
  );

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [currentSubfolderId, setCurrentSubfolderId] = useState<string | null>(null);
  const [hubSearch, setHubSearch] = useState('');

  // Modals & Drawers
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newReadme, setNewReadme] = useState('');
  const [newBranch, setNewBranch] = useState('main');
  const [newTemplate, setNewTemplate] = useState<
    'typescript' | 'python_ai' | 'web_app' | 'blank'
  >('typescript');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Inside-Repo Interactive Panels
  const [codePanelOpen, setCodePanelOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [customBranchInput, setCustomBranchInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [roadmapExpanded, setRoadmapExpanded] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  // Commit Modal
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');

  // Quick New File / Folder inside Repo
  const [newFileModalOpen, setNewFileModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Inline File Code Editor
  const [editingFile, setEditingFile] = useState<FileItem | null>(null);
  const [editorText, setEditorText] = useState('');
  const [editorCommitMsg, setEditorCommitMsg] = useState('');

  // MCP Tools Guide Accordion on Hub
  const [mcpGuideOpen, setMcpGuideOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedRepo = useMemo(
    () => repos.find((r) => r.id === selectedRepoId) || null,
    [repos, selectedRepoId]
  );

  const activeFolderId = useMemo(() => {
    if (!selectedRepo) return null;
    return currentSubfolderId || selectedRepo.rootFolderId;
  }, [selectedRepo, currentSubfolderId]);

  // Breadcrumb trail inside selected repo
  const repoBreadcrumbs = useMemo(() => {
    if (!selectedRepo) return [];
    const byId = new Map(vault.folders.map((f) => [f.id, f]));
    const trail: FolderItem[] = [];
    let cur = activeFolderId ? byId.get(activeFolderId) : undefined;
    const guard = new Set<string>();
    while (cur && cur.id !== selectedRepo.rootFolderId && !guard.has(cur.id)) {
      guard.add(cur.id);
      trail.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return trail;
  }, [selectedRepo, activeFolderId, vault.folders]);

  const currentChildFolders = useMemo(() => {
    if (!selectedRepo || !activeFolderId) return [];
    return vault.folders
      .filter((f) => !f.trashed && f.parentId === activeFolderId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedRepo, activeFolderId, vault.folders]);

  const currentChildFiles = useMemo(() => {
    if (!selectedRepo || !activeFolderId) return [];
    return vault.files
      .filter((f) => !f.trashed && f.folderId === activeFolderId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedRepo, activeFolderId, vault.files]);

  const readmeFile = useMemo(() => {
    return (
      currentChildFiles.find((f) => f.name.toLowerCase() === 'readme.md') || null
    );
  }, [currentChildFiles]);

  const filteredRepos = useMemo(() => {
    const q = hubSearch.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.branch || '').toLowerCase().includes(q)
    );
  }, [repos, hubSearch]);

  const copySnippet = (id: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1800);
  };

  const handleOpenRepo = (repo: RepoWorkspace) => {
    setSelectedRepoId(repo.id);
    setCurrentSubfolderId(null);
    setCodePanelOpen(false);
    setHistoryOpen(false);
    setBranchMenuOpen(false);
  };

  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline) {
      setFormError('Go online to initialize a Cloud Pool repository.');
      return;
    }
    const clean = newName.trim();
    if (!clean) {
      setFormError('Repository name is required.');
      return;
    }
    setBusyAction('create_repo');
    setFormError(null);
    try {
      const res = await apiFetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clean,
          description: newDesc.trim(),
          readme: newReadme.trim(),
          branch: newBranch.trim() || 'main',
          template: newTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Could not create repository');
      }
      await onRefreshVault();
      setCreateModalOpen(false);
      setNewName('');
      setNewDesc('');
      setNewReadme('');
      setNewBranch('main');
      setSelectedRepoId(data.repo.id);
      setCurrentSubfolderId(null);
      onShowToast(`Created repo ${data.repo.name}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create repo');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCommitSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;
    const msg = commitMessage.trim() || `chore: snapshot v${(selectedRepo.currentVersion || 1) + 1}`;
    setBusyAction('commit');
    try {
      const res = await apiFetch(`/api/repos/${selectedRepo.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Commit failed');
      }
      await onRefreshVault();
      setCommitModalOpen(false);
      setCommitMessage('');
      onShowToast(`Committed ${data.commit.hash} (v${data.commit.version})`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCheckoutVersion = async (targetHashOrVersion: string) => {
    if (!selectedRepo || isOffline) return;
    setBusyAction(`checkout_${targetHashOrVersion}`);
    try {
      const res = await apiFetch(`/api/repos/${selectedRepo.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: targetHashOrVersion }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Checkout failed');
      }
      await onRefreshVault();
      setCurrentSubfolderId(null);
      onShowToast(
        `Restored ${selectedRepo.name} to ${data.restoredCommit.hash} (v${data.restoredCommit.version})`
      );
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSwitchOrRenameBranch = async (branchName: string) => {
    if (!selectedRepo || !branchName.trim()) return;
    const clean = branchName.trim().replace(/\s+/g, '-');
    setBranchMenuOpen(false);
    setCustomBranchInput('');
    try {
      const res = await apiFetch(`/api/repos/${selectedRepo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: clean }),
      });
      if (res.ok) {
        await onRefreshVault();
        onShowToast(`Switched branch label to ${clean}`);
      }
    } catch {
      // non-fatal
    }
  };

  const handleToggleTask = async (taskId: string) => {
    if (!selectedRepo) return;
    const nextTasks: RepoTask[] = (selectedRepo.tasks || []).map((t) =>
      t.id === taskId ? { ...t, done: !t.done } : t
    );
    try {
      await apiFetch(`/api/repos/${selectedRepo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: nextTasks }),
      });
      await onRefreshVault();
    } catch {
      // non-fatal
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !newTaskTitle.trim()) return;
    const nextTasks: RepoTask[] = [
      ...(selectedRepo.tasks || []),
      {
        id: `tsk_${Date.now().toString(36)}`,
        title: newTaskTitle.trim(),
        done: false,
      },
    ];
    setNewTaskTitle('');
    try {
      await apiFetch(`/api/repos/${selectedRepo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: nextTasks }),
      });
      await onRefreshVault();
    } catch {
      // non-fatal
    }
  };

  const handleDeleteRepo = async (repo: RepoWorkspace) => {
    if (isOffline) {
      onShowToast('Go online to delete a repository');
      return;
    }
    if (
      !window.confirm(
        `Delete repository "${repo.name}" and move its workspace files to Trash?`
      )
    ) {
      return;
    }
    setBusyAction(`del_${repo.id}`);
    try {
      const res = await apiFetch(`/api/repos/${repo.id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedRepoId === repo.id) {
          setSelectedRepoId(null);
          setCurrentSubfolderId(null);
        }
        await onRefreshVault();
        onShowToast(`Deleted repo ${repo.name}`);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const buildRelativePathForActiveFolder = (leafName: string): string => {
    const prefix = repoBreadcrumbs.map((b) => b.name).join('/');
    return prefix ? `${prefix}/${leafName}` : leafName;
  };

  const handleCreateRepoFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !newFileName.trim()) return;
    setBusyAction('create_file');
    try {
      const relPath = buildRelativePathForActiveFolder(newFileName.trim());
      const res = await apiFetch(`/api/repos/${selectedRepo.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `feat: add ${relPath}`,
          files: [{ path: relPath, content: newFileContent }],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to add file');
      }
      await onRefreshVault();
      setNewFileModalOpen(false);
      setNewFileName('');
      setNewFileContent('');
      onShowToast(`Added ${relPath} · commit ${data.commit.hash}`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Failed to create file');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateRepoSubfolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !activeFolderId || !newFolderName.trim()) return;
    setBusyAction('create_subfolder');
    try {
      await onCreateFolderInVault(newFolderName.trim(), activeFolderId);
      await onRefreshVault();
      setNewFolderModalOpen(false);
      setNewFolderName('');
    } finally {
      setBusyAction(null);
    }
  };

  const openInlineEditor = async (file: FileItem) => {
    if (typeof file.textContent === 'string') {
      setEditingFile(file);
      setEditorText(file.textContent);
      setEditorCommitMsg(`feat: update ${file.name}`);
      return;
    }
    try {
      const res = await apiFetch(`/api/files/${file.id}/content`);
      if (res.ok) {
        const text = await res.text();
        setEditingFile(file);
        setEditorText(text);
        setEditorCommitMsg(`feat: update ${file.name}`);
        return;
      }
    } catch {
      // fallback to standard preview modal
    }
    onOpenFilePreview(file);
  };

  const handleSaveAndCommitFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !editingFile) return;
    setBusyAction('save_commit_file');
    try {
      // Compute relative path from repo root
      const byId = new Map(vault.folders.map((f) => [f.id, f]));
      const segs: string[] = [];
      let cur = editingFile.folderId ? byId.get(editingFile.folderId) : undefined;
      const seen = new Set<string>();
      while (cur && cur.id !== selectedRepo.rootFolderId && !seen.has(cur.id)) {
        seen.add(cur.id);
        segs.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      const relPath = segs.length > 0 ? `${segs.join('/')}/${editingFile.name}` : editingFile.name;

      const res = await apiFetch(`/api/repos/${selectedRepo.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: editorCommitMsg.trim() || `feat: update ${editingFile.name}`,
          files: [{ path: relPath, content: editorText }],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to commit file changes');
      }
      await onRefreshVault();
      setEditingFile(null);
      onShowToast(`Committed ${data.commit.hash} · ${editingFile.name}`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Save & commit failed');
    } finally {
      setBusyAction(null);
    }
  };

  // Look up per-item commit message from itemCommitMeta or commit snapshots
  const resolveItemCommitMessage = (
    repo: RepoWorkspace,
    itemPathPrefix: string,
    isFolder: boolean
  ): string => {
    const directMeta = repo.itemCommitMeta?.[itemPathPrefix];
    if (directMeta?.message) return directMeta.message;

    const commits = repo.commits || [];
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      const nextOlder = commits[i + 1];
      if (!nextOlder) return c.message;
      const curMatches = (c.files || []).filter((s) =>
        isFolder ? s.path.startsWith(`${itemPathPrefix}/`) : s.path === itemPathPrefix
      );
      const prevMatches = (nextOlder.files || []).filter((s) =>
        isFolder ? s.path.startsWith(`${itemPathPrefix}/`) : s.path === itemPathPrefix
      );
      if (curMatches.length !== prevMatches.length) return c.message;
      const changed = curMatches.some((cm) => {
        const pm = prevMatches.find((p) => p.path === cm.path);
        return !pm || pm.textContent !== cm.textContent || pm.size !== cm.size;
      });
      if (changed) return c.message;
    }
    return repo.headCommitMessage || 'init: initial setup';
  };

  // ============================================================================
  // LEVEL 1: ALL REPO PROJECTS HUB (Shown before entering an individual repo)
  // ============================================================================
  if (!selectedRepo) {
    const totalCommits = repos.reduce((s, r) => s + (r.commits?.length || 0), 0);
    const totalRepoFiles = repos.reduce((s, r) => s + (r.filesCount || 0), 0);

    return (
      <div className="studio-container space-y-5">
        {/* Studio Hero Header */}
        <div className="studio-card p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent-soft border border-accent/25 text-[11px] font-semibold text-accent">
              <GitBranch className="w-3.5 h-3.5" />
              <span>Cloud-Pooled Repositories · wpc</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">
              All Repo Projects
            </h1>
            <p className="text-xs sm:text-[13.5px] text-ink-secondary max-w-2xl leading-relaxed">
              Versioned project workspaces stored directly inside your connected Cloud Pool (
              <code className="font-mono text-ink text-[12px]">/Repos/&lt;Project&gt;</code>
              ) with instant snapshots, 1-click rollbacks, and native MCP agent tools.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setMcpGuideOpen((v) => !v)}
              className="px-3.5 py-2.5 rounded-xl bg-elevated hover:bg-surface border border-line-strong text-xs font-medium text-ink inline-flex items-center gap-1.5 transition-colors"
            >
              <Terminal className="w-3.5 h-3.5 text-accent" />
              <span>wpc Tools (5)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setCreateModalOpen(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs sm:text-[13px] font-semibold shadow-card inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Repo</span>
            </button>
          </div>
        </div>

        {/* Collapsible 5 MCP Workspace Tool Calls Reference */}
        <AnimatePresence>
          {mcpGuideOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="studio-card p-4 sm:p-5 space-y-3 border-accent/35"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <span>Cloudy MCP Workspace (wpc) Tool Calls</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMcpGuideOpen(false)}
                  className="p-1 rounded-lg text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {[
                  {
                    name: 'list_tools',
                    tier: 'Normal+',
                    desc: 'Fetches available Cloudy tools at session start to confirm storage permission.',
                  },
                  {
                    name: 'create_wpc',
                    tier: 'Medium+',
                    desc: 'Initializes a new workspace & physical /Repos folder structure in your Cloud Pool.',
                  },
                  {
                    name: 'commit',
                    tier: 'Medium+',
                    desc: 'Saves the current sandbox/workspace state to Cloudy as a versioned snapshot.',
                  },
                  {
                    name: 'checkout',
                    tier: 'Medium+',
                    desc: 'Restores a previous workspace snapshot back into the vault to rollback changes.',
                  },
                  {
                    name: 'list_wpc',
                    tier: 'Normal+',
                    desc: 'Lists all workspaces and their active versions in your Cloudy storage.',
                  },
                ].map((tool) => (
                  <div
                    key={tool.name}
                    className="p-3 rounded-xl bg-canvas/85 border border-line space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <code className="font-mono text-xs font-semibold text-accent">
                        {tool.name}
                      </code>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-elevated text-ink-muted">
                        {tool.tier}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-ink-secondary leading-snug">
                      {tool.desc}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={hubSearch}
              onChange={(e) => setHubSearch(e.target.value)}
              placeholder="Find a repo project..."
              className="w-full pl-10 pr-8 py-2 rounded-xl bg-surface border border-line focus:border-accent/60 focus:outline-none text-xs sm:text-[13px] text-ink placeholder:text-ink-muted"
            />
            {hubSearch && (
              <button
                type="button"
                onClick={() => setHubSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-ink-secondary overflow-x-auto no-scrollbar">
            <span className="px-3 py-1.5 rounded-xl bg-surface border border-line whitespace-nowrap">
              <strong className="text-ink font-semibold">{repos.length}</strong>{' '}
              {repos.length === 1 ? 'project' : 'projects'}
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-surface border border-line whitespace-nowrap">
              <strong className="text-ink font-semibold">{totalCommits}</strong>{' '}
              {totalCommits === 1 ? 'commit' : 'commits'}
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-surface border border-line whitespace-nowrap">
              <strong className="text-ink font-semibold">{totalRepoFiles}</strong> pooled files
            </span>
          </div>
        </div>

        {/* All Repo Projects Grid */}
        {filteredRepos.length === 0 ? (
          <div className="studio-card p-8 sm:p-10 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-accent-soft border border-accent/30 text-accent flex items-center justify-center mx-auto">
              <GitBranch className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h2 className="text-base sm:text-lg font-semibold text-ink">
                {repos.length === 0
                  ? 'Create your first Cloudy Repo project'
                  : 'No matching repo projects'}
              </h2>
              <p className="text-xs sm:text-[13px] text-ink-secondary leading-relaxed">
                {repos.length === 0
                  ? 'Initialize a GitHub-style project workspace backed by your Cloud Pool, or let any connected AI agent call create_wpc via MCP.'
                  : 'Try clearing your search filter or create a new repository workspace.'}
              </p>
            </div>
            {repos.length === 0 && (
              <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs sm:text-[13px] font-semibold shadow-card inline-flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create First Repo</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredRepos.map((repo) => {
              const tasks = repo.tasks || [];
              const doneTasks = tasks.filter((t) => t.done).length;
              const taskPct =
                tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;

              return (
                <motion.div
                  key={repo.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => handleOpenRepo(repo)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenRepo(repo);
                    }
                  }}
                  className="studio-card studio-card-interactive p-4 sm:p-5 flex flex-col justify-between gap-3.5 cursor-pointer group"
                >
                  <div className="space-y-2.5">
                    {/* Title Row (Strictly NO Public/Private badge) */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-accent-soft border border-accent/25 text-accent flex items-center justify-center shrink-0">
                          <GitBranch className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14.5px] sm:text-[15px] font-semibold text-ink truncate group-hover:text-accent transition-colors">
                            <span className="text-ink-muted font-normal">
                              {ownerHandle} /{' '}
                            </span>
                            <span>{repo.name}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-ink-muted font-mono">
                            <span>{repo.branch || 'main'}</span>
                            <span>•</span>
                            <span>v{repo.currentVersion || 1}</span>
                            {repo.headCommitHash && (
                              <>
                                <span>•</span>
                                <span className="text-accent">{repo.headCommitHash}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRepo(repo);
                          }}
                          title="Delete repository"
                          className="p-1.5 rounded-lg text-ink-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-ink-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>

                    {repo.description && (
                      <p className="text-xs sm:text-[13px] text-ink-secondary line-clamp-2 leading-relaxed">
                        {repo.description}
                      </p>
                    )}

                    {/* Latest Commit Strip */}
                    <div className="px-3 py-2 rounded-xl bg-canvas/80 border border-line flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <GitCommit className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span className="text-ink-secondary truncate">
                          {repo.headCommitMessage || 'chore: initial workspace snapshot'}
                        </span>
                      </div>
                      <span className="text-[11px] text-ink-muted shrink-0">
                        {formatShortAgo(repo.updatedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Footer Metadata + Mini Roadmap Bar */}
                  <div className="pt-2 border-t border-line/70 flex items-center justify-between gap-3 text-[11.5px] text-ink-muted">
                    <div className="flex items-center gap-3">
                      <span>{repo.foldersCount ?? 0} folders</span>
                      <span>•</span>
                      <span>{repo.filesCount ?? 0} files</span>
                      <span>•</span>
                      <span>{formatBytes(repo.totalBytes || 0)}</span>
                    </div>

                    {tasks.length > 0 && (
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="w-14 h-1.5 rounded-full bg-elevated overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${Math.max(8, taskPct)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[10.5px]">
                          {doneTasks}/{tasks.length}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Create New Repo Modal (Strictly NO Visibility field) */}
        <AnimatePresence>
          {createModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm p-4 flex items-center justify-center"
              onClick={() => setCreateModalOpen(false)}
            >
              <motion.form
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleCreateRepo}
                className="w-full max-w-lg rounded-2xl bg-surface border border-line-strong shadow-float p-5 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-accent-soft border border-accent/30 text-accent flex items-center justify-center">
                      <GitBranch className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-ink">
                        New Cloud Repository
                      </h2>
                      <p className="text-[11.5px] text-ink-muted">
                        Creates <code className="font-mono">/Repos/&lt;name&gt;</code> in your
                        Cloud Pool
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="p-1.5 rounded-lg text-ink-muted hover:text-ink"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {formError && (
                  <div className="px-3.5 py-2.5 rounded-xl bg-red-500/12 border border-red-500/30 text-xs text-red-300">
                    {formError}
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-ink-secondary mb-1">
                      Repository Name
                    </label>
                    <div className="flex items-center rounded-xl bg-canvas border border-line focus-within:border-accent/60 overflow-hidden">
                      <span className="px-3 py-2.5 text-xs text-ink-muted bg-elevated/60 border-r border-line font-mono shrink-0">
                        {ownerHandle} /
                      </span>
                      <input
                        type="text"
                        required
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Cloudy-Core"
                        className="w-full px-3 py-2.5 bg-transparent text-sm text-ink focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-ink-secondary mb-1">
                        Description <span className="text-ink-muted">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={newDesc}
                        onChange={(e) => setNewDesc(e.target.value)}
                        placeholder="Core sync engine & local AI skills"
                        className="w-full px-3 py-2 rounded-xl bg-canvas border border-line focus:border-accent/60 text-xs sm:text-sm text-ink focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-secondary mb-1">
                        Default Branch
                      </label>
                      <input
                        type="text"
                        value={newBranch}
                        onChange={(e) => setNewBranch(e.target.value)}
                        placeholder="main"
                        className="w-full px-3 py-2 rounded-xl bg-canvas border border-line focus:border-accent/60 text-xs sm:text-sm font-mono text-ink focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-ink-secondary mb-1">
                      README.md <span className="text-ink-muted">(optional — auto-generated if blank)</span>
                    </label>
                    <textarea
                      rows={3}
                      value={newReadme}
                      onChange={(e) => setNewReadme(e.target.value)}
                      placeholder={`# ${newName.trim() || 'Cloudy-Core'}\n\nOverview, setup steps, and architecture notes...`}
                      className="w-full px-3 py-2 rounded-xl bg-canvas border border-line focus:border-accent/60 text-xs font-mono text-ink focus:outline-none resize-y"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                      Starter Structure
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {TEMPLATES.map((tpl) => {
                        const active = newTemplate === tpl.id;
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => setNewTemplate(tpl.id)}
                            className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                              active
                                ? 'bg-accent-soft border-accent/60 shadow-card'
                                : 'bg-canvas/75 border-line hover:border-line-strong'
                            }`}
                          >
                            <span className="px-2 py-1 rounded-lg bg-elevated border border-line text-[10px] font-mono font-bold text-accent shrink-0">
                              {tpl.badge}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-ink truncate">
                                {tpl.label}
                              </div>
                              <div className="text-[11px] text-ink-muted leading-snug line-clamp-2">
                                {tpl.desc}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-elevated hover:bg-canvas border border-line text-xs font-medium text-ink-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busyAction === 'create_repo'}
                    className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-60 text-white text-xs font-semibold shadow-card inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      {busyAction === 'create_repo' ? 'Initializing…' : 'Create Repo'}
                    </span>
                  </button>
                </div>
              </motion.form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ============================================================================
  // LEVEL 2: INSIDE A REPOSITORY WORKSPACE (GitHub-Style Studio Layout)
  // ============================================================================
  const headCommit = selectedRepo.commits?.[0] || null;
  const tasks = selectedRepo.tasks || [];
  const completedTasks = tasks.filter((t) => t.done).length;
  const taskProgressPct =
    tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;

  return (
    <div className="studio-container max-w-4xl space-y-4">
      {/* Top Bar: Back to All Repos + owner / Repo-Name (Strictly NO Visibility badge!) */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => {
              setSelectedRepoId(null);
              setCurrentSubfolderId(null);
            }}
            className="p-2 rounded-xl bg-surface hover:bg-elevated border border-line text-ink-secondary hover:text-ink transition-colors shrink-0"
            title="Back to All Repo Projects"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-4 h-4 text-ink-muted shrink-0 hidden sm:block" />
            <h1 className="text-[16px] sm:text-[19px] tracking-tight truncate">
              <span className="text-ink-secondary font-medium">{ownerHandle}</span>
              <span className="text-ink-muted mx-1.5">/</span>
              <span className="text-ink font-bold">{selectedRepo.name}</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setCommitMessage('');
              setCommitModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-full bg-surface hover:bg-elevated border border-line-strong text-xs font-medium text-ink inline-flex items-center gap-1.5 transition-colors"
            title="Save a new versioned commit snapshot"
          >
            <GitCommit className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline">Commit</span>
            <span className="font-mono text-[11px] text-ink-muted">
              v{selectedRepo.currentVersion || 1}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className={`p-2 rounded-full border text-xs transition-colors ${
              historyOpen
                ? 'bg-accent-soft border-accent/50 text-accent'
                : 'bg-surface hover:bg-elevated border-line text-ink-secondary hover:text-ink'
            }`}
            title="Commit history & Checkout rollback"
          >
            <History className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Action Row: Branch Dropdown Pill on Left + Warm `<> Code` Pill on Right */}
      <div className="flex items-center justify-between gap-2.5 relative">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {/* Branch Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setBranchMenuOpen((v) => !v)}
              className="px-3.5 py-2 rounded-full bg-surface hover:bg-elevated border border-line-strong text-xs sm:text-[13px] font-medium text-ink inline-flex items-center gap-2 transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5 text-ink-secondary" />
              <span>{selectedRepo.branch || 'main'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-ink-muted" />
            </button>

            <AnimatePresence>
              {branchMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute left-0 mt-2 w-56 rounded-2xl bg-surface border border-line-strong shadow-float p-2.5 z-30 space-y-2"
                >
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                    Switch Branch Label
                  </div>
                  {['main', 'dev', 'staging'].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => handleSwitchOrRenameBranch(b)}
                      className="w-full px-2.5 py-1.5 rounded-xl hover:bg-elevated text-xs text-ink flex items-center justify-between"
                    >
                      <span className="font-mono">{b}</span>
                      {(selectedRepo.branch || 'main') === b && (
                        <Check className="w-3.5 h-3.5 text-accent" />
                      )}
                    </button>
                  ))}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSwitchOrRenameBranch(customBranchInput);
                    }}
                    className="pt-1 border-t border-line flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      value={customBranchInput}
                      onChange={(e) => setCustomBranchInput(e.target.value)}
                      placeholder="Custom branch..."
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-xs font-mono text-ink focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold"
                    >
                      Set
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Subfolder Breadcrumb Pill when inside nested folder */}
          {repoBreadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface border border-line text-xs overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setCurrentSubfolderId(null)}
                className="text-accent hover:underline font-medium shrink-0"
              >
                {selectedRepo.name}
              </button>
              {repoBreadcrumbs.map((crumb) => (
                <React.Fragment key={crumb.id}>
                  <span className="text-ink-muted">/</span>
                  <button
                    type="button"
                    onClick={() => setCurrentSubfolderId(crumb.id)}
                    className="text-ink font-medium truncate max-w-[120px]"
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Warm Accent `<> Code` Button */}
        <button
          type="button"
          onClick={() => setCodePanelOpen((v) => !v)}
          className="px-4 py-2 rounded-full bg-accent hover:bg-accent-hover text-white text-xs sm:text-[13px] font-semibold shadow-card inline-flex items-center gap-1.5 shrink-0 transition-colors"
        >
          <Code2 className="w-4 h-4" />
          <span>Code</span>
        </button>
      </div>

      {/* Expandable `<> Code` & Workspace Actions Drawer */}
      <AnimatePresence>
        {codePanelOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="studio-card p-4 sm:p-5 space-y-3.5 border-accent/45"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-ink flex items-center gap-2">
                <Code2 className="w-4 h-4 text-accent" />
                <span>Workspace Actions & MCP Coordinates</span>
              </div>
              <button
                type="button"
                onClick={() => setCodePanelOpen(false)}
                className="p-1 rounded-lg text-ink-muted hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick File / Folder / Explorer Actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => {
                  setCodePanelOpen(false);
                  setNewFileModalOpen(true);
                }}
                className="p-2.5 rounded-xl bg-canvas hover:bg-elevated border border-line text-xs font-medium text-ink flex items-center justify-center gap-1.5 transition-colors"
              >
                <FilePlus2 className="w-3.5 h-3.5 text-accent" />
                <span>New File</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCodePanelOpen(false);
                  setNewFolderModalOpen(true);
                }}
                className="p-2.5 rounded-xl bg-canvas hover:bg-elevated border border-line text-xs font-medium text-ink flex items-center justify-center gap-1.5 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5 text-accent" />
                <span>New Folder</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCodePanelOpen(false);
                  setCommitModalOpen(true);
                }}
                className="p-2.5 rounded-xl bg-canvas hover:bg-elevated border border-line text-xs font-medium text-ink flex items-center justify-center gap-1.5 transition-colors"
              >
                <GitCommit className="w-3.5 h-3.5 text-accent" />
                <span>Snapshot</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenInFilesExplorer(activeFolderId)}
                className="p-2.5 rounded-xl bg-canvas hover:bg-elevated border border-line text-xs font-medium text-ink flex items-center justify-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-accent" />
                <span>Open in Files</span>
              </button>
            </div>

            {/* Copyable Workspace ID & MCP Commit Snippet */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-canvas border border-line flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-muted font-semibold">
                    Workspace ID (wpcId)
                  </div>
                  <code className="text-xs font-mono text-ink truncate block">
                    {selectedRepo.id}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => copySnippet('wpcId', selectedRepo.id)}
                  className="px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-surface border border-line text-xs text-ink inline-flex items-center gap-1 shrink-0"
                >
                  {copiedId === 'wpcId' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedId === 'wpcId' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <div className="p-3 rounded-xl bg-canvas border border-line flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-muted font-semibold">
                    MCP Commit Payload
                  </div>
                  <code className="text-xs font-mono text-ink-secondary truncate block">
                    {`commit({ wpcId: "${selectedRepo.slug}", message: "..." })`}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copySnippet(
                      'mcpCommit',
                      JSON.stringify(
                        {
                          tool: 'commit',
                          arguments: {
                            wpcId: selectedRepo.id,
                            message: 'feat: save workspace build',
                          },
                        },
                        null,
                        2
                      )
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-surface border border-line text-xs text-ink inline-flex items-center gap-1 shrink-0"
                >
                  {copiedId === 'mcpCommit' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedId === 'mcpCommit' ? 'Copied' : 'JSON'}</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Latest Commit Banner Card (Matching Mockup!) */}
      <div
        onClick={() => setHistoryOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setHistoryOpen((v) => !v);
          }
        }}
        className="studio-card px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer hover:border-line-strong transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center shrink-0">
            {ownerInitial}
          </div>
          <span className="text-[13.5px] font-medium text-ink truncate">
            {headCommit?.message ||
              selectedRepo.headCommitMessage ||
              'chore: initial workspace snapshot'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-ink-muted shrink-0 font-mono">
          <span className="text-ink-secondary">
            {headCommit?.hash || selectedRepo.headCommitHash || 'init001'}
          </span>
          <span className="font-sans">
            {formatShortAgo(headCommit?.createdAt || selectedRepo.updatedAt)}
          </span>
        </div>
      </div>

      {/* Expandable Commit History & 1-Click `Checkout` Rollback Drawer */}
      <AnimatePresence>
        {historyOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="studio-card p-4 space-y-3 border-accent/35"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-ink flex items-center gap-2">
                <History className="w-4 h-4 text-accent" />
                <span>
                  Version Snapshots ({selectedRepo.commits?.length || 0}) · 1-Click
                  Checkout Rollback
                </span>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="p-1 rounded-lg text-ink-muted hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-line rounded-xl border border-line bg-canvas/70 overflow-hidden max-h-64 overflow-y-auto">
              {(selectedRepo.commits || []).map((c, idx) => (
                <div
                  key={`${c.hash}-${c.version}`}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-elevated border border-line font-mono text-[10.5px] text-accent font-semibold">
                        v{c.version} · {c.hash}
                      </span>
                      {idx === 0 && (
                        <span className="text-[10px] font-semibold text-emerald-400">
                          HEAD
                        </span>
                      )}
                      <span className="text-ink font-medium truncate">{c.message}</span>
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {c.author} • {c.filesCount} files • {formatShortAgo(c.createdAt)}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busyAction === `checkout_${c.hash}`}
                    onClick={() => handleCheckoutVersion(c.hash)}
                    className="px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-accent hover:text-white border border-line-strong text-[11.5px] font-medium text-ink inline-flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>
                      {busyAction === `checkout_${c.hash}` ? 'Restoring…' : 'Checkout'}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Outlined `Projects` / Roadmap Card (Matching Mockup!) */}
      <div className="rounded-2xl border border-accent/45 bg-accent/[0.04] p-4 space-y-3 transition-colors">
        <div
          onClick={() => setRoadmapExpanded((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setRoadmapExpanded((v) => !v);
            }
          }}
          className="flex items-center justify-between gap-2 cursor-pointer"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <LayoutGrid className="w-4 h-4 text-accent" />
            <span>Projects</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <span>
              {selectedRepo.roadmapTitle || 'v1.0 Roadmap'} • {tasks.length}{' '}
              {tasks.length === 1 ? 'task' : 'tasks'}
            </span>
            <ChevronRight
              className={`w-3.5 h-3.5 text-ink-muted transition-transform ${
                roadmapExpanded ? 'rotate-90' : ''
              }`}
            />
          </div>
        </div>

        {/* Warm Progress Bar */}
        <div className="h-1.5 rounded-full bg-surface/90 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${tasks.length > 0 ? Math.max(6, taskProgressPct) : 0}%` }}
          />
        </div>

        <AnimatePresence>
          {roadmapExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="pt-1 space-y-2 overflow-hidden"
            >
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => handleToggleTask(task.id)}
                  className="w-full px-3 py-2 rounded-xl bg-surface/80 hover:bg-surface border border-line text-left flex items-center gap-2.5 text-xs transition-colors"
                >
                  {task.done ? (
                    <CheckSquare className="w-4 h-4 text-accent shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-ink-muted shrink-0" />
                  )}
                  <span
                    className={
                      task.done ? 'line-through text-ink-muted' : 'text-ink font-medium'
                    }
                  >
                    {task.title}
                  </span>
                </button>
              ))}

              <form onSubmit={handleAddTask} className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Add roadmap task..."
                  className="flex-1 px-3 py-1.5 rounded-xl bg-surface border border-line text-xs text-ink focus:outline-none focus:border-accent/60"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold"
                >
                  Add
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Grouped FOLDERS Section (Matching Mockup!) */}
      {currentChildFolders.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
            Folders
          </div>
          <div className="studio-card divide-y divide-line overflow-hidden">
            {currentChildFolders.map((folder) => {
              const relFolderPath = buildRelativePathForActiveFolder(folder.name);
              const folderCommitMsg = resolveItemCommitMessage(
                selectedRepo,
                relFolderPath,
                true
              );
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setCurrentSubfolderId(folder.id)}
                  className="w-full px-4 py-3.5 hover:bg-elevated/55 flex items-center justify-between gap-3 text-left transition-colors group"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 text-accent flex items-center justify-center shrink-0">
                      <Folder className="w-5 h-5 fill-current/20" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-semibold text-ink truncate group-hover:text-accent transition-colors">
                        {folder.name}
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        commit: {folderCommitMsg}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-ink-muted shrink-0">
                    <span>{formatShortAgo(folder.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Grouped FILES Section (Matching Mockup!) */}
      <div className="space-y-2 pt-1">
        <div className="px-1 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
            Files
          </span>
          <button
            type="button"
            onClick={() => setNewFileModalOpen(true)}
            className="text-[11.5px] font-medium text-accent hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            <span>Add file</span>
          </button>
        </div>

        {currentChildFiles.length === 0 ? (
          <div className="studio-card p-6 text-center text-xs text-ink-muted">
            No files in this directory yet. Tap <strong>Add file</strong> or use{' '}
            <code className="font-mono text-accent">commit</code> via MCP to push files.
          </div>
        ) : (
          <div className="studio-card divide-y divide-line overflow-hidden">
            {currentChildFiles.map((file) => {
              const badge = getFileBadgeInfo(file.name);
              const relFilePath = buildRelativePathForActiveFolder(file.name);
              const fileCommitMsg = resolveItemCommitMessage(
                selectedRepo,
                relFilePath,
                false
              );
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => openInlineEditor(file)}
                  className="w-full px-4 py-3.5 hover:bg-elevated/55 flex items-center justify-between gap-3 text-left transition-colors group"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl border text-[11px] font-mono font-bold flex items-center justify-center shrink-0 ${badge.className}`}
                    >
                      {badge.label}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-semibold text-ink truncate group-hover:text-accent transition-colors">
                        {file.name}
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        commit: {fileCommitMsg}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-ink-muted shrink-0 whitespace-nowrap">
                    {formatBytes(file.size || 0)} | {formatShortAgo(file.updatedAt)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline README.md Preview Card at Bottom (Matching Mockup!) */}
      {readmeFile && typeof readmeFile.textContent === 'string' && (
        <div className="studio-card overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2 bg-elevated/35">
            <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-ink uppercase">
              <BookOpen className="w-4 h-4 text-accent" />
              <span>README.md</span>
            </div>
            <button
              type="button"
              onClick={() => openInlineEditor(readmeFile)}
              className="text-xs font-medium text-accent hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="p-4 sm:p-6">{renderSimpleMarkdown(readmeFile.textContent)}</div>
        </div>
      )}

      {/* Commit Snapshot Modal */}
      <AnimatePresence>
        {commitModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm p-4 flex items-center justify-center"
            onClick={() => setCommitModalOpen(false)}
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleCommitSnapshot}
              className="w-full max-w-md rounded-2xl bg-surface border border-line-strong shadow-float p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <GitCommit className="w-4 h-4 text-accent" />
                  <span>Commit Workspace Snapshot</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setCommitModalOpen(false)}
                  className="p-1 text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-ink-secondary leading-relaxed">
                Saves the current state of <strong>{selectedRepo.name}</strong> into
                Cloudy as versioned snapshot{' '}
                <code className="font-mono text-accent">
                  v{(selectedRepo.currentVersion || 1) + 1}
                </code>
                .
              </p>
              <input
                type="text"
                required
                autoFocus
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="feat: implement new sync logic"
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line focus:border-accent/60 text-sm text-ink focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCommitModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl bg-elevated border border-line text-xs font-medium text-ink-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'commit'}
                  className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold"
                >
                  {busyAction === 'commit' ? 'Committing…' : 'Commit Snapshot'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New File Modal inside Repo */}
      <AnimatePresence>
        {newFileModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm p-4 flex items-center justify-center"
            onClick={() => setNewFileModalOpen(false)}
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleCreateRepoFile}
              className="w-full max-w-lg rounded-2xl bg-surface border border-line-strong shadow-float p-5 space-y-3.5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <FilePlus2 className="w-4 h-4 text-accent" />
                  <span>Add File & Commit</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setNewFileModalOpen(false)}
                  className="p-1 text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                required
                autoFocus
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="src/helper.ts or notes.md"
                className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line focus:border-accent/60 text-sm font-mono text-ink focus:outline-none"
              />
              <textarea
                rows={8}
                value={newFileContent}
                onChange={(e) => setNewFileContent(e.target.value)}
                placeholder="// Write file contents..."
                className="w-full p-3.5 rounded-xl bg-canvas border border-line focus:border-accent/60 text-xs font-mono text-ink focus:outline-none resize-y"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewFileModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl bg-elevated border border-line text-xs font-medium text-ink-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'create_file'}
                  className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold"
                >
                  {busyAction === 'create_file' ? 'Saving…' : 'Create & Commit'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Subfolder Modal inside Repo */}
      <AnimatePresence>
        {newFolderModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm p-4 flex items-center justify-center"
            onClick={() => setNewFolderModalOpen(false)}
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleCreateRepoSubfolder}
              className="w-full max-w-sm rounded-2xl bg-surface border border-line-strong shadow-float p-5 space-y-3.5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <FolderPlus className="w-4 h-4 text-accent" />
                  <span>New Repo Folder</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setNewFolderModalOpen(false)}
                  className="p-1 text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                required
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="components"
                className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line focus:border-accent/60 text-sm text-ink focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewFolderModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl bg-elevated border border-line text-xs font-medium text-ink-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'create_subfolder'}
                  className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold"
                >
                  Create Folder
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline Code Viewer & Save-and-Commit Modal */}
      <AnimatePresence>
        {editingFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center"
            onClick={() => setEditingFile(null)}
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleSaveAndCommitFile}
              className="w-full max-w-3xl rounded-2xl bg-surface border border-line-strong shadow-float flex flex-col max-h-[88dvh] overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2 bg-elevated/40">
                <div className="flex items-center gap-2 min-w-0">
                  <Code2 className="w-4 h-4 text-accent shrink-0" />
                  <span className="text-sm font-semibold text-ink font-mono truncate">
                    {editingFile.name}
                  </span>
                  <span className="text-[11px] text-ink-muted shrink-0">
                    ({formatBytes(editorText.length)})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const target = editingFile;
                      setEditingFile(null);
                      onOpenFilePreview(target);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-canvas hover:bg-elevated border border-line text-[11px] text-ink-secondary"
                  >
                    File Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingFile(null)}
                    className="p-1 text-ink-muted hover:text-ink"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <textarea
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                spellCheck={false}
                className="flex-1 min-h-[280px] p-4 bg-canvas font-mono text-xs sm:text-[13px] text-ink leading-relaxed focus:outline-none resize-none"
              />

              <div className="p-3.5 border-t border-line bg-surface flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <input
                  type="text"
                  value={editorCommitMsg}
                  onChange={(e) => setEditorCommitMsg(e.target.value)}
                  placeholder={`feat: update ${editingFile.name}`}
                  className="flex-1 px-3 py-2 rounded-xl bg-canvas border border-line text-xs text-ink focus:outline-none focus:border-accent/60"
                />
                <button
                  type="submit"
                  disabled={busyAction === 'save_commit_file'}
                  className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>
                    {busyAction === 'save_commit_file'
                      ? 'Committing…'
                      : 'Save & Commit'}
                  </span>
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
