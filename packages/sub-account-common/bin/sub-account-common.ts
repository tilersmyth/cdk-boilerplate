#!/usr/bin/env node
import { getStageName } from "@cdk-boilerplate/common";
import * as cdk from "aws-cdk-lib";

import { SubAccountCommonStack } from "../lib/sub-account-common-stack";

const app = new cdk.App();

const stageName = getStageName(app);

console.log(stageName);

// new SubAccountCommonStack(app, "SubAccountCommonStack");
