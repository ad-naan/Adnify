/**
 * 供应商鉴权/配置类错误的唯一文案出口。
 *
 * 这几条错误抛在主进程里：`resolveAuthForConfig` 只拿到 `LLMConfig`（没有 language），
 * OpenAI 登录那两条更是在 `server.once('error')` / `setTimeout` 回调里，连请求上下文都没有。
 * 所以主进程只抛原因码，变成人话在渲染进程展示时做一次 —— 和
 * `src/shared/security/securityReasonText.ts` 处理 `ExecutionReason` 是同一个形状。
 *
 * 为什么码要编进 `Error.message`、而不是挂成 `error.code` 字段：这几条错误要穿过五种
 * 互不相同的 IPC 形状才到得了界面，而其中三种会把码丢掉 ——
 * - `healthCheck:testModel` 返回 `{ success, error }`，`toAppError` 算出的 code 没进返回值；
 * - `llm:generateObject` 直接 reject，Electron 只把 message 串化，自定义字段一律不过；
 * - `credentials:oauth:login` 的 `safeIpcHandle` 确实带了 code，但 preload 声明的返回类型
 *   里没有它，渲染侧读不到。
 * message 是这五条路径里唯一被原样送到底的东西，所以码坐在 message 上。
 *
 * 代价写在这里：这串码万一漏到界面上，用户看到的是 `adnify.providerAuth:...` 而不是人话。
 * 这比今天的行为（英文界面上直接显示中文）好一点，而且一眼能看出是哪个展示点漏了包装。
 */
import { t, type Language, type TranslationParams } from '@shared/i18n'

/** `providerAuthError.${code}` 是模板字面量类型，少一个键编译期就报错。 */
export type ProviderAuthErrorCode =
  | 'chatgptNotSignedIn'
  | 'openAiKeyMissing'
  | 'providerKeyMissing'
  | 'oauthPortInUse'
  | 'oauthLoginTimeout'

/**
 * 解析时要校验码，不能直接强转：上游的 catch 有可能在码后面接着拼别的话，
 * 切出来的 token 就会带上尾巴（`oauthLoginTimeout.`）。那种情况下 `t()` 缺键会把
 * `providerAuthError.oauthLoginTimeout.` 这串键名显示给用户 —— 不如认不出、退回原文。
 *
 * `satisfies` 保证这份运行时清单和上面的联合类型不会走散。
 */
const CODES = [
  'chatgptNotSignedIn',
  'openAiKeyMissing',
  'providerKeyMissing',
  'oauthPortInUse',
  'oauthLoginTimeout',
] as const satisfies readonly ProviderAuthErrorCode[]

const PREFIX = 'adnify.providerAuth:'

/**
 * 主进程侧：造一个带码的 `Error`。
 *
 * 参数用 `URLSearchParams` 编码而不是 JSON：值里可能有供应商显示名（`Z.ai`、`OpenAI`），
 * 而 JSON 串进 message 之后被别的 catch 拼接、截断的概率更高，转义也更难看。
 */
export function providerAuthError(
  code: ProviderAuthErrorCode,
  params?: Record<string, string | number>,
): Error {
  const query = params ? new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
  ).toString() : ''
  return new Error(`${PREFIX}${code}${query ? `?${query}` : ''}`)
}

function parse(message: string): { code: ProviderAuthErrorCode; params: TranslationParams } | null {
  const start = message.indexOf(PREFIX)
  if (start < 0) return null
  // 从 PREFIX 起截到第一个空白：上游的 catch 会在前面加 `Error invoking remote method '…': `
  // 这类前缀（`StructuredService` 那条路径就是），后面也可能被拼上别的话。
  const token = message.slice(start + PREFIX.length).split(/\s/, 1)[0]
  const [code, query] = token.split('?', 2)
  if (!CODES.includes(code as ProviderAuthErrorCode)) return null
  return {
    code: code as ProviderAuthErrorCode,
    params: query ? Object.fromEntries(new URLSearchParams(query)) : {},
  }
}

/**
 * 这条 message 带的是本类的原因码吗。
 *
 * 给 `mapAISDKError` 的关键词兜底用：那段逻辑对 message 做 `toLowerCase().includes('timeout')`
 * 之类的猜测，而 `oauthLoginTimeout` 这个码名里就有 `timeout` —— 猜中之后 `toAppError` 会把
 * 具体原因替换成"请求超时"，码就丢了。关键词猜测是给无结构 message 的兜底，本类是有结构的，
 * 所以在那之前先退出。
 */
export function isProviderAuthErrorMessage(message: string | undefined | null): boolean {
  return !!message && parse(message) !== null
}

/**
 * 渲染进程侧：认出码就查表，认不出返回 `null`。
 *
 * 需要区分"这是本类错误"的展示点用这个 —— 聊天流那条路径上，通用兜底文案
 * （`getErrorMessage(UNKNOWN)` = "发生了未知错误"）会被拼在具体消息前面，
 * 而本类错误本身已经足够具体，不该再套那层前缀。
 */
export function tryProviderAuthErrorText(
  message: string | undefined | null,
  language: Language,
): string | null {
  if (!message) return null
  const parsed = parse(message)
  return parsed ? t(`providerAuthError.${parsed.code}`, language, parsed.params) : null
}

/**
 * 同上，但认不出时原样返回入参。
 *
 * 对非本类错误是恒等函数，所以展示点可以无条件包一层，不需要先判别错误来源。
 */
export function providerAuthErrorText(message: string | undefined | null, language: Language): string {
  return tryProviderAuthErrorText(message, language) ?? message ?? ''
}
