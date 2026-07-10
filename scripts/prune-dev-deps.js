const fs = require('fs');
const path = require('path');

// 精准修剪的庞大开发依赖黑名单。只有这些确定无用且极其臃肿的开发包会被删除。
// 其他所有包（如 debug, builder-util-runtime 依赖的基础包）均会被安全保留。
const pruneBlacklist = [
  'monaco-editor',
  'typescript',
  'tailwindcss',
  'postcss',
  'vite',
  'vitest',
  '@vitest',
  '@types',
  'lucide-react',
  'autoprefixer',
  'concurrently',
  'framer-motion',
  'katex',
  'rehype-katex',
  'remark-gfm',
  'remark-math',
  'fast-check',
  'png2icons'
];

const nodeModulesPath = path.join(__dirname, '../node_modules');

console.log('Starting precise pruning of large devDependencies from node_modules...');

if (fs.existsSync(nodeModulesPath)) {
  const dirs = fs.readdirSync(nodeModulesPath);
  let pruneCount = 0;

  for (const dir of dirs) {
    if (dir.startsWith('.')) continue;

    // 处理作用域包
    if (dir.startsWith('@')) {
      const scopePath = path.join(nodeModulesPath, dir);
      const subDirs = fs.readdirSync(scopePath);
      for (const subDir of subDirs) {
        const fullName = `${dir}/${subDir}`;
        const shouldPrune = pruneBlacklist.some(item => fullName === item || fullName.startsWith(item + '/'));

        if (shouldPrune) {
          try {
            fs.rmSync(path.join(scopePath, subDir), { recursive: true, force: true });
            console.log(`Pruned: ${fullName}`);
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
    const shouldPrune = pruneBlacklist.some(item => dir === item || dir.startsWith(item + '/'));

    if (shouldPrune) {
      try {
        fs.rmSync(path.join(nodeModulesPath, dir), { recursive: true, force: true });
        console.log(`Pruned: ${dir}`);
        pruneCount++;
      } catch (e) {
        console.warn(`[Warning] Failed to prune ${dir}:`, e.message);
      }
    }
  }
  console.log(`Successfully pruned ${pruneCount} massive devDependency directories from node_modules.`);
} else {
  console.log('node_modules directory not found.');
}
