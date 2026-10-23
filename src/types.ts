export type AllocationRule = 'most_free' | 'waterfall' | 'by_type' | 'mirror';

export type ProviderAuthMode =
  | 'oauth2'
  | 'mega'
  | 's3'
  | 'webdav'
  | 'github'
  | 'supabase'
  | 'builtin';

export interface ProviderCatalogItem {
  id: string;
  name: string;
  freeBytes: number;
  freeLabel: string;
  authMode: ProviderAuthMode;
  signupUrl: string;
  consoleUrl?: string;
  authorizeUrl?: string;
  defaultEndpoint?: string;
  defaultWebdavUrl?: string;
  scopes: string[];
  description: string;
  oauthConfigured?: boolean;
}

export interface StorageAccount {
  id: string;
  providerId: string;
  providerName: string;
  accountLabel: string;
  email: string;
  quotaBytes: number;
  usedBytes: number;
  baseExternalUsedBytes?: number;
  sealedCredentials?: string | null;
  connectionMode: string;
  status: string;
  connectedAt: string;
  lastSyncedAt: string;
}

export interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
  offlinePinned: boolean;
  starred: boolean;
  trashed: boolean;
  pendingOfflineSync?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FileItem {
  id: string;
  name: string;
  folderId: string | null;
  mimeType: string;
  kind: 'file' | 'note' | 'dataset';
  size: number;
  accountId: string;
  providerId: string;
  providerName: string;
  remoteId?: string | null;
  remotePath?: string | null;
  webUrl?: string | null;
  importedRemote?: boolean;
  mirrorAccountId: string | null;
  offlinePinned: boolean;
  offlineCached?: boolean;
  pendingOfflineSync?: boolean;
  starred: boolean;
  trashed: boolean;
  tags: string[];
  textContent?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiApiKey {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  scope: 'read' | 'read_write';
  allowedFolderIds: string[];
  active: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AiAuditEntry {
  id: string;
  keyId: string;
  keyName: string;
  method: string;
  endpoint: string;
  status: number;
  timestamp: string;
}

export interface VaultState {
  vaultId?: string;
  settings: {
    allocationRule: AllocationRule;
    autoOfflineSync: boolean;
  };
  summary: {
    totalQuotaBytes: number;
    totalUsedBytes: number;
    connectedProvidersCount: number;
    maxCatalogFreeBytes: number;
  };
  providersCatalog: ProviderCatalogItem[];
  accounts: StorageAccount[];
  folders: FolderItem[];
  files: FileItem[];
  apiKeys: AiApiKey[];
  aiAuditLog: AiAuditEntry[];
}

export interface SyncQueueAction {
  id: string;
  type: 'create_folder' | 'create_note' | 'update_file' | 'upload_file';
  payload: Record<string, unknown>;
  blob?: Blob;
  createdAt: string;
}
