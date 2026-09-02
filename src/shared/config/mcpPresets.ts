/**
 * MCP 服务器预设配置
 * 内置常用的 MCP 服务器，用户可以一键添加
 *
 * **文案字段存的是 locale 键，不是文案。** `description` / `setupNote` /
 * `usageExamples` / `envConfig[].label` / `envConfig[].description` 在这张表里
 * 都是 `'mcpPresets.<preset>.<field>'`，读取点用 `tDynamic(value, language, value)`
 * 解析。理由和 `McpDependency.installNoteKey` 一样：这张表是模块级常量，求值时
 * 还没有 `language`，而以前的办法是每个字段配一个 `xxxZh` —— 加一种语言要改数据
 * 结构，翻译也进不了 `localeParity` 的审。
 *
 * 代价是这些字段的类型上看不出装的是键还是散文：`McpAddServerModal` 从 registry
 * API 拿到的运行时预设会把服务器自己的描述原样放进 `description`。判别交给 locale
 * 表本身 —— `tDynamic` 先 `Object.hasOwn(en, key)`，命中才查表，否则原样返回。
 * 所以两条通路能共用同一个字段，不需要联合类型或额外的判别位。
 */

import {
  type McpPreset,
  type McpPresetCategory,
} from '@shared/types/mcp'
import { t, tDynamic, type Language, type TranslationKey } from '@shared/i18n'

/** 分类显示名称的 locale 键 */
export const MCP_CATEGORY_NAMES: Record<McpPresetCategory, TranslationKey> = {
  search: 'mcpPresets.category.search',
  database: 'mcpPresets.category.database',
  filesystem: 'mcpPresets.category.filesystem',
  development: 'mcpPresets.category.development',
  design: 'mcpPresets.category.design',
  productivity: 'mcpPresets.category.productivity',
  ai: 'mcpPresets.category.ai',
  cloud: 'mcpPresets.category.cloud',
  other: 'mcpPresets.category.other',
}

