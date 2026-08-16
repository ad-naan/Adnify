const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET_DIR = path.join(__dirname, '../resources/tree-sitter');
const WASM_PACKAGE_JSON = require.resolve('tree-sitter-wasms/package.json');
const WASM_PACKAGE_DIR = path.dirname(WASM_PACKAGE_JSON);
const WASM_PACKAGE_VERSION = require(WASM_PACKAGE_JSON).version;
const PACKAGE_OUT_DIR = path.join(WASM_PACKAGE_DIR, 'out');
const BASE_URL = `https://unpkg.com/tree-sitter-wasms@${WASM_PACKAGE_VERSION}/out/`;

const LANGUAGES = [
  // JavaScript/TypeScript 生态
  'tree-sitter-typescript.wasm',
  'tree-sitter-tsx.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-json.wasm',
  'tree-sitter-vue.wasm',
  
  // 系统编程语言
  'tree-sitter-c.wasm',
  'tree-sitter-cpp.wasm',
  'tree-sitter-rust.wasm',
  'tree-sitter-go.wasm',
  // 'tree-sitter-zig.wasm', // 不在 tree-sitter-wasms 包中
  
  // 其他主流语言
  'tree-sitter-python.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-c_sharp.wasm',
  'tree-sitter-ruby.wasm',
  'tree-sitter-php.wasm',
  
  // Web 相关
  'tree-sitter-html.wasm',
  'tree-sitter-css.wasm',
  // 'tree-sitter-scss.wasm', // 不在 tree-sitter-wasms 包中
  
  // 配置文件
  'tree-sitter-yaml.wasm',
  'tree-sitter-toml.wasm',
  'tree-sitter-bash.wasm',
  
  // 其他
  // 'tree-sitter-markdown.wasm', // 不在 tree-sitter-wasms 包中
  // 'tree-sitter-sql.wasm', // 不在 tree-sitter-wasms 包中
  'tree-sitter-lua.wasm',
  'tree-sitter-kotlin.wasm',
  'tree-sitter-swift.wasm',
  // 'tree-sitter-dart.wasm', // 不在 tree-sitter-wasms 包中
  'tree-sitter-elixir.wasm',
  // 'tree-sitter-haskell.wasm', // 不在 tree-sitter-wasms 包中
  'tree-sitter-scala.wasm',
];

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

// Copy tree-sitter.wasm from node_modules if possible
// Note: web-tree-sitter v0.26+ renamed it to web-tree-sitter.wasm
const webTreeSitterDir = path.dirname(require.resolve('web-tree-sitter'));
const possibleWasmNames = ['web-tree-sitter.wasm', 'tree-sitter.wasm'];
const destTreeSitterWasm = path.join(TARGET_DIR, 'tree-sitter.wasm');

let copied = false;
for (const wasmName of possibleWasmNames) {
  const wasmPath = path.join(webTreeSitterDir, wasmName);
  try {
    if (fs.existsSync(wasmPath)) {
      fs.copyFileSync(wasmPath, destTreeSitterWasm);
      console.log(`Copied ${wasmName} from ${wasmPath} to tree-sitter.wasm`);
      copied = true;
      break;
    }
  } catch (e) {
    console.error(`Error copying ${wasmName}:`, e);
  }
}

if (!copied) {
  console.warn('Could not find web-tree-sitter.wasm or tree-sitter.wasm in node_modules');
}

function isValidWasm(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return content.length >= 8 && WebAssembly.validate(content);
  } catch {
    return false;
  }
}

function replaceAtomically(tempPath, destPath) {
  try {
    fs.renameSync(tempPath, destPath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.unlinkSync(destPath);
    fs.renameSync(tempPath, destPath);
  }
}

function copyPackagedGrammar(filename, dest) {
  const source = path.join(PACKAGE_OUT_DIR, filename);
  if (!isValidWasm(source)) return false;

  const temp = `${dest}.tmp-${process.pid}`;
  try {
    fs.copyFileSync(source, temp);
    if (!isValidWasm(temp)) throw new Error(`Invalid packaged WASM: ${filename}`);
    replaceAtomically(temp, dest);
    console.log(`Copied ${filename} from installed tree-sitter-wasms package`);
    return true;
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function download(filename) {
  const url = BASE_URL + filename;
  const dest = path.join(TARGET_DIR, filename);

  if (isValidWasm(dest)) {
    console.log(`Skipping ${filename} (already valid)`);
    return;
  }

  if (fs.existsSync(dest)) {
    console.warn(`Replacing invalid or truncated WASM: ${filename}`);
  }

  if (copyPackagedGrammar(filename, dest)) return;

  console.log(`Downloading ${filename}...`);
  const temp = `${dest}.download-${process.pid}-${Date.now()}`;
  const file = fs.createWriteStream(temp);

  https.get(url, (response) => {
    if (response.statusCode !== 200) {
      console.error(`Failed to download ${filename}: ${response.statusCode}`);
      file.close();
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      return;
    }
    
    response.pipe(file);

    file.on('finish', () => {
      file.close();
      if (!isValidWasm(temp)) {
        fs.unlinkSync(temp);
        console.error(`Downloaded invalid or truncated WASM: ${filename}`);
        return;
      }
      replaceAtomically(temp, dest);
      console.log(`Downloaded and validated ${filename}`);
    });
  }).on('error', (err) => {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    console.error(`Error downloading ${filename}:`, err.message);
  });
}

LANGUAGES.forEach(download);
