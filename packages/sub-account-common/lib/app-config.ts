import * as fs from 'node:fs';
import * as path from 'node:path';

// This should match config-env.json
interface ConfigEnv {
  rootAccountId: string;
}

export const buildAppConfig = (): ConfigEnv => {
  const filePath = path.join(__dirname, '../config-env.json');
  const contentStr = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(contentStr);
};
