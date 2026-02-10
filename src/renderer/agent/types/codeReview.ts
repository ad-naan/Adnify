/**
 * Code Review Types
 */

export interface CodeReviewSession {
    id: string
    files: ReviewFile[]
    status: 'active' | 'completed' | 'discarded'
    createdAt: number
}

export interface ReviewFile {
    path: string
    comments: ReviewComment[]
}

export interface ReviewComment {
    id: string
    line: number
    content: string
    type: 'suggestion' | 'issue' | 'question'
}
