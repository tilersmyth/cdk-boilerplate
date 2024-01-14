import * as fs from 'node:fs';
import * as path from 'node:path';

import { StageNameEnum } from '@cdk-boilerplate/common';

// This should match config-env.json
export interface ConfigEnv {
  project_name: string;
  [StageNameEnum.PRODUCTION]: {
    hostedZoneId: string;
    zoneName: string;
    acmCertificateArn: string;
    oAuth: {
      googleClientId: string;
      googleClientSecret: string;
      callbackUrls: string[];
      logoutUrls: string[];
    };
  };
  [StageNameEnum.DEVELOPMENT]: {
    oAuth: {
      googleClientId: string;
      googleClientSecret: string;
      callbackUrls: string[];
      logoutUrls: string[];
    };
  };
}

export const buildAppConfig = (): ConfigEnv => {
  const filePath = path.join(__dirname, '../config-env.json');
  const contentStr = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(contentStr);
};
