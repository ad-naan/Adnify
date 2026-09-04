# Security alert remediation — 2026-09-04

The GitHub API reported 8 open Dependabot alerts and 125 open code-scanning alerts on `master` at commit `dd6d3030795e2c83d1882c52ef44cb0a1ab3252d`. Code scanning comprised 8 CodeQL findings and 117 ESLint findings. This document records local remediation; remote alert closure requires publishing the changes and completing GitHub's scans.

## Dependencies

| Dependabot alerts | Package | Locked version after remediation | Status |
| --- | --- | --- | --- |
| #176, #177, #180, #181 | `fast-uri` | 3.1.7 | Outside all four reported vulnerable ranges; override requires at least 3.1.6. |
| #178 | `@xmldom/xmldom` | 0.8.15 | Outside the reported vulnerable range. |
| #174 | `browserslist` | 4.28.8 | Outside the reported vulnerable range; override requires at least 4.28.7. |
| #172, #173 | `extract-zip` | 2.0.1, repository patch applied | Upstream has no patched release for GHSA-jmr9-qjv8-65gv. The existing patch rejects out-of-root symlink targets. Added tests cover traversal, absolute targets, and preservation of internal relative links. |

The `extract-zip` patch is applied through `pnpm-workspace.yaml` and its hash is recorded in `pnpm-lock.yaml`. These two alerts will remain version matches even with the patch installed. Do not remove the patch or label these alerts as fixed by an upstream upgrade. If closing them manually, record the repository patch and regression-test evidence in the dismissal explanation; review again when an upstream fix is published.

All six upgradeable alerts were checked against the complete package-version inventory in the new lockfile using the vulnerable ranges returned by GitHub. The npm bulk advisory endpoint timed out through both `pnpm audit` and a direct request, so this is not a claim that a fresh full-registry audit returned zero findings.

## Code scanning

| CodeQL alerts | Remediation |
| --- | --- |
| #182 | Execute `vswhere.exe` with argument separation. Invoke `cmd.exe` with fixed command text, validated environment values and delayed expansion disabled. Test real Windows batch execution with spaces, ampersands, percent signs and exclamation marks in the installation path. |
| #173 | Detect a script opening tag for the development warning without requiring a particular closing-tag syntax. DOMPurify remains the HTML sanitizer. |
| #168–#172 | Replace regex-based HTML/XML tag removal with `htmlparser2` text extraction. Test malformed closing tags, quoted angle brackets, comments, CDATA, entity handling and hidden script/style contents. Extracted output is plain text, not sanitized HTML. |
| #21 | Escape every regex metacharacter in root-marker patterns before expanding the supported `*` wildcard. |

ESLint configuration now lives in `.eslintrc.cjs` and is reused by the scanning workflow. The workflow installs the missing React Hooks rule provider and treats CommonJS build scripts as CommonJS. Findings were addressed with constant declarations, explicit callback types, imports, cleanup explanations and equivalent loop syntax. Intentional terminal/control-character patterns, ambient global declarations and required lazy native-module loads have narrowly scoped explanations. Remote-directory single-quote escaping was also corrected.

The CodeQL source locations have been changed, but closure has not yet been verified by a new GitHub CodeQL run. No remote alerts were dismissed during this work.

## Validation

- ESLint: zero errors and warnings across the repository using the workflow configuration.
- Frontend/shared/tests: `node node_modules/typescript/bin/tsc --noEmit` passed.
- Main process: `node node_modules/typescript/bin/tsc -p tsconfig.main.json --noEmit` passed.
- Full test suite: `pnpm test --maxWorkers=4` — 1,434 passed, 7 skipped.
- Production build: `pnpm build` passed.
- `git diff --check` passed.

An initial full test run concurrent with the production build hit the existing 5-second file-pagination test limit. The full suite passed with four workers after the build completed; no test timeout was increased.