/** 内置 MCP 服务器预设 */
export const MCP_PRESETS: McpPreset[] = [
  // ===== 搜索类 =====
  {
    type: 'local',
    id: 'brave-search',
    name: 'Brave Search',
    description: 'mcpPresets.braveSearch.description',
    category: 'search',
    icon: 'Search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envConfig: [
      {
        key: 'BRAVE_API_KEY',
        label: 'mcpPresets.braveSearch.env.braveApiKey.label',
        description: 'mcpPresets.braveSearch.env.braveApiKey.description',
        required: true,
        secret: true,
        placeholder: 'BSA...',
      },
    ],
    defaultAutoApprove: ['brave_web_search', 'brave_local_search'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    official: true,
    tags: ['search', 'web'],
    usageExamples: ['mcpPresets.braveSearch.usage1', 'mcpPresets.braveSearch.usage2'],
  },
  {
    type: 'local',
    id: 'tavily-search',
    name: 'Tavily Search',
    description: 'mcpPresets.tavilySearch.description',
    category: 'search',
    icon: 'Sparkles',
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    envConfig: [
      {
        key: 'TAVILY_API_KEY',
        label: 'mcpPresets.tavilySearch.env.tavilyApiKey.label',
        description: 'mcpPresets.tavilySearch.env.tavilyApiKey.description',
        required: true,
        secret: true,
        placeholder: 'tvly-...',
      },
    ],
    defaultAutoApprove: ['tavily_search'],
    requiresConfig: true,
    docsUrl: 'https://github.com/tavily-ai/tavily-mcp',
    tags: ['search', 'ai', 'realtime'],
    usageExamples: ['mcpPresets.tavilySearch.usage1', 'mcpPresets.tavilySearch.usage2'],
  },
  {
    type: 'local',
    id: 'exa-search',
    name: 'Exa Search',
    description: 'mcpPresets.exaSearch.description',
    category: 'search',
    icon: 'Brain',
    command: 'npx',
    args: ['-y', 'exa-mcp-server'],
    envConfig: [
      {
        key: 'EXA_API_KEY',
        label: 'mcpPresets.exaSearch.env.exaApiKey.label',
        description: 'mcpPresets.exaSearch.env.exaApiKey.description',
        required: true,
        secret: true,
        placeholder: 'exa-...',
      },
    ],
    defaultAutoApprove: ['search', 'find_similar', 'get_contents'],
    requiresConfig: true,
    docsUrl: 'https://github.com/exa-labs/exa-mcp-server',
    tags: ['search', 'semantic', 'ai'],
    usageExamples: ['mcpPresets.exaSearch.usage1', 'mcpPresets.exaSearch.usage2'],
  },

  // ===== 数据库类 =====
  {
    type: 'local',
    id: 'sqlite',
    name: 'SQLite',
    description: 'mcpPresets.sqlite.description',
    category: 'database',
    icon: 'Database',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', '${DB_PATH}'],
    envConfig: [
      {
        key: 'DB_PATH',
        label: 'mcpPresets.sqlite.env.dbPath.label',
        description: 'mcpPresets.sqlite.env.dbPath.description',
        required: true,
        secret: false,
        placeholder: '/path/to/database.db',
      },
    ],
    defaultAutoApprove: ['read_query', 'list_tables', 'describe_table'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    official: true,
    tags: ['database', 'sql'],
    usageExamples: ['mcpPresets.sqlite.usage1', 'mcpPresets.sqlite.usage2', 'mcpPresets.sqlite.usage3'],
    dependencies: [
      { type: 'uv', installNoteKey: 'mcpPresets.installUv' },
    ],
  },
  {
    type: 'local',
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'mcpPresets.postgres.description',
    category: 'database',
    icon: 'Database',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    envConfig: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        label: 'mcpPresets.postgres.env.postgresConnectionString.label',
        description: 'mcpPresets.postgres.env.postgresConnectionString.description',
        required: true,
        secret: true,
        placeholder: 'postgresql://user:password@localhost:5432/dbname',
      },
    ],
    defaultAutoApprove: ['query'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    official: true,
    tags: ['database', 'sql'],
    usageExamples: ['mcpPresets.postgres.usage1', 'mcpPresets.postgres.usage2', 'mcpPresets.postgres.usage3'],
  },
  {
    type: 'local',
    id: 'mysql',
    name: 'MySQL',
    description: 'mcpPresets.mysql.description',
    category: 'database',
    icon: 'Database',
    command: 'npx',
    args: ['-y', '@benborber/mcp-server-mysql'],
    envConfig: [
      { key: 'MYSQL_HOST', label: 'mcpPresets.mysql.env.mysqlHost.label', required: true, secret: false, placeholder: 'localhost' },
      { key: 'MYSQL_PORT', label: 'mcpPresets.mysql.env.mysqlPort.label', required: false, secret: false, defaultValue: '3306' },
      { key: 'MYSQL_USER', label: 'mcpPresets.mysql.env.mysqlUser.label', required: true, secret: false },
      { key: 'MYSQL_PASSWORD', label: 'mcpPresets.mysql.env.mysqlPassword.label', required: true, secret: true },
      { key: 'MYSQL_DATABASE', label: 'mcpPresets.mysql.env.mysqlDatabase.label', required: true, secret: false },
    ],
    defaultAutoApprove: ['query', 'list_tables', 'describe_table'],
    requiresConfig: true,
    docsUrl: 'https://github.com/benborla/mcp-server-mysql',
    tags: ['database', 'sql', 'mysql'],
    usageExamples: ['mcpPresets.mysql.usage1', 'mcpPresets.mysql.usage2', 'mcpPresets.mysql.usage3'],
  },
  {
    type: 'local',
    id: 'mongodb',
    name: 'MongoDB',
    description: 'mcpPresets.mongodb.description',
    category: 'database',
    icon: 'Database',
    command: 'npx',
    args: ['-y', 'mcp-mongo-server'],
    envConfig: [
      {
        key: 'MONGODB_URI',
        label: 'mcpPresets.mongodb.env.mongodbUri.label',
        required: true,
        secret: true,
        placeholder: 'mongodb://localhost:27017/mydb',
      },
    ],
    defaultAutoApprove: ['find', 'listCollections', 'aggregate'],
    requiresConfig: true,
    docsUrl: 'https://github.com/kiliczsh/mcp-mongo-server',
    tags: ['database', 'nosql', 'mongodb'],
    usageExamples: ['mcpPresets.mongodb.usage1', 'mcpPresets.mongodb.usage2', 'mcpPresets.mongodb.usage3'],
  },

  // ===== 开发工具类 =====
  {
    type: 'local',
    id: 'github',
    name: 'GitHub',
    description: 'mcpPresets.github.description',
    category: 'development',
    icon: 'Github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envConfig: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'mcpPresets.github.env.githubPersonalAccessToken.label',
        description: 'mcpPresets.github.env.githubPersonalAccessToken.description',
        required: true,
        secret: true,
        placeholder: 'ghp_...',
      },
    ],
    defaultAutoApprove: ['search_repositories', 'get_file_contents', 'list_commits', 'search_code'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    official: true,
    tags: ['git', 'code', 'ci/cd'],
    usageExamples: ['mcpPresets.github.usage1', 'mcpPresets.github.usage2', 'mcpPresets.github.usage3'],
  },
  {
    type: 'local',
    id: 'gitlab',
    name: 'GitLab',
    description: 'mcpPresets.gitlab.description',
    category: 'development',
    icon: 'GitBranch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    envConfig: [
      { key: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'mcpPresets.gitlab.env.gitlabPersonalAccessToken.label', required: true, secret: true, placeholder: 'glpat-...' },
      { key: 'GITLAB_API_URL', label: 'mcpPresets.gitlab.env.gitlabApiUrl.label', required: false, secret: false, defaultValue: 'https://gitlab.com/api/v4' },
    ],
    defaultAutoApprove: ['search_repositories', 'get_file_contents'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
    official: true,
    tags: ['git', 'code', 'ci/cd'],
    usageExamples: ['mcpPresets.gitlab.usage1', 'mcpPresets.gitlab.usage2'],
  },
  {
    type: 'local',
    id: 'linear',
    name: 'Linear',
    description: 'mcpPresets.linear.description',
    category: 'development',
    icon: 'ListOrdered',
    command: 'npx',
    args: ['-y', 'mcp-linear'],
    envConfig: [
      { key: 'LINEAR_API_KEY', label: 'mcpPresets.linear.env.linearApiKey.label', required: true, secret: true, placeholder: 'lin_api_...' },
    ],
    defaultAutoApprove: ['list_issues', 'search_issues', 'get_issue'],
    requiresConfig: true,
    docsUrl: 'https://github.com/jerhadf/linear-mcp-server',
    tags: ['project', 'issues', 'agile'],
    usageExamples: ['mcpPresets.linear.usage1', 'mcpPresets.linear.usage2', 'mcpPresets.linear.usage3'],
  },
  {
    type: 'local',
    id: 'sentry',
    name: 'Sentry',
    description: 'mcpPresets.sentry.description',
    category: 'development',
    icon: 'AlertCircle',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server'],
    envConfig: [
      { key: 'SENTRY_AUTH_TOKEN', label: 'mcpPresets.sentry.env.sentryAuthToken.label', required: true, secret: true },
      { key: 'SENTRY_ORG', label: 'mcpPresets.sentry.env.sentryOrg.label', required: true, secret: false },
    ],
    defaultAutoApprove: ['list_issues', 'get_issue', 'search_issues'],
    requiresConfig: true,
    docsUrl: 'https://github.com/getsentry/sentry-mcp',
    tags: ['monitoring', 'errors', 'debugging'],
    usageExamples: ['mcpPresets.sentry.usage1', 'mcpPresets.sentry.usage2', 'mcpPresets.sentry.usage3'],
  },

  // ===== 云服务类 =====
  {
    type: 'local',
    id: 'aws-docs',
    name: 'AWS Documentation',
    description: 'mcpPresets.awsDocs.description',
    category: 'cloud',
    icon: 'Cloud',
    command: 'uvx',
    args: ['awslabs.aws-documentation-mcp-server@latest'],
    envConfig: [{ key: 'FASTMCP_LOG_LEVEL', label: 'mcpPresets.awsDocs.env.fastmcpLogLevel.label', required: false, secret: false, defaultValue: 'ERROR' }],
    defaultAutoApprove: ['search_documentation', 'read_documentation'],
    requiresConfig: false,
    docsUrl: 'https://github.com/awslabs/mcp',
    tags: ['aws', 'docs', 'cloud'],
    usageExamples: ['mcpPresets.awsDocs.usage1', 'mcpPresets.awsDocs.usage2', 'mcpPresets.awsDocs.usage3'],
  },
  {
    type: 'local',
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'mcpPresets.cloudflare.description',
    category: 'cloud',
    icon: 'Cloud',
    command: 'npx',
    args: ['-y', '@cloudflare/mcp-server-cloudflare'],
    envConfig: [
      { key: 'CLOUDFLARE_API_TOKEN', label: 'mcpPresets.cloudflare.env.cloudflareApiToken.label', required: true, secret: true },
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'mcpPresets.cloudflare.env.cloudflareAccountId.label', required: true, secret: false },
    ],
    defaultAutoApprove: ['list_workers', 'get_worker', 'kv_list'],
    requiresConfig: true,
    docsUrl: 'https://github.com/cloudflare/mcp-server-cloudflare',
    official: true,
    tags: ['cloudflare', 'serverless', 'edge'],
    usageExamples: ['mcpPresets.cloudflare.usage1', 'mcpPresets.cloudflare.usage2', 'mcpPresets.cloudflare.usage3'],
  },
  {
    type: 'local',
    id: 'vercel',
    name: 'Vercel',
    description: 'mcpPresets.vercel.description',
    category: 'cloud',
    icon: 'Cloud',
    command: 'npx',
    args: ['-y', 'mcp-server-vercel'],
    envConfig: [{ key: 'VERCEL_API_TOKEN', label: 'mcpPresets.vercel.env.vercelApiToken.label', required: true, secret: true }],
    defaultAutoApprove: ['list_projects', 'list_deployments', 'get_deployment'],
    requiresConfig: true,
    docsUrl: 'https://github.com/Vercel-MCP/mcp-server-vercel',
    tags: ['vercel', 'deployment', 'hosting'],
    usageExamples: ['mcpPresets.vercel.usage1', 'mcpPresets.vercel.usage2', 'mcpPresets.vercel.usage3'],
  },

  // ===== AI 服务类 =====
  {
    type: 'local',
    id: 'fetch',
    name: 'Fetch',
    description: 'mcpPresets.fetch.description',
    category: 'ai',
    icon: 'Globe',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    envConfig: [],
    defaultAutoApprove: ['fetch'],
    requiresConfig: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    official: true,
    tags: ['web', 'scraping', 'markdown'],
    usageExamples: ['mcpPresets.fetch.usage1', 'mcpPresets.fetch.usage2'],
    dependencies: [
      { type: 'uv', installNoteKey: 'mcpPresets.installUv' },
    ],
  },
  {
    type: 'local',
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'mcpPresets.puppeteer.description',
    category: 'ai',
    icon: 'Monitor',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    envConfig: [{ key: 'PUPPETEER_EXECUTABLE_PATH', label: 'mcpPresets.puppeteer.env.puppeteerExecutablePath.label', required: false, secret: false }],
    defaultAutoApprove: ['puppeteer_navigate', 'puppeteer_screenshot', 'puppeteer_evaluate'],
    requiresConfig: false,
    setupCommand: 'npx puppeteer browsers install chrome',
    setupNote: 'mcpPresets.puppeteer.setupNote',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    official: true,
    tags: ['browser', 'automation', 'screenshot'],
    usageExamples: ['mcpPresets.puppeteer.usage1', 'mcpPresets.puppeteer.usage2', 'mcpPresets.puppeteer.usage3'],
  },
  {
    type: 'local',
    id: 'playwright',
    name: 'Playwright',
    description: 'mcpPresets.playwright.description',
    category: 'ai',
    icon: 'Monitor',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    envConfig: [],
    defaultAutoApprove: ['browser_navigate', 'browser_screenshot', 'browser_click'],
    requiresConfig: false,
    setupCommand: 'npx playwright install',
    setupNote: 'mcpPresets.playwright.setupNote',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    official: true,
    tags: ['browser', 'automation', 'testing'],
    usageExamples: ['mcpPresets.playwright.usage1', 'mcpPresets.playwright.usage2', 'mcpPresets.playwright.usage3'],
  },

  // ===== 生产力类 =====
  {
    type: 'local',
    id: 'memory',
    name: 'Memory',
    description: 'mcpPresets.memory.description',
    category: 'productivity',
    icon: 'Brain',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    envConfig: [],
    defaultAutoApprove: ['create_entities', 'create_relations', 'read_graph', 'search_nodes'],
    requiresConfig: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    official: true,
    tags: ['memory', 'knowledge', 'context'],
    usageExamples: ['mcpPresets.memory.usage1', 'mcpPresets.memory.usage2', 'mcpPresets.memory.usage3'],
  },
  {
    type: 'local',
    id: 'notion',
    name: 'Notion',
    description: 'mcpPresets.notion.description',
    category: 'productivity',
    icon: 'FileText',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    envConfig: [
      { key: 'NOTION_API_KEY', label: 'mcpPresets.notion.env.notionApiKey.label', description: 'mcpPresets.notion.env.notionApiKey.description', required: true, secret: true, placeholder: 'secret_...' },
    ],
    defaultAutoApprove: ['search', 'get_page', 'get_database'],
    requiresConfig: true,
    docsUrl: 'https://github.com/makenotion/notion-mcp-server',
    official: true,
    tags: ['notion', 'docs', 'wiki'],
    usageExamples: ['mcpPresets.notion.usage1', 'mcpPresets.notion.usage2', 'mcpPresets.notion.usage3'],
  },
  {
    type: 'local',
    id: 'slack',
    name: 'Slack',
    description: 'mcpPresets.slack.description',
    category: 'productivity',
    icon: 'MessageSquare',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envConfig: [
      { key: 'SLACK_BOT_TOKEN', label: 'mcpPresets.slack.env.slackBotToken.label', description: 'mcpPresets.slack.env.slackBotToken.description', required: true, secret: true, placeholder: 'xoxb-...' },
      { key: 'SLACK_TEAM_ID', label: 'mcpPresets.slack.env.slackTeamId.label', required: true, secret: false, placeholder: 'T...' },
    ],
    defaultAutoApprove: ['list_channels', 'get_channel_history', 'search_messages'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    official: true,
    tags: ['slack', 'chat', 'team'],
    usageExamples: ['mcpPresets.slack.usage1', 'mcpPresets.slack.usage2', 'mcpPresets.slack.usage3'],
  },
  {
    type: 'local',
    id: 'google-drive',
    name: 'Google Drive',
    description: 'mcpPresets.googleDrive.description',
    category: 'productivity',
    icon: 'FolderOpen',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    envConfig: [
      { key: 'GDRIVE_CREDENTIALS_PATH', label: 'mcpPresets.googleDrive.env.gdriveCredentialsPath.label', description: 'mcpPresets.googleDrive.env.gdriveCredentialsPath.description', required: true, secret: false },
    ],
    defaultAutoApprove: ['search_files', 'read_file'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
    official: true,
    tags: ['google', 'drive', 'files'],
    usageExamples: ['mcpPresets.googleDrive.usage1', 'mcpPresets.googleDrive.usage2', 'mcpPresets.googleDrive.usage3'],
  },

  // ===== 设计工具类 =====
  {
    type: 'local',
    id: 'figma',
    name: 'Figma',
    description: 'mcpPresets.figma.description',
    category: 'design',
    icon: 'Figma',
    command: 'npx',
    args: ['-y', '@hapins/figma-mcp'],
    envConfig: [
      {
        key: 'FIGMA_ACCESS_TOKEN',
        label: 'mcpPresets.figma.env.figmaAccessToken.label',
        description: 'mcpPresets.figma.env.figmaAccessToken.description',
        required: true,
        secret: true,
        placeholder: 'figd_...',
      },
    ],
    defaultAutoApprove: ['get_file', 'get_node', 'get_component', 'get_style'],
    requiresConfig: true,
    docsUrl: 'https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens',
    tags: ['figma', 'design', 'ui', 'components', 'styles'],
    usageExamples: ['mcpPresets.figma.usage1', 'mcpPresets.figma.usage2', 'mcpPresets.figma.usage3'],
  },
  {
    type: 'remote',
    id: 'figma-desktop',
    name: 'Figma Desktop',
    description: 'mcpPresets.figmaDesktop.description',
    category: 'design',
    icon: 'Figma',
    url: 'http://127.0.0.1:3845/mcp',
    envConfig: [],
    defaultAutoApprove: ['get_file', 'get_node', 'get_local_variables', 'get_code_connect_map'],
    requiresConfig: false,
    docsUrl: 'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/',
    official: true,
    tags: ['figma', 'design', 'ui', 'desktop', 'local'],
    setupNote: 'mcpPresets.figmaDesktop.setupNote',
    usageExamples: ['mcpPresets.figmaDesktop.usage1', 'mcpPresets.figmaDesktop.usage2', 'mcpPresets.figmaDesktop.usage3'],
  },
  {
    type: 'local',
    id: 'context7',
    name: 'Context7',
    description: 'mcpPresets.context7.description',
    category: 'development',
    icon: 'BookOpen',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
    envConfig: [],
    defaultAutoApprove: ['resolve-library-id', 'get-library-docs'],
    requiresConfig: false,
    docsUrl: 'https://github.com/upstash/context7',
    tags: ['docs', 'library', 'documentation'],
    usageExamples: ['mcpPresets.context7.usage1', 'mcpPresets.context7.usage2', 'mcpPresets.context7.usage3'],
  },

  // ===== 推理增强 =====
  {
    type: 'local',
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'mcpPresets.sequentialThinking.description',
    category: 'ai',
    icon: 'Brain',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    envConfig: [],
    defaultAutoApprove: ['sequentialthinking'],
    requiresConfig: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    official: true,
    tags: ['reasoning', 'thinking', 'chain-of-thought'],
    usageExamples: ['mcpPresets.sequentialThinking.usage1', 'mcpPresets.sequentialThinking.usage2'],
  },

  // ===== 免费搜索 =====
  {
    type: 'local',
    id: 'duckduckgo',
    name: 'DuckDuckGo Search',
    description: 'mcpPresets.duckduckgo.description',
    category: 'search',
    icon: 'Search',
    command: 'uvx',
    args: ['duckduckgo-mcp-server'],
    envConfig: [],
    defaultAutoApprove: ['search'],
    requiresConfig: false,
    docsUrl: 'https://github.com/nickclyde/duckduckgo-mcp-server',
    tags: ['search', 'free', 'web'],
    usageExamples: ['mcpPresets.duckduckgo.usage1', 'mcpPresets.duckduckgo.usage2'],
    dependencies: [
      { type: 'uv', installNoteKey: 'mcpPresets.installUv' },
    ],
  },

  // ===== 时间工具 =====
  {
    type: 'local',
    id: 'time',
    name: 'Time',
    description: 'mcpPresets.time.description',
    category: 'other',
    icon: 'Clock',
    command: 'uvx',
    args: ['mcp-server-time', '--local-timezone', '${LOCAL_TIMEZONE}'],
    envConfig: [
      { key: 'LOCAL_TIMEZONE', label: 'mcpPresets.time.env.localTimezone.label', required: false, secret: false, defaultValue: 'Asia/Shanghai', placeholder: 'Asia/Shanghai' },
    ],
    defaultAutoApprove: ['get_current_time', 'convert_time'],
    requiresConfig: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    official: true,
    tags: ['time', 'timezone', 'utility'],
    usageExamples: ['mcpPresets.time.usage1', 'mcpPresets.time.usage2'],
    dependencies: [
      { type: 'uv', installNoteKey: 'mcpPresets.installUv' },
    ],
  },

  // ===== 数据库/后端 =====
  {
    type: 'local',
    id: 'supabase',
    name: 'Supabase',
    description: 'mcpPresets.supabase.description',
    category: 'database',
    icon: 'Database',
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase@latest', '--access-token', '${SUPABASE_ACCESS_TOKEN}'],
    envConfig: [
      { key: 'SUPABASE_ACCESS_TOKEN', label: 'mcpPresets.supabase.env.supabaseAccessToken.label', description: 'mcpPresets.supabase.env.supabaseAccessToken.description', required: true, secret: true },
    ],
    defaultAutoApprove: ['list_projects', 'list_tables', 'execute_sql'],
    requiresConfig: true,
    docsUrl: 'https://github.com/supabase-community/supabase-mcp',
    official: true,
    tags: ['supabase', 'database', 'backend', 'postgres'],
    usageExamples: ['mcpPresets.supabase.usage1', 'mcpPresets.supabase.usage2', 'mcpPresets.supabase.usage3'],
  },

  // ===== 项目管理 =====
  {
    type: 'local',
    id: 'jira',
    name: 'Jira',
    description: 'mcpPresets.jira.description',
    category: 'development',
    icon: 'ListOrdered',
    command: 'npx',
    args: ['-y', 'mcp-atlassian'],
    envConfig: [
      { key: 'JIRA_URL', label: 'mcpPresets.jira.env.jiraUrl.label', required: true, secret: false, placeholder: 'https://your-org.atlassian.net' },
      { key: 'JIRA_USERNAME', label: 'mcpPresets.jira.env.jiraUsername.label', required: true, secret: false, placeholder: 'you@company.com' },
      { key: 'JIRA_API_TOKEN', label: 'mcpPresets.jira.env.jiraApiToken.label', description: 'mcpPresets.jira.env.jiraApiToken.description', required: true, secret: true },
    ],
    defaultAutoApprove: ['list_issues', 'get_issue', 'search_issues'],
    requiresConfig: true,
    docsUrl: 'https://github.com/sooperset/mcp-atlassian',
    tags: ['jira', 'project', 'atlassian', 'issues'],
    usageExamples: ['mcpPresets.jira.usage1', 'mcpPresets.jira.usage2', 'mcpPresets.jira.usage3'],
  },

  // ===== 支付 =====
  {
    type: 'local',
    id: 'stripe',
    name: 'Stripe',
    description: 'mcpPresets.stripe.description',
    category: 'development',
    icon: 'Boxes',
    command: 'npx',
    args: ['-y', '@stripe/mcp', '--tools=all'],
    envConfig: [
      { key: 'STRIPE_SECRET_KEY', label: 'mcpPresets.stripe.env.stripeSecretKey.label', description: 'mcpPresets.stripe.env.stripeSecretKey.description', required: true, secret: true, placeholder: 'sk_...' },
    ],
    defaultAutoApprove: ['list_customers', 'list_products', 'list_invoices', 'retrieve_balance'],
    requiresConfig: true,
    docsUrl: 'https://github.com/stripe/agent-toolkit',
    official: true,
    tags: ['stripe', 'payment', 'billing'],
    usageExamples: ['mcpPresets.stripe.usage1', 'mcpPresets.stripe.usage2', 'mcpPresets.stripe.usage3'],
  },

  // ===== 文件系统类 =====
  {
    type: 'local',
    id: 'filesystem',
    name: 'Filesystem',
    description: 'mcpPresets.filesystem.description',
    category: 'filesystem',
    icon: 'FolderOpen',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${ALLOWED_PATH}'],
    envConfig: [
      { key: 'ALLOWED_PATH', label: 'mcpPresets.filesystem.env.allowedPath.label', description: 'mcpPresets.filesystem.env.allowedPath.description', required: true, secret: false, placeholder: '/path/to/directory' },
    ],
    defaultAutoApprove: ['read_file', 'read_multiple_files', 'list_directory', 'directory_tree', 'search_files', 'get_file_info'],
    requiresConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    official: true,
    tags: ['files', 'local', 'sandbox'],
    usageExamples: ['mcpPresets.filesystem.usage1', 'mcpPresets.filesystem.usage2', 'mcpPresets.filesystem.usage3'],
  },
]

/**
 * 搜索预设。
 *
 * 只匹配当前语言的描述（以前 `description` 和 `descriptionZh` 是同时匹配的）：
 * 文案搬进 locale 表之后，一个预设在一次渲染里只有一条描述。和设置搜索
 * （`settingsSearchIndex.ts`）保持同一个语义，`tags` 仍然是英文的，所以英文词在
 * 中文界面下照样能命中。
 */
export function searchPresets(query: string, language: Language): McpPreset[] {
  const lowerQuery = query.toLowerCase()
  return MCP_PRESETS.filter(p =>
    p.name.toLowerCase().includes(lowerQuery) ||
    tDynamic(p.description, language, p.description).toLowerCase().includes(lowerQuery) ||
    p.tags?.some(t => t.toLowerCase().includes(lowerQuery))
  )
}

/**
 * 预设声明的运行时依赖提示（"装 uv"这类）。
 *
 * 只出提示，不去探测机器上装没装：探测要在渲染进程里拉一条 shell 通道跑 `uvx --version`，
 * 那是另一件事（要过安全审批、要处理超时和 PATH 差异）。四个 Python 预设跑不起来时，
 * 用户需要的信息就是这一句话，先无条件给出来。
 */
export function getPresetDependencyNotes(preset: McpPreset, language: Language): string[] {
  return (preset.dependencies ?? [])
    .map(dependency => dependency.installNoteKey)
    .filter((key): key is TranslationKey => Boolean(key))
    .map(key => t(key, language))
}
