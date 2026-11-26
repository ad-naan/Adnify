<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="public/brand/logos/app-light.png" />
    <img src="public/brand/logos/app.png" alt="Adnify" width="156" />
  </picture>
  <h1>Adnify</h1>
  <p><a href="README_CN.md">中文</a> | <a href="README.md">English</a> | <a href="README_JA.md">日本語</a> | <a href="README_KO.md">한국어</a> | <a href="README_ES.md">Español</a> | <a href="README_FR.md">Français</a> | <a href="README_DE.md">Deutsch</a> | <strong>Português (Brasil)</strong> | <a href="README_RU.md">Русский</a></p>
  <p><strong>Conecte a IA ao seu código.</strong></p>
</div>

O Adnify reúne edição de código, execução com IA, geração de recursos e verificação no navegador em um ambiente de desenvolvimento para desktop. Use o Agent Mode para implementar diretamente ou o Plan Mode para revisar requisitos e dependências antes da execução.

> Esta versão em português do Brasil apresenta o produto e os primeiros passos. Consulte as versões em [inglês](README.md) ou [chinês](README_CN.md) para os detalhes completos, a arquitetura e a lista de colaboradores e apoiadores. A tradução do README não significa que a interface do aplicativo esteja disponível neste idioma.

![Demonstração do Adnify](images/main.gif)

## Principais recursos

- **Agent Mode**: faça perguntas, investigue o código, edite arquivos, execute comandos e verifique resultados na mesma tarefa. Permissões, visualização de diferenças e checkpoints permitem revisar as alterações.
- **Plan Mode**: revisão de requisitos → revisão do plano → central de execução → revisão de resultados. Inclui dependências, modelos por tarefa, execução paralela e conversas de trabalho isoladas.
- **Edição de código**: Monaco Editor, LSP para várias linguagens, sugestões de IA, edição em linha, depurador e integração com Git.
- **Geração de recursos**: conecte APIs HTTP JSON para imagens, vídeo, áudio e arquivos; gere recursos durante uma tarefa e reutilize-os pela biblioteca.
- **Verificação no navegador**: interaja com páginas, inspecione DOM, estilos, console e rede, capture telas e confira visualizações de celulares e tablets.
- **Gerenciamento de execução**: administre comandos e serviços em segundo plano de várias janelas, logs, filas e limites de recursos.
- **Notificações e extensões**: notificações do sistema, webhooks, Skills, MCP e memória do projeto.
- **Temas**: Adnify Dark, Midnight, Cyberpunk e Dawn.

## Início rápido

Você precisa de Node.js **24.x a partir de 24.19.0** (`^24.19.0`), pnpm **11.22.0** e Git. Node 22 e versões 25 ou superiores estão fora da faixa suportada. Python só é necessário para compilar módulos nativos a partir do código-fonte.

```bash
git clone https://github.com/ad-naan/adnify.git
cd adnify
```

Após clonar o repositório, selecione a versão indicada do Node com `nvm use`, `fnm use` ou `mise install`. Em seguida, execute:

```bash
corepack enable
pnpm install
pnpm dev
```

Execute `pnpm dist` para gerar os instaladores em `release/`. Se o Electron exibir `failed to install correctly`, remova `node_modules/electron` e execute `pnpm install` novamente com uma versão compatível do Node.

## Configurar modelos de IA

1. Abra as configurações com `Ctrl+,` e selecione a aba Provider.
2. Escolha um provedor e informe a chave de API necessária.
3. Selecione um modelo e salve.

Há suporte a OpenAI, Anthropic, Google, DeepSeek, Ollama e APIs compatíveis com OpenAI. Use `@` para adicionar arquivos ou `@codebase`, `@git`, `@terminal`, `@symbols` e `@web` ao contexto. Selecione um trecho de código e pressione `Ctrl+K` para solicitar uma edição em linha.

## Usar o Plan Mode

1. Descreva o objetivo e confirme os requisitos e critérios de aceitação.
2. Revise dependências, entregáveis, paralelismo, funções e modelos.
3. Aprove o plano e acompanhe o progresso e as solicitações de autorização no TaskBoard. Pause ou retome quando necessário.
4. Revise o resultado e aceite ou solicite alterações.

![Plan Mode](images/orchestrator.png)

## Arquitetura e tecnologias

O projeto usa Electron, React, TypeScript e Vite. `src/renderer` contém a interface e a execução do Agent; `src/main`, os recursos privilegiados e serviços; `src/shared`, os tipos e configurações comuns. Indexação, armazenamento de sessões e recursos e processamento de conteúdo são executados em processos de serviço isolados.

## Documentação

Os documentos técnicos a seguir estão disponíveis no idioma original.

- [Histórico de alterações](CHANGELOG.md)
- [Isolamento de processos](docs/process-isolation.md)
- [APIs de geração de recursos](docs/asset-capabilities.md)
- [Prévia do navegador](docs/browser-preview.md)
- [Notificações](docs/notifications.md)
- [Tarefas em segundo plano](docs/background-tasks.md)
- [Diagnóstico de desempenho](docs/performance-diagnostics.md)
- [Execução paralela com worktrees](docs/worktree-lane-architecture.md)
- [Recursos de marca](public/brand/README.md)

## Comunidade e contribuições

Envie bugs e sugestões para [GitHub Issues](https://github.com/ad-naan/adnify/issues) ou [Gitee Issues](https://gitee.com/adnaan/adnify/issues). Contribuições de código e tradução são bem-vindas: consulte o [guia de contribuição](CONTRIBUTING.md) e o [código de conduta](CODE_OF_CONDUCT.md). Para problemas de segurança, siga [SECURITY.md](SECURITY.md).

## Licença

O Adnify usa uma licença personalizada. Consulte as condições em [LICENSE](LICENSE). O uso comercial exige autorização prévia por escrito do autor. Contato: adnaan.worker@gmail.com.

