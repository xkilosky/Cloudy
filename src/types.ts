export type AllocationRule = 'most_free' | 'waterfall' | 'by_type' | 'mirror';

export interface ProviderCatalogItem {
  id: string;
  name: string;
  freeBytes: number;
  freeLabel: string;
  color: string;
  accentBg: string;
  authType: string;
  signupUrl: string;
  authorizeUrl: string;
  scopes: string[];
  category: string;
  badge: string;
  description: string;
  liveOAuthConfigured?: boolean;
}

export interface StorageAccount {
  id: string;
  providerId: string;
  providerName: string;
  accountLabel: string;
  email: string;
  quotaBytes: number;
  usedBytes: number;
  color: string;
  connectionMode: string;
  oneTimeOAuth: boolean;
  hasRefreshToken?: boolean;
  status: string;
  connectedAt: string;
  lastSyncedAt: string;
}

export interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
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
