<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="public/brand/logos/app-light.png" />
    <img src="public/brand/logos/app.png" alt="Adnify" width="156" />
  </picture>
  <h1>Adnify</h1>
  <p><a href="README_CN.md">中文</a> | <a href="README.md">English</a> | <a href="README_JA.md">日本語</a> | <a href="README_KO.md">한국어</a> | <a href="README_ES.md">Español</a> | <a href="README_FR.md">Français</a> | <strong>Deutsch</strong> | <a href="README_PT_BR.md">Português (Brasil)</a> | <a href="README_RU.md">Русский</a></p>
  <p><strong>Verbinde KI mit deinem Code.</strong></p>
</div>

Adnify vereint Codebearbeitung, KI-Ausführung, Mediengenerierung und Browserprüfung in einer Desktop-Entwicklungsumgebung. Mit Agent Mode setzt du Änderungen direkt um; mit Plan Mode prüfst du Anforderungen und Abhängigkeiten vor der Ausführung.

> Diese deutsche Fassung bietet einen Produktüberblick und eine Anleitung für den Einstieg. Ausführliche Funktionen, Architektur und die Liste der Mitwirkenden und Unterstützer findest du in der [englischen](README.md) oder [chinesischen](README_CN.md) Fassung. Die Übersetzung der README bedeutet nicht, dass die Benutzeroberfläche diese Sprache unterstützt.

![Adnify in Aktion](images/main.gif)

## Wichtigste Funktionen

- **Agent Mode**: Stelle Fragen, untersuche Code, bearbeite Dateien, führe Befehle aus und prüfe Ergebnisse innerhalb einer Aufgabe. Berechtigungen, Änderungsansichten und Checkpoints machen Änderungen nachvollziehbar.
- **Plan Mode**: Anforderungsprüfung → Planprüfung → Ausführungszentrum → Ergebnisprüfung. Mit Abhängigkeiten, Modellauswahl pro Aufgabe, paralleler Ausführung und isolierten Aufgabenthreads.
- **Codebearbeitung**: Monaco Editor, LSP für mehrere Sprachen, KI-Vervollständigung, Inline-Bearbeitung, Debugger und Git-Integration.
- **Mediengenerierung**: Verbinde HTTP-JSON-APIs für Bilder, Video, Audio und Dateien. Erzeuge Inhalte innerhalb einer Aufgabe und verwende sie über die Bibliothek erneut.
- **Browserprüfung**: Bediene Seiten, untersuche DOM, Stile, Konsole und Netzwerk, erstelle Screenshots und prüfe Ansichten für Smartphones und Tablets.
- **Ausführungsverwaltung**: Verwalte Befehle und Hintergrunddienste über mehrere Fenster hinweg, einschließlich Protokollen, Warteschlangen und Ressourcenlimits.
- **Benachrichtigungen und Erweiterungen**: Systembenachrichtigungen, Webhooks, Skills, MCP und Projektwissen.
- **Designs**: Adnify Dark, Midnight, Cyberpunk und Dawn.

## Schnellstart

Benötigt werden Node.js **24.x ab 24.19.0** (`^24.19.0`), pnpm **11.22.0** und Git. Node 22 sowie Versionen ab 25 liegen außerhalb des unterstützten Bereichs. Python ist nur erforderlich, wenn native Module aus dem Quellcode kompiliert werden müssen.

```bash
git clone https://github.com/ad-naan/adnify.git
cd adnify
```

Aktiviere nach dem Klonen die vorgegebene Node-Version mit `nvm use`, `fnm use` oder `mise install`. Führe anschließend Folgendes aus:

```bash
corepack enable
pnpm install
pnpm dev
```

Mit `pnpm dist` erstellst du Installationspakete im Verzeichnis `release/`. Meldet Electron `failed to install correctly`, entferne `node_modules/electron` und führe mit einer unterstützten Node-Version erneut `pnpm install` aus.

## KI-Modelle einrichten

1. Öffne die Einstellungen mit `Ctrl+,` und wähle den Tab Provider.
2. Wähle einen Anbieter und trage den benötigten API-Schlüssel ein.
3. Wähle ein Modell und speichere die Einstellungen.

Unterstützt werden OpenAI, Anthropic, Google, DeepSeek, Ollama und OpenAI-kompatible APIs. Mit `@` kannst du Dateien oder `@codebase`, `@git`, `@terminal`, `@symbols` und `@web` als Kontext hinzufügen. Markiere Code und drücke `Ctrl+K` für eine Inline-Bearbeitung.

## Plan Mode verwenden

1. Beschreibe das Ziel und bestätige Anforderungen und Abnahmekriterien.
2. Prüfe Abhängigkeiten, Arbeitsergebnisse, Parallelität, Rollen und Modelle.
3. Genehmige den Plan und verfolge Fortschritt und Berechtigungsanfragen im TaskBoard. Pausiere oder setze die Ausführung bei Bedarf fort.
4. Prüfe das Ergebnis und akzeptiere es oder fordere Änderungen an.

![Plan Mode](images/orchestrator.png)

## Architektur und Technologien

Das Projekt verwendet Electron, React, TypeScript und Vite. `src/renderer` enthält die Oberfläche und Agent-Ausführung, `src/main` die privilegierten Funktionen und Dienste und `src/shared` gemeinsame Typen und Konfigurationen. Indexierung, Sitzungs- und Medienspeicherung sowie Inhaltsverarbeitung laufen in isolierten Dienstprozessen.

## Dokumentation

Die folgenden technischen Dokumente sind in ihrer Originalsprache verfügbar.

- [Änderungsverlauf](CHANGELOG.md)
- [Prozessisolierung](docs/process-isolation.md)
- [APIs zur Mediengenerierung](docs/asset-capabilities.md)
- [Browservorschau](docs/browser-preview.md)
- [Benachrichtigungen](docs/notifications.md)
- [Hintergrundaufgaben](docs/background-tasks.md)
- [Leistungsdiagnose](docs/performance-diagnostics.md)
- [Parallele Ausführung mit Worktrees](docs/worktree-lane-architecture.md)
- [Markenressourcen](public/brand/README.md)

## Community und Beiträge

Melde Fehler und Vorschläge über [GitHub Issues](https://github.com/ad-naan/adnify/issues) oder [Gitee Issues](https://gitee.com/adnaan/adnify/issues). Beiträge zu Code und Übersetzungen sind willkommen. Beachte den [Beitragsleitfaden](CONTRIBUTING.md) und den [Verhaltenskodex](CODE_OF_CONDUCT.md). Melde Sicherheitsprobleme gemäß [SECURITY.md](SECURITY.md).

## Lizenz

Adnify verwendet eine eigene Lizenz. Die Bedingungen stehen in [LICENSE](LICENSE). Kommerzielle Nutzung erfordert die vorherige schriftliche Genehmigung des Autors. Kontakt: adnaan.worker@gmail.com.

