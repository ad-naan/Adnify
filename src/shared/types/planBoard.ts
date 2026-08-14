export const PLAN_BOARD_PATH = 'adnify-plan://board'

export function isPlanBoardPath(path: string | null | undefined): boolean {
  return path === PLAN_BOARD_PATH
}
