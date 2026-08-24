export interface ShellPreset {
  id: string;
  name: string;
  shellPath?: string;
  cwd?: string;
  args?: string[];
  isDefault?: boolean;
  visibleInMenu?: boolean;
  group?: string;
  favorite?: boolean;
}

export interface RemoteServerConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  remotePath?: string;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime?: number;
}

export interface ShellLink {
  id: string;
  name: string;
  type: 'local-shell' | 'directory' | 'remote' | 'command';
  target: string;
  shellPath?: string;
  args?: string[];
  visibleInMenu?: boolean;
  remote?: RemoteServerConfig;
  group?: string;
  favorite?: boolean;
  cwd?: string;
}

export interface AvailableShell {
  label: string;
  path: string;
}

export interface ShellState {
  defaultShell?: string;
  presets: ShellPreset[];
  links: ShellLink[];
}

export const DEFAULT_SHELL_STATE: ShellState = {
  defaultShell: undefined,
  presets: [],
  links: [],
}

function normalizePreset(input: unknown): ShellPreset | null {
  if (!input || typeof input !== 'object') return null
  const preset = input as Partial<ShellPreset>
  if (typeof preset.id !== 'string' || typeof preset.name !== 'string') return null
  return {
    id: preset.id,
    name: preset.name,
    shellPath: typeof preset.shellPath === 'string' ? preset.shellPath : undefined,
    cwd: typeof preset.cwd === 'string' ? preset.cwd : undefined,
    args: Array.isArray(preset.args) ? preset.args.filter((item): item is string => typeof item === 'string') : undefined,
    isDefault: preset.isDefault,
    visibleInMenu: preset.visibleInMenu !== false,
    group: typeof preset.group === 'string' ? preset.group.trim() || undefined : undefined,
    favorite: preset.favorite === true,
  }
}

function normalizeLink(input: unknown): ShellLink | null {
  if (!input || typeof input !== 'object') return null
  const link = input as Partial<ShellLink> & { remote?: Partial<RemoteServerConfig> }
  if (typeof link.id !== 'string' || typeof link.name !== 'string' || typeof link.type !== 'string') return null
  const remote = link.remote && typeof link.remote === 'object' ? link.remote : undefined
  return {
    id: link.id,
    name: link.name,
    type: link.type,
    target: typeof link.target === 'string' ? link.target : '',
    shellPath: typeof link.shellPath === 'string' ? link.shellPath : undefined,
    args: Array.isArray(link.args) ? link.args.filter((item): item is string => typeof item === 'string') : undefined,
    visibleInMenu: link.visibleInMenu !== false,
    remote: remote ? {
      host: typeof remote.host === 'string' ? remote.host : '',
      port: remote.port,
      username: typeof remote.username === 'string' ? remote.username : undefined,
      password: typeof remote.password === 'string' ? remote.password : undefined,
      privateKeyPath: typeof remote.privateKeyPath === 'string' ? remote.privateKeyPath : undefined,
      remotePath: typeof remote.remotePath === 'string' ? remote.remotePath : undefined,
    } : undefined,
    group: typeof link.group === 'string' ? link.group.trim() || undefined : undefined,
    favorite: link.favorite === true,
    cwd: typeof link.cwd === 'string' ? link.cwd : undefined,
  }
}

export function normalizeShellState(value: unknown): ShellState {
  const parsed = value && typeof value === 'object' ? value as Partial<ShellState> : {}
  return {
    defaultShell: typeof parsed.defaultShell === 'string' ? parsed.defaultShell : undefined,
    presets: Array.isArray(parsed.presets)
      ? parsed.presets.map(normalizePreset).filter((item): item is ShellPreset => item !== null)
      : [],
    links: Array.isArray(parsed.links)
      ? parsed.links.map(normalizeLink).filter((item): item is ShellLink => item !== null)
      : [],
  }
}

export interface CreateShellSessionOptions {
  name: string;
  cwd: string;
  shell?: string;
  startupCommand?: string;
  remote?: RemoteServerConfig;
}

export interface CreateShellRequest {
  shellPath?: string;
  shellName?: string;
  cwd?: string;
  startupCommand?: string;
}

export interface ResolvedShellLaunch {
  name: string;
  cwd: string;
  shell?: string;
  startupCommand?: string;
  remote?: RemoteServerConfig;
}

export interface ResolveShellLaunchContext {
  availableShells: AvailableShell[];
  defaultShell?: string;
  selectedRoot?: string;
  workspaceRoots?: string[];
}

export interface OpenRemoteServerOptions {
  name: string;
  server: RemoteServerConfig;
  shell?: string;
  localCwd: string;
}

export const DEFAULT_REMOTE_PORT = 22;
