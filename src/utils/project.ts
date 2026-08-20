import fs from 'fs';
import path from 'path';

export function detectProjectName(): string {
  const currentDir = process.cwd();
  const packageJsonPath = path.join(currentDir, 'package.json');

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string' && pkg.name.trim() !== '') {
        const cleanName = pkg.name.replace(/^@[^/]+\//, '');
        return cleanName;
      }
    } catch {}
  }

  return path.basename(currentDir);
}
