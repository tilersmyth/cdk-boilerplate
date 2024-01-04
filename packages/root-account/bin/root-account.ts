#!/usr/bin/env node
import { StageNameEnum, getStageName } from "@cdk-boilerplate/common";
import * as cdk from "aws-cdk-lib";

import { RootAccountStack } from "../lib/root-account-stack";

const app = new cdk.App();

const stageName = getStageName(app);

console.log(stageName);

// new RootAccountStack(app, "RootAccountStack");
