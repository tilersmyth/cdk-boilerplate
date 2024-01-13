#!/usr/bin/env node
import { getStageName } from '@cdk-boilerplate/common';
import * as cdk from 'aws-cdk-lib';

import { buildAppConfig } from '../lib/app-config';
import { Ecstack } from '../lib/ecs-stack';

const app = new cdk.App();

const stageName = getStageName(app);

const config = buildAppConfig();

new Ecstack(app, 'AppStack', { stageName, config });

app.synth();
