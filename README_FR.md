<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="public/brand/logos/app-light.png" />
    <img src="public/brand/logos/app.png" alt="Adnify" width="156" />
  </picture>
  <h1>Adnify</h1>
  <p><a href="README_CN.md">中文</a> | <a href="README.md">English</a> | <a href="README_JA.md">日本語</a> | <a href="README_KO.md">한국어</a> | <a href="README_ES.md">Español</a> | <strong>Français</strong> | <a href="README_DE.md">Deutsch</a> | <a href="README_PT_BR.md">Português (Brasil)</a> | <a href="README_RU.md">Русский</a></p>
  <p><strong>Connectez l’IA à votre code.</strong></p>
</div>

Adnify réunit l’édition de code, l’exécution par IA, la génération de ressources et la vérification dans le navigateur au sein d’un environnement de développement de bureau. Utilisez Agent Mode pour réaliser directement vos modifications, ou Plan Mode pour examiner les besoins et les dépendances avant l’exécution.

> Cette version française présente le produit et sa prise en main. Consultez les versions [anglaise](README.md) ou [chinoise](README_CN.md) pour les détails complets, l’architecture et la liste des contributeurs et soutiens. La traduction du README ne signifie pas que l’interface de l’application est disponible dans cette langue.

![Démonstration d’Adnify](images/main.gif)

## Fonctionnalités principales

- **Agent Mode** : posez des questions, explorez le code, modifiez des fichiers, lancez des commandes et vérifiez les résultats dans une même tâche. Les permissions, les différences et les points de contrôle facilitent la revue des changements.
- **Plan Mode** : revue des besoins → revue du plan → centre d’exécution → revue des résultats. Gestion des dépendances, choix du modèle par tâche, exécution parallèle et fils de travail isolés.
- **Édition de code** : Monaco Editor, LSP multilangage, complétion par IA, édition intégrée, débogueur et intégration Git.
- **Génération de ressources** : connectez des API HTTP JSON pour les images, vidéos, fichiers audio et autres fichiers ; générez les ressources dans une tâche et réutilisez-les depuis la bibliothèque.
- **Vérification dans le navigateur** : interagissez avec les pages, examinez le DOM, les styles, la console et le réseau, prenez des captures et testez les vues téléphone et tablette.
- **Gestion de l’exécution** : gérez les commandes et services en arrière-plan de plusieurs fenêtres, les journaux, les files d’attente et les limites de ressources.
- **Notifications et extensions** : notifications système, webhooks, Skills, MCP et mémoire du projet.
- **Thèmes** : Adnify Dark, Midnight, Cyberpunk et Dawn.

## Démarrage rapide

Prérequis : Node.js **24.x à partir de 24.19.0** (`^24.19.0`), pnpm **11.22.0** et Git. Node 22 et les versions 25 ou ultérieures ne sont pas pris en charge. Python n’est nécessaire que pour compiler les modules natifs depuis leurs sources.

```bash
git clone https://github.com/ad-naan/adnify.git
cd adnify
```

Après avoir cloné le dépôt, activez la version de Node indiquée avec `nvm use`, `fnm use` ou `mise install`. Exécutez ensuite :

```bash
corepack enable
pnpm install
pnpm dev
```

Lancez `pnpm dist` pour générer les installateurs dans `release/`. Si Electron affiche `failed to install correctly`, supprimez `node_modules/electron`, puis relancez `pnpm install` avec une version de Node compatible.

## Configurer les modèles d’IA

1. Ouvrez les paramètres avec `Ctrl+,` et sélectionnez l’onglet Provider.
2. Choisissez un fournisseur et renseignez la clé API nécessaire.
3. Sélectionnez un modèle et enregistrez.

OpenAI, Anthropic, Google, DeepSeek, Ollama et les API compatibles OpenAI sont pris en charge. Utilisez `@` pour ajouter des fichiers ou `@codebase`, `@git`, `@terminal`, `@symbols` et `@web` au contexte. Sélectionnez du code et appuyez sur `Ctrl+K` pour demander une modification intégrée.

## Utiliser Plan Mode

1. Décrivez l’objectif et confirmez les besoins et les critères d’acceptation.
2. Examinez les dépendances, les livrables, le parallélisme, les rôles et les modèles.
3. Approuvez le plan et suivez la progression et les demandes d’autorisation dans TaskBoard. Suspendez ou reprenez l’exécution si nécessaire.
4. Examinez le résultat, puis acceptez-le ou demandez des modifications.

![Plan Mode](images/orchestrator.png)

## Architecture et technologies

Le projet utilise Electron, React, TypeScript et Vite. `src/renderer` contient l’interface et l’exécution d’Agent ; `src/main`, les fonctions privilégiées et les services ; `src/shared`, les types et la configuration communs. L’indexation, le stockage des sessions et des ressources et le traitement du contenu s’exécutent dans des processus de service isolés.

## Documentation

Les documents techniques suivants sont disponibles dans leur langue d’origine.

- [Historique des changements](CHANGELOG.md)
- [Isolation des processus](docs/process-isolation.md)
- [API de génération de ressources](docs/asset-capabilities.md)
- [Aperçu dans le navigateur](docs/browser-preview.md)
- [Notifications](docs/notifications.md)
- [Tâches en arrière-plan](docs/background-tasks.md)
- [Diagnostic des performances](docs/performance-diagnostics.md)
- [Exécution parallèle avec les worktrees](docs/worktree-lane-architecture.md)
- [Ressources de marque](public/brand/README.md)

## Communauté et contributions

Signalez les bugs et suggestions sur [GitHub Issues](https://github.com/ad-naan/adnify/issues) ou [Gitee Issues](https://gitee.com/adnaan/adnify/issues). Les contributions au code et aux traductions sont les bienvenues : consultez le [guide de contribution](CONTRIBUTING.md) et le [code de conduite](CODE_OF_CONDUCT.md). Pour les problèmes de sécurité, suivez [SECURITY.md](SECURITY.md).

## Licence

Adnify utilise une licence personnalisée. Consultez les conditions dans [LICENSE](LICENSE). Toute utilisation commerciale nécessite l’autorisation écrite préalable de l’auteur. Contact : adnaan.worker@gmail.com.

