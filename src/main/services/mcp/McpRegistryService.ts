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
    registryType: 'npm' | 'pip' | 'oci'
    identifier: string
    version?: string
    transport: { type: 'stdio' }
    environmentVariables?: RegistryEnvVar[]
    runtimeHint?: string
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
        _meta: {
            'io.modelcontextprotocol.registry/official': {
                status: string
                publishedAt: string
                updatedAt: string
                isLatest: boolean
            }
        }
    }>
    metadata: {
        nextCursor?: string
        count: number
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
     * 注：Registry API 当前不支持搜索查询参数，需要客户端过滤
     */
    async search(query?: string): Promise<RegistrySearchResult[]> {
        try {
            const cacheKey = `search:${query || 'all'}`
            const cached = this.cache.get(cacheKey)
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                return cached.data
            }

            const allServers = await this.fetchAllServers()
            let results = allServers

            // 客户端过滤
            if (query) {
                const lowerQuery = query.toLowerCase()
                results = allServers.filter(
                    (s) =>
                        s.name.toLowerCase().includes(lowerQuery) ||
                        s.description.toLowerCase().includes(lowerQuery) ||
                        s.title?.toLowerCase().includes(lowerQuery) === true
                )
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
     * 将 Registry 服务器信息转换为本地 MCP 配置
     */
    toLocalConfig(server: RegistryServer): import('@shared/types/mcp').McpServerConfig | null {
        // 优先使用 npm stdio 包
        const npmPackage = server.packages?.find((p) => p.registryType === 'npm')
        if (npmPackage) {
            return {
                id: server.name.replace(/[^a-zA-Z0-9-_]/g, '-'),
                command: 'npx',
                args: ['-y', npmPackage.identifier],
                env: this.buildEnvFromVars(npmPackage.environmentVariables),
            } as import('@shared/types/mcp').McpServerConfig
        }

        // 其次使用远程端点
        const remote = server.remotes?.[0]
        if (remote) {
            return {
                id: server.name.replace(/[^a-zA-Z0-9-_]/g, '-'),
                url: remote.url,
                headers: this.buildHeadersFromVars(remote.headers),
            } as import('@shared/types/mcp').McpServerConfig
        }

        return null
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
