/**
 * MCP Registry 服务
 * 连接官方 MCP Registry (registry.modelcontextprotocol.io) 实现服务器发现
 */

import { logger } from '@shared/utils/Logger'

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1'

// =================== 类型定义 ===================

/** Registry 服务器信息 */
export interface RegistryServer {
    name: string
    title?: string
    description: string
    version: string
    websiteUrl?: string
    icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>
    repository?: { url: string; source?: string }
    /** 本地包安装信息（stdio 传输） */
    packages?: RegistryPackage[]
    /** 远程端点信息（HTTP/SSE 传输） */
    remotes?: RegistryRemote[]
}

/** npm/pip/docker 包信息 */
export interface RegistryPackage {
    registryType: 'npm' | 'pip' | 'pypi' | 'oci' | string
    identifier: string
    version?: string
    transport: { type: 'stdio' }
    environmentVariables?: RegistryEnvVar[]
    runtimeHint?: string
    runtimeArguments?: Array<{
        name?: string
        value?: string
        default?: string
        type?: 'named' | 'positional'
        description?: string
    }>
}

/** 远程端点信息 */
export interface RegistryRemote {
    type: 'streamable-http' | 'sse'
    url: string
    headers?: RegistryEnvVar[]
}

/** 环境变量定义 */
export interface RegistryEnvVar {
    name: string
    description?: string
    isRequired?: boolean
    isSecret?: boolean
    default?: string
    format?: string
}

/** Registry API 响应 */
interface RegistryListResponse {
    servers: Array<{
        server: RegistryServer
        _meta?: {
            'io.modelcontextprotocol.registry/official'?: {
                status?: string
                publishedAt?: string
                updatedAt?: string
                isLatest?: boolean
            }
        }
    }>
    metadata: {
        nextCursor?: string
        count?: number
    }
}

/** 搜索结果 */
export interface RegistrySearchResult {
    id: string
    name: string
    title?: string
    description: string
    version: string
    transportType: 'stdio' | 'remote' | 'both'
    packageIdentifier?: string
    remoteUrl?: string
    websiteUrl?: string
    iconUrl?: string
}

// =================== 服务实现 ===================

export class McpRegistryService {
    private cache: Map<string, { data: RegistrySearchResult[]; timestamp: number }> = new Map()
    private readonly CACHE_TTL = 5 * 60 * 1000 // 缓存 5 分钟

    /**
     * 搜索 Registry 中的 MCP 服务器
     * 支持官方 Registry 服务端 search 查询参数，保证全量检索
     */
    async search(query?: string): Promise<RegistrySearchResult[]> {
        const trimmed = query?.trim()
        const cacheKey = `search:${trimmed || 'all'}`
        const cached = this.cache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data
        }

