import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Custom properties to accomodate list of code deployment buckets across different regions
 */
interface EnvProps extends cdk.StackProps {
  rootAccountId: string;
}

export class CrossAccountRolesStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: EnvProps) {
    super(scope, id, props);

    iam.ManagedPolicy.fromAwsManagedPolicyName(
      'AmazonEC2ContainerRegistryPowerUser',
    );

    // Create a cross account role
    const crossAccountRole = new iam.Role(this, 'CrossAccountRole', {
      // By setting this to the root account ARN, we allow any user in the root account
      //   to assume this role. This could also be specific to one user in the root account,
      //   e.g. the Github user. This would need us to create some way to reference that user here
      assumedBy: new iam.AccountPrincipal(props.rootAccountId),
      // new iam.ArnPrincipal(String(props?.rootAccountArn)),
      // assumedBy: new iam.ArnPrincipal(String(props?.rootAccountGithubUserArn)),
      description:
        'Cross account role for Github Actions user to push to ECR in sub account.',
      roleName: 'git-action-cross-account-role',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonEC2ContainerRegistryPowerUser',
        ),
      ],
    });

    new cdk.CfnOutput(this, 'CrossAccountRoleArn', {
      description: 'Cross Account Role ARN',
      exportName: 'GIT-ACTIONS-CROSS-ACCOUNT-ROLE-ARN',
      value: crossAccountRole.roleArn,
    });
  }
}
