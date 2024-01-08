#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { buildAppConfig } from '../lib/app-config';
import { UserStack } from '../lib/user-stack';

const app = new cdk.App();

const config = buildAppConfig();

new UserStack(app, 'UserStack', {
  githubUserAllowedStsRoles: config.crossAccountArns,
});

app.synth();
