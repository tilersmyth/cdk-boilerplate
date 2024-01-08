import { Construct } from 'constructs';

import { StageNameEnum } from '../enums/stage-name';

export const getStageName = (app: Construct) => {
  const stageName = app.node.tryGetContext('stage') as StageNameEnum;

  if (stageName === undefined) {
    throw new Error(
      'Deployment stage cannot be empty! Specify the stage with --context stage=<name>',
    );
  }

  const allowedStages = Object.values(StageNameEnum);

  if (!allowedStages.includes(stageName)) {
    throw new Error(`Deployment stage must be ${allowedStages.join(' or ')}`);
  }

  return stageName;
};
