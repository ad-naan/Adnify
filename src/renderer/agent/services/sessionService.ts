/**
 * 会话管理服务
 * 保存和加载对话历史
 * 使用 chatThreadService 的消息格式
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { LLMConfig } from '@store'
import { WorkMode } from '@/renderer/modes/types'
import { ChatMessage, ChatThread, getMessageText as getMsgText, isUserMessage } from '../types'
import { useAgentStore } from '../store/AgentStore'
import { adnifyDir } from '@/renderer/services/adnifyDirService'

export interface ChatSession {
	id: string
	name: string
	mode: WorkMode
	messages: ChatMessage[]
	createdAt: number
	updatedAt: number
	config?: Partial<LLMConfig>
}

export interface SessionSummary {
	id: string
	name: string
	mode: WorkMode
	messageCount: number
	createdAt: number
	updatedAt: number
	preview: string
	config?: Partial<LLMConfig>
}

interface SavedSessionIndexEntry extends SessionSummary {}

const SESSIONS_KEY = 'chat_sessions'
const SAVED_SESSIONS_DIR = 'saved-sessions'
const SAVED_SESSIONS_INDEX_FILE = `${SAVED_SESSIONS_DIR}/index.json`
const MAX_SESSIONS = 50

function getMessageText(msg: ChatMessage): string {
	if (isUserMessage(msg)) {
		return getMsgText(msg.content)
	}
	if ('content' in msg && typeof msg.content === 'string') {
		return msg.content
	}
	return ''
}

function generateSessionName(messages: ChatMessage[]): string {
	const firstUserMessage = messages.find(m => isUserMessage(m))
	if (firstUserMessage) {
		const text = getMessageText(firstUserMessage)
		const preview = text.slice(0, 50)
		return preview.length < text.length ? preview + '...' : preview
	}
	return `Session ${new Date().toLocaleString()}`
}

function getMessagePreview(messages: ChatMessage[]): string {
	const firstUserMessage = messages.find(m => isUserMessage(m))
	if (firstUserMessage) {
		return getMessageText(firstUserMessage).slice(0, 100)
	}
	return ''
}

function toSummary(session: ChatSession): SavedSessionIndexEntry {
	return {
		id: session.id,
		name: session.name,
		mode: session.mode,
		messageCount: session.messages.length,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		preview: getMessagePreview(session.messages),
		config: session.config,
	}
}

function sortSummaries(sessions: SavedSessionIndexEntry[]): SavedSessionIndexEntry[] {
	return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

function getSessionFilePath(sessionId: string): string {
	return `${SAVED_SESSIONS_DIR}/${sessionId}.jsonl`
}

function serializeMessages(messages: ChatMessage[]): string {
	if (messages.length === 0) return ''
	return messages.map(message => JSON.stringify(message)).join('\n')
}

function parseMessagesFromJsonl(content: string): ChatMessage[] {
	if (!content.trim()) return []

	const messages: ChatMessage[] = []
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim()
		if (!trimmed) continue
		try {
			messages.push(JSON.parse(trimmed) as ChatMessage)
		} catch (error) {
			logger.agent.warn('[SessionService] Skipped invalid session JSONL line', error)
		}
	}
	return messages
}

class SessionService {
	private migrationPromise: Promise<void> | null = null

	private async ensureInitialized(): Promise<void> {
		if (!adnifyDir.isInitialized()) {
			throw new Error('Adnify directory is not initialized')
		}
		await adnifyDir.ensureSavedSessionsDir()
		await this.ensureMigrated()
	}

	private async ensureMigrated(): Promise<void> {
		if (this.migrationPromise) {
			await this.migrationPromise
			return
		}

		this.migrationPromise = this.migrateLegacySessions()
		try {
			await this.migrationPromise
		} finally {
			this.migrationPromise = null
		}
	}

	private async readIndex(): Promise<SavedSessionIndexEntry[]> {
		const data = await adnifyDir.readJson<SavedSessionIndexEntry[]>(SAVED_SESSIONS_INDEX_FILE)
		return Array.isArray(data) ? sortSummaries(data) : []
	}

	private async writeIndex(entries: SavedSessionIndexEntry[]): Promise<void> {
		await adnifyDir.writeJson(SAVED_SESSIONS_INDEX_FILE, sortSummaries(entries))
	}

	private async readSessionMessages(sessionId: string): Promise<ChatMessage[] | null> {
		const content = await adnifyDir.readText(getSessionFilePath(sessionId))
		if (content === null) return null
		return parseMessagesFromJsonl(content)
	}

	private async writeSessionMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
		await adnifyDir.writeText(getSessionFilePath(sessionId), serializeMessages(messages))
	}

	private async deleteSessionFile(sessionId: string): Promise<void> {
		await adnifyDir.deleteFile(getSessionFilePath(sessionId))
	}

	private async trimSessions(entries: SavedSessionIndexEntry[]): Promise<SavedSessionIndexEntry[]> {
		if (entries.length <= MAX_SESSIONS) return entries

		const sorted = sortSummaries(entries)
		const kept = sorted.slice(0, MAX_SESSIONS)
		const keptIds = new Set(kept.map(entry => entry.id))
		const removed = sorted.filter(entry => !keptIds.has(entry.id))
		await Promise.all(removed.map(entry => this.deleteSessionFile(entry.id)))
		return kept
	}

	private async migrateLegacySessions(): Promise<void> {
		try {
			const legacyData = await api.settings.get(SESSIONS_KEY)
			if (!legacyData || typeof legacyData !== 'string') return

			const legacySessions = JSON.parse(legacyData) as ChatSession[]
			if (!Array.isArray(legacySessions) || legacySessions.length === 0) {
				return
			}

			const existingIndex = await this.readIndex()
			const existingIds = new Set(existingIndex.map(session => session.id))
			const mergedIndex = [...existingIndex]

			for (const session of legacySessions) {
				if (!session?.id || !Array.isArray(session.messages)) continue
				if (!existingIds.has(session.id)) {
					await this.writeSessionMessages(session.id, session.messages)
					mergedIndex.push(toSummary(session))
					existingIds.add(session.id)
				}
			}

			await this.writeIndex(await this.trimSessions(mergedIndex))
			await api.settings.set(SESSIONS_KEY, undefined)
			logger.agent.info('[SessionService] Migrated legacy chat_sessions to saved-sessions storage')
		} catch (error) {
			logger.agent.error('[SessionService] Failed to migrate legacy chat_sessions:', error)
		}
	}

	async getSessions(): Promise<SessionSummary[]> {
		try {
			await this.ensureInitialized()
			return await this.readIndex()
		} catch {
			return []
		}
	}

	async getSession(id: string): Promise<ChatSession | null> {
		try {
			await this.ensureInitialized()
			const index = await this.readIndex()
			const entry = index.find(session => session.id === id)
			if (!entry) return null

			const messages = await this.readSessionMessages(id)
			if (!messages) return null

			return {
				id: entry.id,
				name: entry.name,
				mode: entry.mode,
				messages,
				createdAt: entry.createdAt,
				updatedAt: entry.updatedAt,
				config: entry.config,
			}
		} catch {
			return null
		}
	}

	async saveCurrentThread(
		mode: WorkMode,
		existingId?: string,
		config?: Partial<LLMConfig>
	): Promise<string> {
		const thread = useAgentStore.getState().getCurrentThread()
		if (!thread) {
			throw new Error('No current thread')
		}
		return this.saveThread(thread, mode, existingId, config)
	}

	async saveThread(
		thread: ChatThread,
		mode: WorkMode,
		existingId?: string,
		config?: Partial<LLMConfig>
	): Promise<string> {
		await this.ensureInitialized()

		const now = Date.now()
		const messages = thread.messages
		let index = await this.readIndex()

		if (existingId) {
			const existing = index.find(session => session.id === existingId)
			if (existing) {
				await this.writeSessionMessages(existingId, messages)
				index = index.map(session =>
					session.id === existingId
						? {
							...session,
							mode,
							updatedAt: now,
							messageCount: messages.length,
							preview: getMessagePreview(messages),
							config,
						}
						: session
				)
				await this.writeIndex(index)
				return existingId
			}
		}

		const newSession: ChatSession = {
			id: crypto.randomUUID(),
			name: generateSessionName(messages),
			mode,
			messages,
			createdAt: now,
			updatedAt: now,
			config,
		}

		await this.writeSessionMessages(newSession.id, messages)
		index.unshift(toSummary(newSession))
		index = await this.trimSessions(index)
		await this.writeIndex(index)
		return newSession.id
	}

	async deleteSession(id: string): Promise<boolean> {
		try {
			await this.ensureInitialized()
			const index = await this.readIndex()
			const nextIndex = index.filter(session => session.id !== id)
			if (nextIndex.length === index.length) return false

			await this.deleteSessionFile(id)
			await this.writeIndex(nextIndex)
			return true
		} catch {
			return false
		}
	}

	async renameSession(id: string, name: string): Promise<boolean> {
		try {
			await this.ensureInitialized()
			const index = await this.readIndex()
			let found = false
			const nextIndex = index.map(session => {
				if (session.id !== id) return session
				found = true
				return {
					...session,
					name,
					updatedAt: Date.now(),
				}
			})
			if (!found) return false
			await this.writeIndex(nextIndex)
			return true
		} catch {
			return false
		}
	}

	async clearAllSessions(): Promise<void> {
		await this.ensureInitialized()
		const index = await this.readIndex()
		await Promise.all(index.map(session => this.deleteSessionFile(session.id)))
		await this.writeIndex([])
	}

	async exportSession(id: string): Promise<string | null> {
		const session = await this.getSession(id)
		if (!session) return null
		return JSON.stringify(session, null, 2)
	}

	async importSession(jsonStr: string): Promise<string | null> {
		try {
			const session: ChatSession = JSON.parse(jsonStr)
			if (!session.messages || !Array.isArray(session.messages)) {
				throw new Error('Invalid session format')
			}

			session.id = crypto.randomUUID()
			session.createdAt = Date.now()
			session.updatedAt = Date.now()

			await this.ensureInitialized()
			await this.writeSessionMessages(session.id, session.messages)
			const index = await this.trimSessions([toSummary(session), ...(await this.readIndex())])
			await this.writeIndex(index)

			return session.id
		} catch {
			return null
		}
	}

	async loadSessionToThread(sessionId: string): Promise<boolean> {
		const session = await this.getSession(sessionId)
		if (!session) return false

		const store = useAgentStore.getState()
		const threadId = store.createThread()

		useAgentStore.setState(state => {
			const thread = state.threads[threadId]
			if (!thread) return state

			return {
				threads: {
					...state.threads,
					[threadId]: {
						...thread,
						messages: session.messages,
						lastModified: Date.now(),
						streamState: { phase: 'idle' },
					},
				},
			}
		})

		logger.agent.info('[SessionService] Loaded session:', sessionId, 'messages:', session.messages.length)
		return true
	}
}

export const sessionService = new SessionService()
