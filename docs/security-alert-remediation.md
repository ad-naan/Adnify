# Security alert remediation — 2026-09-04

The GitHub API reported 8 open Dependabot alerts and 125 open code-scanning alerts on `master` at commit `dd6d3030795e2c83d1882c52ef44cb0a1ab3252d`. Code scanning comprised 8 CodeQL findings and 117 ESLint findings. This document records local remediation; remote alert closure requires publishing the changes and completing GitHub's scans.

A follow-up API check on the same date confirmed zero open code-scanning alerts and only Dependabot #172 and #173 remaining. The extractor replacement below addresses those final two dependency entries; its remote closure still requires publishing this follow-up.

## Dependencies

| Dependabot alerts | Package | Locked version after remediation | Status |
| --- | --- | --- | --- |
| #176, #177, #180, #181 | `fast-uri` | 3.1.7 | Outside all four reported vulnerable ranges; override requires at least 3.1.6. |
| #178 | `@xmldom/xmldom` | 0.8.15 | Outside the reported vulnerable range. |
| #174 | `browserslist` | 4.28.8 | Outside the reported vulnerable range; override requires at least 4.28.7. |
| #172, #173 | `extract-zip` | Removed; replaced with `@electron-internal/extract-zip` 1.0.5 | Backport Electron's official installer migration to the currently locked Electron 39.8.10 runtime. The vulnerable package is absent from both the direct dependencies and the resolved lockfile graph. |

The old package has no patched release for [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv). The original repository patch mitigated traversal but could not clear version-based alerts. This follow-up replaces the implementation using [Electron's official migration](https://releases.electronjs.org/pr/51886): `patches/electron@39.8.10.patch` changes the installer import, while `pnpm-workspace.yaml` removes the old transitive dependency and supplies the new one. The obsolete `extract-zip` patch is removed. No dismissal is needed for this approach.

Electron is pinned to its previously locked version, 39.8.10, so the runtime does not change. Keep that pin, the version-specific override, package extension and installer patch aligned when upgrading; remove the backport when moving to an Electron release that already uses the new extractor. The replacement requires Node >=22.12, which the project's Node 24.19 requirement satisfies. Its use is limited to the existing checksum-verified Electron distribution download, consistent with the [extractor's supported scope](https://github.com/electron/extract-zip/blob/main/SECURITY.md).

All six upgradeable alerts were checked against the complete package-version inventory in the new lockfile using the vulnerable ranges returned by GitHub. The npm bulk advisory endpoint timed out through both `pnpm audit` and a direct request, so this is not a claim that a fresh full-registry audit returned zero findings.

## Code scanning

| CodeQL alerts | Remediation |
| --- | --- |
| #182 | Execute `vswhere.exe` with argument separation. Invoke `cmd.exe` with fixed command text, validated environment values and delayed expansion disabled. Test real Windows batch execution with spaces, ampersands, percent signs and exclamation marks in the installation path. |
| #173 | Detect a script opening tag for the development warning without requiring a particular closing-tag syntax. DOMPurify remains the HTML sanitizer. |
| #168–#172 | Replace regex-based HTML/XML tag removal with `htmlparser2` text extraction. Test malformed closing tags, quoted angle brackets, comments, CDATA, entity handling and hidden script/style contents. Extracted output is plain text, not sanitized HTML. |
| #21 | Escape every regex metacharacter in root-marker patterns before expanding the supported `*` wildcard. |

ESLint configuration now lives in `.eslintrc.cjs` and is reused by the scanning workflow. The workflow installs the missing React Hooks rule provider and treats CommonJS build scripts as CommonJS. Findings were addressed with constant declarations, explicit callback types, imports, cleanup explanations and equivalent loop syntax. Intentional terminal/control-character patterns, ambient global declarations and required lazy native-module loads have narrowly scoped explanations. Remote-directory single-quote escaping was also corrected.

The follow-up GitHub API check confirmed all code-scanning alerts closed. No remote alerts were dismissed during this work.

## Validation

- ESLint: zero errors and warnings across the repository using the workflow configuration.
- Frontend/shared/tests: `node node_modules/typescript/bin/tsc --noEmit` passed.
- Main process: `node node_modules/typescript/bin/tsc -p tsconfig.main.json --noEmit` passed.
- Full test suite after extractor replacement: `pnpm test --maxWorkers=4` — 1,435 passed, 8 skipped. The additional Windows skip requires symlink privileges; Linux CI exercises real internal symlink extraction. Traversal, absolute paths, symlink-chain escape and ordinary file extraction passed locally.
- `pnpm install --frozen-lockfile --ignore-scripts --offline` passed. The patched `node node_modules/electron/install.js` then successfully installed the real Electron 39.8.10 Windows distribution using the new extractor.
- Parsed lockfile package/snapshot entries and dependency edges contain no `extract-zip`; its old module is no longer resolvable. The installer resolves the replacement's named `extract` export correctly.
- Production build: `pnpm build` passed.
- `git diff --check` passed.

An initial full test run concurrent with the production build hit the existing 5-second file-pagination test limit. The full suite passed with four workers after the build completed; no test timeout was increased.
