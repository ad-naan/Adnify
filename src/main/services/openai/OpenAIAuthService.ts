import { createServer } from 'node:http'
import { shell } from 'electron'
import {
  ProviderCredentialStore,
  type OAuthCredential,
} from '../credentials/ProviderCredentialStore'
import { logger } from '@shared/utils/Logger'
import { providerAuthError } from '@shared/errors/providerAuthError'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const CALLBACK_PORT = 1455
const CALLBACK_PATH = '/auth/callback'
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`

type Pkce = { verifier: string; challenge: string }

type TokenResponse = {
  access_token: string
  refresh_token: string
  id_token: string
  expires_in?: number
}

type Claims = {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  chatgpt_plan_type?: string
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
    chatgpt_plan_type?: string
  }
  'https://api.openai.com/profile'?: {
    email?: string
  }
}

type AccountInfo = {
  accountID?: string
  email?: string
  planType?: string
}

function decodeClaims(jwt: string): Claims | undefined {
  const part = jwt.split('.')[1]
  if (!part) return undefined
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString()) as Claims
  } catch {
    return undefined
  }
}

function extractAccountInfo(tokens: TokenResponse): AccountInfo {
  // Profile claims live under the `https://api.openai.com/*` namespaces of the
  // access_token, not at the top level — and refresh responses often omit
  // id_token entirely, so both tokens must be scanned for every field.
  const candidates = [tokens.id_token, tokens.access_token]
    .filter((jwt): jwt is string => typeof jwt === 'string' && jwt.length > 0)
    .map(decodeClaims)
    .filter((claims): claims is Claims => Boolean(claims))

  const info: AccountInfo = {}
  for (const claims of candidates) {
    const auth = claims['https://api.openai.com/auth']
    const profile = claims['https://api.openai.com/profile']

    info.accountID =
      info.accountID ??
      claims.chatgpt_account_id ??
      auth?.chatgpt_account_id ??
      claims.organizations?.[0]?.id
    info.email = info.email ?? claims.email ?? profile?.email
    info.planType = info.planType ?? claims.chatgpt_plan_type ?? auth?.chatgpt_plan_type
  }
  return info
}

async function generatePKCE(): Promise<Pkce> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const verifier = Array.from(
    crypto.getRandomValues(new Uint8Array(43)),
    (b) => chars[b % chars.length]
  ).join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = Buffer.from(digest).toString('base64url')
  return { verifier, challenge }
}

function buildAuthorizeURL(pkce: Pkce, state: string): string {
  return `${ISSUER}/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'adnify',
  })}`
}

async function exchangeCode(code: string, pkce: Pkce): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
  return (await res.json()) as TokenResponse
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  return (await res.json()) as TokenResponse
}

function tokensFromResponse(res: TokenResponse): OAuthCredential {
  const info = extractAccountInfo(res)
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
    accountID: info.accountID,
    email: info.email,
    planType: info.planType,
  }
}

export const OpenAIAuthService = {
  /**
   * Start the browser-based PKCE OAuth flow.
   * Opens the user's browser, waits for the callback, exchanges the code, and persists tokens.
   */
  async login(): Promise<OAuthCredential> {
    const pkce = await generatePKCE()
    const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')

    const code = await new Promise<string>((resolve, reject) => {
      let settled = false

      // The callback server must be released on every exit path — otherwise port
      // 1455 stays bound for the life of the app and the next login fails with
      // EADDRINUSE (surfaced to the user as a generic "unexpected error").
      const finish = (err: Error | null, value?: string) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        server.close()
        if (err) reject(err)
        else resolve(value!)
      }

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404).end()
          return
        }
        const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
        const value = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')

        const html = (title: string, color: string, msg: string) =>
          `<!DOCTYPE html><html><head><title>${title}</title><style>
          body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#eee}
          .c{text-align:center;padding:2rem}h1{color:${color}}p{color:#aaa}
          </style></head><body><div class="c"><h1>${title}</h1><p>${msg}</p></div>
          <script>setTimeout(()=>window.close(),2000)</script></body></html>`

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(
            html('Authorization Failed', '#f87171', error)
          )
          finish(new Error(error))
          return
        }
        if (!value || returnedState !== state) {
          const msg = value ? 'Invalid OAuth state' : 'Missing authorization code'
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(
            html('Authorization Failed', '#f87171', msg)
          )
          finish(new Error(msg))
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          html('Authorization Successful', '#4ade80', 'You can close this window and return to Adnify.')
        )
        finish(null, value)
      })

      server.once('error', (err: NodeJS.ErrnoException) => {
        // Report the real cause: the generic mapper turns EADDRINUSE into
        // "An unexpected error occurred", which tells the user nothing.
        if (err.code === 'EADDRINUSE') {
          finish(providerAuthError('oauthPortInUse', { port: CALLBACK_PORT }))
          return
        }
        finish(err)
      })

      // Abandoned authorizations (user closes the browser tab) would otherwise
      // keep the port bound forever.
      const timeout = setTimeout(() => {
        finish(providerAuthError('oauthLoginTimeout'))
      }, 5 * 60 * 1000)

      server.listen(CALLBACK_PORT, 'localhost', () => {
        shell.openExternal(buildAuthorizeURL(pkce, state)).catch((err) => finish(err))
      })
    })

    const tokenRes = await exchangeCode(code, pkce)
    const tokens = tokensFromResponse(tokenRes)
    ProviderCredentialStore.setOAuth('openai-oauth', tokens)
    logger.security.info('[OpenAIAuth] Login successful', { accountID: tokens.accountID })
    return tokens
  },

  async logout(): Promise<void> {
    ProviderCredentialStore.clear('openai-oauth')
  },

  async getValidToken(): Promise<string | null> {
    const tokens = ProviderCredentialStore.getOAuth('openai-oauth')
    if (!tokens) return null

    if (tokens.expiresAt < Date.now() + 60_000) {
      try {
        const refreshed = await refreshTokens(tokens.refreshToken)
        const next = tokensFromResponse(refreshed)
        // Refresh responses may omit id_token — keep the profile claims we already have.
        ProviderCredentialStore.setOAuth('openai-oauth', {
          ...next,
          accountID: next.accountID ?? tokens.accountID,
          email: next.email ?? tokens.email,
          planType: next.planType ?? tokens.planType,
        })
        return next.accessToken
      } catch (err) {
        logger.security.warn('[OpenAIAuth] Token refresh failed, clearing tokens', err)
        ProviderCredentialStore.clear('openai-oauth')
        return null
      }
    }

    return tokens.accessToken
  },

  async getStatus(): Promise<{
    loggedIn: boolean
    accountID?: string
    email?: string
    planType?: string
    expiresAt?: number
  }> {
    const tokens = ProviderCredentialStore.getOAuth('openai-oauth')
    if (!tokens) return { loggedIn: false }
    // Re-derive from the access token so sessions stored by an earlier version
    // (which missed the namespaced claims) report their plan without re-login.
    const derived = extractAccountInfo({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      id_token: '',
    })
    return {
      loggedIn: true,
      accountID: tokens.accountID ?? derived.accountID,
      email: tokens.email ?? derived.email,
      planType: tokens.planType ?? derived.planType,
      expiresAt: tokens.expiresAt,
    }
  },
}
