import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

interface UserStackProps {
  githubUserAllowedStsRoles: string[];
}

export class UserStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: UserStackProps) {
    super(scope, id);

    const githubEcrAccessUser = new iam.User(this, 'GithubEcrAccessUser', {
      userName: 'github-ecr-access-user',
    });
    const group = new iam.Group(this, 'EcrAccessGroup');
    group.addUser(githubEcrAccessUser);
    const policy = iam.ManagedPolicy.fromAwsManagedPolicyName(
      'AmazonEC2ContainerRegistryPowerUser',
    );
    group.addManagedPolicy(policy);

    githubEcrAccessUser.attachInlinePolicy(
      new iam.Policy(this, 'GitActionCrossAccountDeploymentUserPolicy', {
        statements: [
          new iam.PolicyStatement({
            sid: 'CrossAccountAssumeRole',
            actions: ['sts:AssumeRole'],
            effect: iam.Effect.ALLOW,
            resources: props.githubUserAllowedStsRoles,
          }),
        ],
      }),
    );

    const accessKey = new iam.CfnAccessKey(this, 'myAccessKey', {
      userName: githubEcrAccessUser.userName,
    });
    // NOTE: uncomment these lines to print these access keys during `yarn cdk deploy`
    new cdk.CfnOutput(this, 'githubActionsAccessKeyId', {
      value: accessKey.ref,
    });
    new cdk.CfnOutput(this, 'githubActionsSecretAccessKey', {
      value: accessKey.attrSecretAccessKey,
    });
  }
}
