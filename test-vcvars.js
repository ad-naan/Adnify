const { execSync } = require('child_process');

try {
  const vcvars = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat";
  const cleanPath = process.env.PATH.split(';').filter(p => !p.includes('NVIDIA')).join(';');
  const envDump = execSync(`"${vcvars}" && set`, {
    encoding: 'utf8',
    env: { ...process.env, PATH: cleanPath }
  });
  console.log("SUCCESS!");
} catch (e) {
  console.log("FAILED:", e.message);
  if (e.stdout) console.log("STDOUT:", e.stdout);
  if (e.stderr) console.log("STDERR:", e.stderr);
}
