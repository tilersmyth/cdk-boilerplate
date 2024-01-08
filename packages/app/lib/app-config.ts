import * as fs from 'node:fs';
import * as path from 'node:path';

// This should match config-env.json
export interface ConfigEnv {
  port: number;
  github_username: string;
  github_repo: string;
  github_pat_secret_name_on_aws: string;
  [key: string]: {};
}

export const buildAppConfig = (): ConfigEnv => {
  const filePath = path.join(__dirname, '../config-env.json');
  const contentStr = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(contentStr);
};
