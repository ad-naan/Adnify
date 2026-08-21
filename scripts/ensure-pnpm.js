#!/usr/bin/env node
/**
 * Fail fast if install is not driven by pnpm.
 * Prefer this over `npx only-allow` so the check works offline and in CI
 * before any package has been fetched.
 */
'use strict';

const userAgent = process.env.npm_config_user_agent || '';
const execPath = process.env.npm_execpath || '';
const isPnpm =
  /\bpnpm\//.test(userAgent) ||
  /[/\\]pnpm[/\\]/.test(execPath) ||
  /[/\\]pnpm$/.test(execPath) ||
  /[/\\]pnpx$/.test(execPath);

if (!isPnpm) {
  console.error(`
This repository requires pnpm (see package.json "packageManager").

  corepack enable
  pnpm install

Do not use npm or yarn.
`);
  process.exit(1);
}
