import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { StageNameEnum } from '@cdk-boilerplate/common';

import { ConfigEnv } from './app-config';

interface Props {
  stageName: StageNameEnum;
  config: ConfigEnv;
}

export class CognitoUserPoolStack extends cdk.Stack {
  public poolId: string;
  public PoolClientId: string;
  public IdentityPoolId: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const config = props.config[props.stageName];

    const userPool = new cognito.UserPool(this, 'CognitoPool', {
      signInAliases: {
        email: true,
      },
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
      },
      userVerification: {
        emailSubject: 'You need to verify your email',
        emailBody: 'Thanks for signing up Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      standardAttributes: {
        givenName: {
          mutable: true,
          required: true,
        },
        familyName: {
          mutable: true,
          required: true,
        },
      },
      customAttributes: {
        createdAt: new cognito.DateTimeAttribute(),
      },
      passwordPolicy: {
        minLength: props.stageName !== StageNameEnum.DEVELOPMENT ? 8 : 6,
        requireLowercase: props.stageName !== StageNameEnum.DEVELOPMENT,
        requireUppercase: props.stageName !== StageNameEnum.DEVELOPMENT,
        requireDigits: props.stageName !== StageNameEnum.DEVELOPMENT,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.poolId = userPool.userPoolId;

    const appClient = userPool.addClient('UserPoolClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
      oAuth: {
        callbackUrls: config.oAuth.callbackUrls,
        logoutUrls: config.oAuth.logoutUrls,
      },
    });

    this.PoolClientId = appClient.userPoolClientId;

    const provider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      'GoogleUserPool',
      {
        clientId: config.oAuth.googleClientId,
        clientSecret: config.oAuth.googleClientSecret,
        userPool,
        scopes: ['profile', 'email', 'openid'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      },
    );

    appClient.node.addDependency(provider);

    userPool.addDomain('AuthDomain', {
      cognitoDomain: {
        domainPrefix: `${props.config.project_name}-${props.stageName}`,
      },
    });

    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: appClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });
    this.IdentityPoolId = identityPool.ref;

    const identityPoolRole = new iam.Role(
      this,
      'IdentityPoolAuthenticatedRole',
      {
        assumedBy: new iam.FederatedPrincipal(
          'cognito-identity.amazonaws.com',
          {
            StringEquals: {
              'cognito-identity.amazonaws.com:aud': identityPool.ref,
            },
            'ForAnyValue:StringLike': {
              'cognito-identity.amazonaws.com:amr': 'authenticated',
            },
          },
          'sts:AssumeRoleWithWebIdentity',
        ),
      },
    );

    identityPoolRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'mobileanalytics:PutEvents',
          'cognito-sync:*',
          'cognito-identity:*',
        ],
        resources: ['*'],
      }),
    );

    new cognito.CfnIdentityPoolRoleAttachment(
      this,
      'IdentityPoolRoleAttachment',
      {
        identityPoolId: identityPool.ref,
        roles: { authenticated: identityPoolRole.roleArn },
      },
    );

    // Output Cognito setup credentials in development stage so they can be added
    // to .env file
    if (props.stageName === StageNameEnum.DEVELOPMENT) {
      new cdk.CfnOutput(this, 'CognitoPoolId', {
        value: this.poolId,
      });
      new cdk.CfnOutput(this, 'CognitoPoolClientId', {
        value: this.PoolClientId,
      });
      new cdk.CfnOutput(this, 'CognitoIdentityPoolId', {
        value: this.IdentityPoolId,
      });

      //   TO DO
      //   new cdk.CfnOutput(this, 'CognitoOauthDomain', {
      //     value: '',
      //   });
    }
  }
}