        try {
            const results: RegistrySearchResult[] = []

            if (trimmed) {
                // 1. 服务端检索：直接调用官方 Registry search 参数获取精准匹配（如 serena 等）
                const searchUrl = `${REGISTRY_BASE_URL}/servers?search=${encodeURIComponent(trimmed)}`
                const response = await fetch(searchUrl)
                if (response.ok) {
                    const data = (await response.json()) as RegistryListResponse
                    for (const item of data.servers || []) {
                        const server = item.server
                        const meta = item._meta?.['io.modelcontextprotocol.registry/official']
                        // 只过滤明确废弃或非最新的版本
                        if (meta && (meta.status === 'deprecated' || meta.isLatest === false)) continue
                        results.push(this.toSearchResult(server))
                    }
                }
            } else {
                // 2. 浏览全部：拉取官方活跃推荐列表
                results.push(...(await this.fetchAllServers()))
            }

            this.cache.set(cacheKey, { data: results, timestamp: Date.now() })
            return results
        } catch (err) {
            logger.mcp?.error('[McpRegistry] Search failed:', err)
            return []
        }
    }

    /**
     * 获取指定服务器的详细信息
     */
    async getServerDetails(serverName: string): Promise<RegistryServer | null> {
        try {
            const url = `${REGISTRY_BASE_URL}/servers/${encodeURIComponent(serverName)}/versions/latest`
            const response = await fetch(url)
            if (!response.ok) return null

            const data = await response.json() as any
            return data?.server || null
        } catch (err) {
            logger.mcp?.error(`[McpRegistry] Failed to get details for ${serverName}:`, err)
            return null
        }
    }

    /**
     * 将 Registry 服务器信息转换为本地 MCP 配置（支持 npm、pypi/uvx、oci/docker、cargo、nuget、mcpb 及 Remote）
     */
    toLocalConfig(server: RegistryServer): import('@shared/types/mcp').McpServerConfig | null {
        const id = server.name.replace(/[^a-zA-Z0-9-_]/g, '-')

        // 1. npm 包 (Node.js stdio)
        const npmPackage = server.packages?.find((p) => p.registryType === 'npm')
        if (npmPackage) {
            const runtimeArgs = this.extractRuntimeArgs(npmPackage)
            return {
                id,
                command: 'npx',
                args: ['-y', npmPackage.identifier, ...runtimeArgs],
                env: this.buildEnvFromVars(npmPackage.environmentVariables),
            } as import('@shared/types/mcp').McpServerConfig
        }

        // 2. pypi / pip 包 (Python stdio)
        const pypiPackage = server.packages?.find((p) => p.registryType === 'pypi' || p.registryType === 'pip')
        if (pypiPackage) {
            if (pypiPackage.runtimeHint === 'uvx') {
                const { runtimeFlags, packageArgs } = this.extractUvxArgs(pypiPackage)
                return {
                    id,
                    command: 'uvx',
                    args: [...runtimeFlags, pypiPackage.identifier, ...packageArgs],
                    env: this.buildEnvFromVars(pypiPackage.environmentVariables),
                } as import('@shared/types/mcp').McpServerConfig
            }

            const runtimeArgs = this.extractRuntimeArgs(pypiPackage)
            return {
                id,
                command: 'python',
                args: ['-m', pypiPackage.identifier, ...runtimeArgs],
                env: this.buildEnvFromVars(pypiPackage.environmentVariables),
            } as import('@shared/types/mcp').McpServerConfig
        }

        // 3. oci 容器镜像 (Docker stdio)
        const ociPackage = server.packages?.find((p) => p.registryType === 'oci' || p.registryType === 'docker')
        if (ociPackage) {
            const runtimeArgs = this.extractRuntimeArgs(ociPackage)
            return {
                id,
                command: 'docker',
                args: ['run', '-i', '--rm', ociPackage.identifier, ...runtimeArgs],
                env: this.buildEnvFromVars(ociPackage.environmentVariables),
            } as import('@shared/types/mcp').McpServerConfig
        }

        // 4. cargo 包 (Rust stdio)
        const cargoPackage = server.packages?.find((p) => p.registryType === 'cargo')
        if (cargoPackage) {
            const runtimeArgs = this.extractRuntimeArgs(cargoPackage)
            return {
                id,
                command: 'cargo',
                args: ['run', '--bin', cargoPackage.identifier, ...runtimeArgs],
                env: this.buildEnvFromVars(cargoPackage.environmentVariables),
            } as import('@shared/types/mcp').McpServerConfig
        }

        // 5. nuget 包 (.NET stdio)
        const nugetPackage = server.packages?.find((p) => p.registryType === 'nuget')
        if (nugetPackage) {
            const runtimeArgs = this.extractRuntimeArgs(nugetPackage)
            return {
                id,
                command: 'dotnet',
                args: ['tool', 'run', nugetPackage.identifier, ...runtimeArgs],
                env: this.buildEnvFromVars(nugetPackage.environmentVariables),
            } as import('@shared/types/mcp').McpServerConfig
        }

        // 6. mcpb 预编译包 / 二进制文件
        const mcpbPackage = server.packages?.find((p) => p.registryType === 'mcpb')
        if (mcpbPackage) {
            const runtimeArgs = this.extractRuntimeArgs(mcpbPackage)
            return {
                id,
                command: mcpbPackage.identifier,
                args: runtimeArgs,
                env: this.buildEnvFromVars(mcpbPackage.environmentVariables),
            } as import('@shared/types/mcp').McpServerConfig
        }

        // 7. 远程端点 (HTTP / SSE / WebSocket)
        const remote = server.remotes?.[0]
        if (remote) {
            return {
                id,
                url: remote.url,
                headers: this.buildHeadersFromVars(remote.headers),
            } as import('@shared/types/mcp').McpServerConfig
        }

        return null
    }

    private extractUvxArgs(pkg: RegistryPackage): { runtimeFlags: string[]; packageArgs: string[] } {
        const runtimeFlags: string[] = []
        const packageArgs: string[] = []

        if (pkg.runtimeArguments?.length) {
            for (const arg of pkg.runtimeArguments) {
                if (arg.type === 'named' && arg.name) {
                    const val = arg.value || arg.default || ''
                    // uvx 的自身前置选项：-p, --python, --from, --with
                    if (arg.name === '-p' || arg.name === '--python' || arg.name === '--from' || arg.name === '--with') {
                        runtimeFlags.push(arg.name)
                        if (val) runtimeFlags.push(val)
                    } else {
                        packageArgs.push(arg.name)
                        if (val) packageArgs.push(val)
                    }
                } else if (arg.value) {
                    packageArgs.push(arg.value)
                }
            }
        }

        return { runtimeFlags, packageArgs }
    }

    private extractRuntimeArgs(pkg: RegistryPackage): string[] {
        const runtimeArgs: string[] = []
        if (pkg.runtimeArguments?.length) {
            for (const arg of pkg.runtimeArguments) {
                if (arg.type === 'named' && arg.name) {
                    runtimeArgs.push(arg.name)
                    if (arg.value || arg.default) {
                        runtimeArgs.push(arg.value || arg.default || '')
                    }
                } else if (arg.value) {
                    runtimeArgs.push(arg.value)
                }
            }
        }
        return runtimeArgs
    }

    /**
     * 获取服务器所需的环境变量列表
     */
    getRequiredEnvVars(server: RegistryServer): RegistryEnvVar[] {
        const vars: RegistryEnvVar[] = []

        // 从 packages 收集
        for (const pkg of server.packages || []) {
            for (const envVar of pkg.environmentVariables || []) {
                if (!vars.find((v) => v.name === envVar.name)) {
                    vars.push(envVar)
                }
            }
        }

        // 从 remotes headers 收集
        for (const remote of server.remotes || []) {
            for (const header of remote.headers || []) {
                if (!vars.find((v) => v.name === header.name)) {
                    vars.push(header)
                }
            }
        }

        return vars
    }

    // =================== 私有方法 ===================

    private async fetchAllServers(): Promise<RegistrySearchResult[]> {
        const results: RegistrySearchResult[] = []
        let cursor: string | undefined

        // 分页获取，最多 3 页防止请求过多
        for (let page = 0; page < 3; page++) {
            const url = cursor
                ? `${REGISTRY_BASE_URL}/servers?cursor=${encodeURIComponent(cursor)}`
                : `${REGISTRY_BASE_URL}/servers`

            const response = await fetch(url)
            if (!response.ok) break

            const data = await response.json() as RegistryListResponse

            for (const item of data.servers) {
                const server = item.server
                const meta = item._meta['io.modelcontextprotocol.registry/official']

                // 只取最新版本和活跃的服务器
                if (!meta.isLatest || meta.status !== 'active') continue

                results.push(this.toSearchResult(server))
            }

            if (!data.metadata.nextCursor) break
            cursor = data.metadata.nextCursor
        }

        logger.mcp?.info(`[McpRegistry] Fetched ${results.length} servers from registry`)
        return results
    }

    private toSearchResult(server: RegistryServer): RegistrySearchResult {
        const hasPackages = (server.packages?.length || 0) > 0
        const hasRemotes = (server.remotes?.length || 0) > 0
        const name = server.name

        return {
            id: name,
            name,
            title: server.title,
            description: server.description,
            version: server.version,
            transportType: hasPackages && hasRemotes ? 'both' : hasPackages ? 'stdio' : 'remote',
            packageIdentifier: server.packages?.[0]?.identifier,
            remoteUrl: server.remotes?.[0]?.url,
            websiteUrl: server.websiteUrl,
            iconUrl: server.icons?.[0]?.src,
        }
    }

    private buildEnvFromVars(vars?: RegistryEnvVar[]): Record<string, string> {
        const env: Record<string, string> = {}
        for (const v of vars || []) {
            if (v.default) {
                env[v.name] = v.default
            }
        }
        return env
    }

    private buildHeadersFromVars(vars?: RegistryEnvVar[]): Record<string, string> {
        const headers: Record<string, string> = {}
        for (const v of vars || []) {
            if (v.default) {
                headers[v.name] = v.default
            }
        }
        return headers
    }
}

/** 单例 */
export const mcpRegistry = new McpRegistryService()
