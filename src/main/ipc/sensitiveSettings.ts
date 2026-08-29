/**
 * 通用 settings 通道的敏感键策略。
 *
 * `settings:get` / `settings:set` 是渲染进程对 config store 的任意键读写通道：
 * 没有白名单，键名直接透传给 electron-store。凭据本体从 openai-auth.json
 * （文件权限 0600、settings 通道碰不到）迁进 config.json 之后，
 * `getSetting('providerCredentials')` 就能一次性取回所有 API key 以及
 * OAuth 的 accessToken / refreshToken —— refresh token 尤其致命，它不过期，
 * 拿到就等于长期冒充用户。
 *
 * 这里不用 ensureTrustedIpcSender：它只校验 sender 的 URL 是不是 file:// 或
 * 本地 dev server，而攻击面正是受信任的渲染进程内部（Markdown 渲染、
 * 第三方内容、扩展脚本都跑在同一个 file:// 上下文里）。能挡住的只有
 * 「这个键不该走通用通道」这条规则本身。
 *
 * 渲染进程需要展示 API key 时走专用通道 `credentials:api-keys:get`，
 * OAuth 状态走 `credentials:oauth:status`，都不经过这里。
 */

/** 只能由主进程内部读写、禁止走通用 settings 通道的键。 */
export const SENSITIVE_SETTINGS_KEYS: readonly string[] = ['providerCredentials']

const SENSITIVE_KEY_SET = new Set(SENSITIVE_SETTINGS_KEYS)

/**
 * electron-store 支持点号路径（`store.get('a.b.c')`），所以必须按首段判断：
 * 只挡 `providerCredentials` 而放过 `providerCredentials.openai-oauth.refreshToken`
 * 等于没挡。
 */
export function isSensitiveSettingsKey(key: unknown): boolean {
  if (typeof key !== 'string') return false
  return SENSITIVE_KEY_SET.has(key.split('.')[0])
}

export function sensitiveSettingsKeyError(key: string): Error {
  return new Error(
    `Setting "${key}" holds credentials and is not readable or writable over the settings channel`,
  )
}
