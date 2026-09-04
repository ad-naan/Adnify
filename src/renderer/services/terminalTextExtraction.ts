/**
 * 终端文本提取
 *
 * 把 PTY 的原始字节流还原成「终端最终渲染出来的样子」，供 Agent 读取命令结果。
 * 与 TerminalManager 分离：这里是纯函数，无 xterm / Electron 依赖，可独立测试。
 *
 * 早期实现直接用几条正则删转义序列，有三个漏洞，合起来就是模型看到的
 * 「一坨乱码字符串」：
 *   1. 只覆盖 5 种序列形状：ST(ESC \) 结尾的 OSC、带中间字节的 CSI、
 *      DCS/APC/SOS/PM 全都漏网，残留成可见垃圾。
 *   2. 直接删掉 \r：CR 在终端里是「回到行首」，npm/pnpm/git 的进度条靠它
 *      原地重画。删掉之后每一帧首尾相接，一行变成几千字符的乱码。
 *   3. 按 PTY 数据块调用：转义序列会被切在两块之间，前半块留下 ESC[，
 *      后半块留下 32m 之类的裸文本。
 *
 * 因此拆成两步：strip（剥离转义，跨块安全）→ render（应用 CR/BS/EL 覆写语义）。
 */

const ESC = '\x1b'

/** CSI 参数字节 0x30-0x3F、中间字节 0x20-0x2F、终止字节 0x40-0x7E */
const CSI_PARAM = /[\x30-\x3f]/
const CSI_INTERMEDIATE = /[\x20-\x2f]/
const CSI_FINAL = /[\x40-\x7e]/

/** 未收完的转义序列最多缓存这么多字符，避免恶意输出无限增长 */
const MAX_ESCAPE_CARRY = 4096

/**
 * EL（Erase in Line, CSI K）标记。
 *
 * CR 在真实终端里只是「回到行首」，并不擦除——`downloading...\rdone!` 在 xterm
 * 里显示的确实是 `done!oading...`。进度条之所以看起来干净，是因为它们紧跟着发
 * `ESC[K` 把行尾残留擦掉。所以剥离阶段不能把 EL 一起删掉，否则 CR 语义对了，
 * 却凭空造出残字。
 *
 * 用私有区码点把 EL 透传给渲染阶段：剥离后仍是纯文本（不含 ESC），渲染阶段消费掉，
 * 两个函数各自仍可独立测试。输入里原有的这些码点会被先剔除，防止内容伪造擦除行为。
 */
const EL_TO_END = '\uE000' // ESC[K / ESC[0K：光标到行尾
const EL_TO_START = '\uE001' // ESC[1K：行首到光标
const EL_WHOLE_LINE = '\uE002' // ESC[2K：整行
const EL_MARKER_RE = /[\uE000-\uE002]/g

