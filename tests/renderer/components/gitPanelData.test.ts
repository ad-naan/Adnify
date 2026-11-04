import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getRecentCommits: vi.fn(), getBranches: vi.fn(), getStashList: vi.fn(), getRemotes: vi.fn(),
}))
vi.mock('@renderer/services/gitService', () => ({ gitService: mocks }))
import { loadGitPanelDetails } from '@components/git/gitPanelData'

describe('Git panel detail loading', () => {
    beforeEach(() => vi.resetAllMocks())

    it('does not query hidden tabs when refreshing changes', async () => {
        await loadGitPanelDetails('/repo', 'changes')
        for (const query of Object.values(mocks)) expect(query).not.toHaveBeenCalled()
    })

    it('loads only history for the history tab', async () => {
        mocks.getRecentCommits.mockResolvedValue([{ hash: 'commit' }])
        const data = await loadGitPanelDetails('/repo', 'history')
        expect(mocks.getRecentCommits).toHaveBeenCalledWith(30, '/repo')
        expect(data.commits).toEqual([{ hash: 'commit' }])
        expect(mocks.getBranches).not.toHaveBeenCalled()
        expect(mocks.getRemotes).not.toHaveBeenCalled()
        expect(mocks.getStashList).not.toHaveBeenCalled()
    })

    it('loads branches and their remote labels together', async () => {
        await loadGitPanelDetails('/repo', 'branches')
        expect(mocks.getBranches).toHaveBeenCalledWith('/repo')
        expect(mocks.getRemotes).toHaveBeenCalledWith('/repo')
        expect(mocks.getRecentCommits).not.toHaveBeenCalled()
        expect(mocks.getStashList).not.toHaveBeenCalled()
    })

    it('loads only stash for the stash tab', async () => {
        await loadGitPanelDetails('/repo', 'stash')
        expect(mocks.getStashList).toHaveBeenCalledWith('/repo')
        expect(mocks.getRecentCommits).not.toHaveBeenCalled()
        expect(mocks.getBranches).not.toHaveBeenCalled()
        expect(mocks.getRemotes).not.toHaveBeenCalled()
    })
})
