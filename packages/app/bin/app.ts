#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import {
  StageNameEnum,
  capitalize,
  getStageName,
} from '@cdk-boilerplate/common';

import { buildAppConfig } from '../lib/app-config';
import { CognitoUserPoolStack } from '../lib/cognito-stack';
import { Ecstack } from '../lib/ecs-stack';

const app = new cdk.App();

const stageName = getStageName(app);
const ckdStageName = capitalize(stageName);

const config = buildAppConfig();

// const cognito = new CognitoUserPoolStack(
//   app,
//   `CognitoUserPoolStack${ckdStageName}`,
//   {
//     stageName,
//     config,
//   },
// );

// Dev environment only needs Cognito
if (stageName !== StageNameEnum.DEVELOPMENT) {
  new Ecstack(app, `EcsStack${ckdStageName}`, { stageName, config });
}

app.synth();