/** 若该 CSI 序列是 EL，返回对应标记；否则返回 null */
function elMarkerFor(seq: string): string | null {
  // eslint-disable-next-line no-control-regex -- Intentionally match protocol/control bytes for terminal handling or input sanitization.
  const m = /^\x1b\[([0-9;]*)K$/.exec(seq)
  if (!m) return null
  const param = m[1] === '' ? '0' : m[1]
  if (param === '1') return EL_TO_START
  if (param === '2') return EL_WHOLE_LINE
  return EL_TO_END
}

/**
 * 从 index 处解析一个转义序列。
 * @returns 序列结束后的下标；序列尚未接收完整时返回 -1（调用方需保留尾部等下一块）
 */
export function scanEscapeSequence(str: string, index: number): number {
  const len = str.length
  let i = index + 1
  if (i >= len) return -1

  const kind = str[i]

  // CSI: ESC [ params intermediates final
  if (kind === '[') {
    i++
    while (i < len && CSI_PARAM.test(str[i])) i++
    while (i < len && CSI_INTERMEDIATE.test(str[i])) i++
    if (i >= len) return -1
    if (!CSI_FINAL.test(str[i])) return i + 1 // 非法序列，吞掉这个字节避免死循环
    return i + 1
  }

  // 字符串型序列：OSC(]) / DCS(P) / SOS(X) / PM(^) / APC(_)
  // 终止符可以是 BEL，也可以是 ST（ESC \）——早期实现只认 BEL。
  if (kind === ']' || kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
    i++
    while (i < len) {
      const ch = str[i]
      if (ch === '\x07') return i + 1
      if (ch === ESC) {
        if (i + 1 >= len) return -1
        if (str[i + 1] === '\\') return i + 2
        // 序列内部出现的裸 ESC：按终止处理，避免无限吞掉后续输出
        return i
      }
      i++
    }
    return -1
  }

  // 字符集选择：ESC ( ) * + 后跟 1 个字节
  if (kind === '(' || kind === ')' || kind === '*' || kind === '+') {
    if (i + 1 >= len) return -1
    return i + 2
  }

  // 其余两字节序列：ESC 7/8/=/>/c/M/D/E/H/N/O ...
  return i + 1
}

/** 非打印控制符判定（保留 \n \r \t \b，交给渲染阶段） */
function isDroppableControl(ch: string, code: number): boolean {
  if (code === 0x7f) return true
  return code < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t' && ch !== '\b'
}

/** 核心扫描循环，stripAnsi 与 createAnsiStripper 共用 */
function scanInto(input: string, allowCarry: boolean): { out: string; carry: string } {
  let out = ''
  let carry = ''
  let i = 0
  const len = input.length
  while (i < len) {
    const ch = input[i]
    if (ch === ESC) {
      const next = scanEscapeSequence(input, i)
      if (next === -1) {
        if (allowCarry) carry = input.slice(i)
        break
      }
      const marker = elMarkerFor(input.slice(i, next))
      if (marker) out += marker
      i = next
      continue
    }
    if (isDroppableControl(ch, input.charCodeAt(i))) {
      i++
      continue
    }
    out += ch
    i++
  }
  return { out, carry }
}

/**
 * 剥离转义序列与非打印控制符。保留 \n \r \t \b 及 EL 标记。
 * 无状态版本：尾部残缺的序列直接丢弃。跨块处理请用 createAnsiStripper。
 */
export function stripAnsi(str: string): string {
  return scanInto(str.replace(EL_MARKER_RE, ''), false).out
}

/**
 * 有状态的剥离器：把跨块切断的转义序列留到下一块，避免残半漏成文本。
 * 每个命令执行期间应使用独立实例。
 */
export function createAnsiStripper(): { push: (chunk: string) => string } {
  let carry = ''
  return {
    push(chunk: string): string {
      const input = carry + chunk.replace(EL_MARKER_RE, '')
      const { out, carry: nextCarry } = scanInto(input, true)
      carry = nextCarry.length > MAX_ESCAPE_CARRY ? '' : nextCarry
      return out
    },
  }
}

/**
 * 应用 CR / BS / EL 的覆写语义，得到终端真正显示的文本。
 * 进度条每帧以 \r 回到行首重画，并用 ESC[K 擦掉残留 —— 两者结合后
 * 只剩最后一帧，正是用户在终端里看到的。
 */
export function renderTerminalText(str: string): string {
  return str
    .split('\n')
    .map(renderLine)
    .join('\n')
}

function renderLine(rawLine: string): string {
  if (
    !rawLine.includes('\r') &&
    !rawLine.includes('\b') &&
    !EL_MARKER_RE.test(rawLine)
  ) {
    EL_MARKER_RE.lastIndex = 0
    return rawLine
  }
  EL_MARKER_RE.lastIndex = 0

  let buf = ''
  let cursor = 0
  for (const ch of rawLine) {
    if (ch === '\r') {
      cursor = 0
    } else if (ch === '\b') {
      if (cursor > 0) cursor--
    } else if (ch === EL_TO_END) {
      buf = buf.slice(0, cursor)
    } else if (ch === EL_TO_START) {
      buf = ' '.repeat(Math.min(cursor, buf.length)) + buf.slice(cursor)
    } else if (ch === EL_WHOLE_LINE) {
      buf = ''
      // 光标位置不变（EL 不移动光标），但行已空，后续写入从 cursor 处补空格
    } else if (cursor === buf.length) {
      buf += ch
      cursor++
    } else if (cursor > buf.length) {
      buf = buf + ' '.repeat(cursor - buf.length) + ch
      cursor = buf.length
    } else {
      buf = buf.slice(0, cursor) + ch + buf.slice(cursor + 1)
      cursor++
    }
  }
  return buf
}
