#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { getStageName } from '@cdk-boilerplate/common';

import { buildAppConfig } from '../lib/app-config';
import { CrossAccountRolesStack } from '../lib/cross-account-roles';

const app = new cdk.App();

const stageName = getStageName(app);

const config = buildAppConfig();

new CrossAccountRolesStack(app, `${stageName}-CrossAccountRoles`, {
  rootAccountId: config.rootAccountId,
});

app.synth();
