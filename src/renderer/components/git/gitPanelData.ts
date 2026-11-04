import { gitService } from '@renderer/services/gitService'

export type GitTab = 'changes' | 'branches' | 'stash' | 'history'

/** Keep the frequently refreshed changes view independent of optional Git queries. */
export async function loadGitPanelDetails(root: string, tab: GitTab) {
    const [commits, branches, stash, remotes] = await Promise.all([
        tab === 'history' ? gitService.getRecentCommits(30, root) : undefined,
        tab === 'branches' ? gitService.getBranches(root) : undefined,
        tab === 'stash' ? gitService.getStashList(root) : undefined,
        tab === 'branches' ? gitService.getRemotes(root) : undefined,
    ])
    return { commits, branches, stash, remotes }
}
