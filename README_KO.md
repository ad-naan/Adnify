<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="public/brand/logos/app-light.png" />
    <img src="public/brand/logos/app.png" alt="Adnify" width="156" />
  </picture>
  <h1>Adnify</h1>
  <p><a href="README_CN.md">中文</a> | <a href="README.md">English</a> | <a href="README_JA.md">日本語</a> | <strong>한국어</strong> | <a href="README_ES.md">Español</a> | <a href="README_FR.md">Français</a> | <a href="README_DE.md">Deutsch</a> | <a href="README_PT_BR.md">Português (Brasil)</a> | <a href="README_RU.md">Русский</a></p>
  <p><strong>AI를 코드에 연결하세요.</strong></p>
</div>

Adnify는 코드 편집, AI 실행, 에셋 생성, 브라우저 검증을 하나로 통합한 데스크톱 개발 환경입니다. Agent Mode로 바로 구현하거나 Plan Mode에서 요구 사항과 작업 의존성을 검토한 뒤 실행할 수 있습니다.

> 이 한국어 버전은 제품 소개와 시작 가이드입니다. 자세한 기능, 아키텍처, 후원자 목록은 [영어 버전](README.md) 또는 [중국어 버전](README_CN.md)을 참고하세요. README 번역이 앱 인터페이스의 해당 언어 지원을 의미하지는 않습니다.

![Adnify 실행 화면](images/main.gif)

## 주요 기능

- **Agent Mode**: 질문, 코드 조사, 파일 편집, 명령 실행과 검증을 같은 작업에서 수행합니다. 권한 관리, 변경 비교, 체크포인트로 작업을 검토할 수 있습니다.
- **Plan Mode**: 요구 사항 검토 → 계획 검토 → 실행 센터 → 결과 검토. 의존성, 작업별 모델 선택, 병렬 실행, 분리된 작업 스레드를 지원합니다.
- **코드 편집**: Monaco Editor, 다국어 LSP, AI 자동 완성, 인라인 편집, 디버거와 Git 통합을 제공합니다.
- **에셋 생성**: 이미지·영상·오디오·파일용 HTTP JSON API를 연결하고 작업 중 생성한 결과를 라이브러리에서 재사용합니다.
- **브라우저 검증**: 페이지 조작, DOM·스타일·콘솔·네트워크 점검, 스크린샷, 휴대폰과 태블릿 화면 미리보기를 지원합니다.
- **실행 관리**: 여러 창의 명령, 백그라운드 서비스, 로그, 대기열과 리소스 한도를 관리합니다.
- **알림과 확장**: 시스템 알림, Webhook, Skills, MCP와 프로젝트 메모리를 지원합니다.
- **테마**: Adnify Dark, Midnight, Cyberpunk, Dawn의 네 가지 테마를 제공합니다.

## 빠른 시작

Node.js **24.19.0 이상의 24.x**(`^24.19.0`), pnpm **11.22.0**, Git이 필요합니다. Node 22와 25 이상은 지원 범위에 포함되지 않습니다. Python은 네이티브 확장을 소스에서 빌드할 때만 필요합니다.

```bash
git clone https://github.com/ad-naan/adnify.git
cd adnify
```

저장소를 복제한 뒤 `nvm use`, `fnm use` 또는 `mise install`로 지정된 Node 버전을 사용하세요. 이어서 다음 명령을 실행합니다.

```bash
corepack enable
pnpm install
pnpm dev
```

설치 패키지는 `pnpm dist`로 만들며 결과는 `release/`에 저장됩니다. Electron에서 `failed to install correctly` 오류가 발생하면 지원되는 Node 환경에서 `node_modules/electron`을 삭제하고 `pnpm install`을 다시 실행하세요.

## AI 모델 설정

1. `Ctrl+,`로 설정을 열고 Provider 탭을 선택합니다.
2. 공급자를 선택하고 필요한 API 키를 입력합니다.
3. 모델을 선택하고 저장합니다.

OpenAI, Anthropic, Google, DeepSeek, Ollama 및 OpenAI 호환 API를 지원합니다. `@`로 파일이나 `@codebase`, `@git`, `@terminal`, `@symbols`, `@web`을 참조할 수 있습니다. 코드를 선택한 뒤 `Ctrl+K`로 인라인 편집을 요청하세요.

## Plan Mode 사용

1. 목표를 설명하고 요구 사항과 완료 기준을 확인합니다.
2. 작업 의존성, 결과물, 병렬 실행, 역할과 모델을 검토합니다.
3. 계획을 승인하고 TaskBoard에서 진행 상황과 도구 승인 요청을 확인합니다. 필요하면 일시 정지하거나 재개합니다.
4. 결과를 검토한 뒤 수락하거나 수정을 요청합니다.

![Plan Mode](images/orchestrator.png)

## 아키텍처와 기술 스택

Electron, React, TypeScript, Vite를 사용합니다. `src/renderer`는 UI와 Agent 실행을, `src/main`은 권한이 필요한 기능과 서비스를, `src/shared`는 공통 타입과 설정을 담당합니다. 인덱싱, 세션 저장, 에셋 저장과 콘텐츠 처리는 분리된 서비스 프로세스에서 수행합니다.

## 문서

아래 기술 문서는 원문으로 제공됩니다.

- [변경 이력](CHANGELOG.md)
- [프로세스 격리](docs/process-isolation.md)
- [에셋 생성 API](docs/asset-capabilities.md)
- [브라우저 미리보기](docs/browser-preview.md)
- [알림](docs/notifications.md)
- [백그라운드 작업](docs/background-tasks.md)
- [성능 진단](docs/performance-diagnostics.md)
- [Worktree 병렬 실행](docs/worktree-lane-architecture.md)
- [브랜드 에셋](public/brand/README.md)

## 커뮤니티와 기여

버그와 제안은 [GitHub Issues](https://github.com/ad-naan/adnify/issues) 또는 [Gitee Issues](https://gitee.com/adnaan/adnify/issues)에 등록하세요. 코드와 번역 기여를 환영합니다. [기여 가이드](CONTRIBUTING.md)와 [행동 강령](CODE_OF_CONDUCT.md)을 참고하세요. 보안 문제는 [SECURITY.md](SECURITY.md)의 절차에 따라 신고하세요.

## 라이선스

Adnify는 사용자 정의 라이선스를 사용합니다. 이용 조건은 [LICENSE](LICENSE)를 확인하세요. 상업적 사용에는 저자의 사전 서면 허가가 필요합니다. 문의: adnaan.worker@gmail.com.

