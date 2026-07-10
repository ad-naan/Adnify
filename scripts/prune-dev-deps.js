const fs = require('fs');
const path = require('path');

// 声明打包及原生构建所需的 devDependencies 白名单，这些包在打包前不能被删除
const keepList = [
  'electron-builder',
  'electron',
  '@electron/rebuild',
  'builder-util',
  'builder-util-runtime',
  'app-builder-lib',
  'dmg-builder',
  'esbuild',
  'mime-types',
  'lazy-val',
  'read-config-file',
  'dotenv',
  'dotenv-expand',
  'semver',
  'js-yaml',
  'ajv',
  'sanitize-filename',
  'stat-mode',
  'minimist',
  'fs-extra'
];

const nodeModulesPath = path.join(__dirname, '../node_modules');
const packageJsonPath = path.join(__dirname, '../package.json');

if (!fs.existsSync(packageJsonPath)) {
  console.error('package.json not found!');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const prodDeps = Object.keys(packageJson.dependencies || {});

console.log('Starting pruning of unnecessary devDependencies from node_modules before packaging...');

if (fs.existsSync(nodeModulesPath)) {
  const dirs = fs.readdirSync(nodeModulesPath);
  let pruneCount = 0;

  for (const dir of dirs) {
    // 忽略点开头的缓存和二进制可执行目录
    if (dir.startsWith('.')) continue;

    // 处理作用域包
    if (dir.startsWith('@')) {
      const scopePath = path.join(nodeModulesPath, dir);
      const subDirs = fs.readdirSync(scopePath);
      for (const subDir of subDirs) {
        const fullName = `${dir}/${subDir}`;
        const isProd = prodDeps.some(dep => dep === fullName || dep.startsWith(fullName + '/'));
        const isKeep = keepList.some(k => fullName === k || fullName.startsWith(k + '/'));

        if (!isProd && !isKeep) {
          try {
            fs.rmSync(path.join(scopePath, subDir), { recursive: true, force: true });
            pruneCount++;
          } catch (e) {
            console.warn(`[Warning] Failed to prune ${fullName}:`, e.message);
          }
        }
      }
      // 如果作用域目录为空了，顺便删除该目录
      try {
        if (fs.readdirSync(scopePath).length === 0) {
          fs.rmSync(scopePath, { recursive: true, force: true });
        }
      } catch (e) {}
      continue;
    }

    // 处理普通包
    const isProd = prodDeps.some(dep => dep === dir || dep.startsWith(dir + '/'));
    const isKeep = keepList.some(k => dir === k || dir.startsWith(k + '/'));

    if (!isProd && !isKeep) {
      try {
        fs.rmSync(path.join(nodeModulesPath, dir), { recursive: true, force: true });
        pruneCount++;
      } catch (e) {
        console.warn(`[Warning] Failed to prune ${dir}:`, e.message);
      }
    }
  }
  console.log(`Successfully pruned ${pruneCount} unnecessary devDependency directories from node_modules.`);
} else {
  console.log('node_modules directory not found.');
}
