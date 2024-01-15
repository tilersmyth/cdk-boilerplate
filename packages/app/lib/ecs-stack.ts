import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import {
  CodeBuildAction,
  EcrSourceAction,
  EcsDeployAction,
} from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecspatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

import { StageNameEnum } from '@cdk-boilerplate/common';

import { ConfigEnv } from './app-config';
import { CognitoUserPoolStack } from './cognito-stack';

interface Props extends cdk.StackProps {
  stageName: StageNameEnum;
  config: ConfigEnv;
  // cognito: CognitoUserPoolStack;
}

export class Ecstack extends cdk.Stack {
  private props: Props;
  private repoName: string;
  private certificate: cdk.aws_certificatemanager.Certificate;
  private hostedZone: cdk.aws_route53.IHostedZone;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    this.props = props;

    const config = props.config.production;

    this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'HostedZone',
      {
        hostedZoneId: config.hostedZoneId,
        zoneName: config.zoneName,
      },
    );

    this.certificate = new acm.Certificate(this, 'AcmHostedCertificate', {
      domainName: this.hostedZone.zoneName,
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    this.repoName = props.stageName;

    const vpc = new ec2.Vpc(this, 'my.vpc', {
      cidr: '10.0.0.0/16',
      maxAzs: 2,
    });

    const ecrRepository = new ecr.Repository(this, 'EcsRepository', {
      repositoryName: `${this.repoName}-ecr-repo`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const pipelineProject = this.createPipelineProject(ecrRepository);
    pipelineProject.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonEC2ContainerRegistryPowerUser',
      ),
    );

    const sourceOutput = new Artifact();
    const buildOutput = new Artifact();

    const ecrSourceAction = this.createSourceAction(
      ecrRepository,
      sourceOutput,
    );
    const buildAction = this.buildImageDefinition(
      pipelineProject,
      sourceOutput,
      buildOutput,
    );
    const ecsDeployAction = this.createEcsDeployAction(
      vpc,
      ecrRepository,
      buildOutput,
      pipelineProject,
    );

    const pipeline = new Pipeline(this, 'my_pipeline_', {
      stages: [
        {
          stageName: 'Source',
          actions: [ecrSourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
        {
          stageName: 'Deploy',
          actions: [ecsDeployAction],
        },
      ],
      pipelineName: 'my_pipeline',
    });
  }

  private createPipelineProject(
    ecrRepo: ecr.Repository,
  ): codebuild.PipelineProject {
    const pipelineProject = new codebuild.PipelineProject(
      this,
      'my-codepipeline',
      {
        projectName: 'my-codepipeline',
        cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
          privileged: true,
        },
        environmentVariables: {
          ECR_REPO: {
            value: ecrRepo.repositoryUriForTag(),
          },
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            build: {
              commands: [
                'echo creating imagedefinitions.json dynamically',
                'printf \'[{"name":"' +
                  this.repoName +
                  '","imageUri": "' +
                  ecrRepo.repositoryUriForTag() +
                  ':latest"}]\' > imagedefinitions.json',
                'echo Build completed on `date`',
              ],
            },
          },
          artifacts: {
            files: ['imagedefinitions.json'],
          },
        }),
      },
    );
    return pipelineProject;
  }

  private createSourceAction(ecrRepo: ecr.Repository, sourceOutput: Artifact) {
    return new EcrSourceAction({
      actionName: 'ListenEcrPush',
      repository: ecrRepo,
      imageTag: 'latest',
      output: sourceOutput,
    });
  }

  private buildImageDefinition(
    pipelineProject: PipelineProject,
    sourceOutput: Artifact,
    buildOutput: Artifact,
  ) {
    return new CodeBuildAction({
      actionName: 'ConvertEcrOutputToImageDefinitions',
      project: pipelineProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });
  }

  public createEcsDeployAction(
    vpc: ec2.Vpc,
    ecrRepo: ecr.Repository,
    buildOutput: Artifact,
    pipelineProject: PipelineProject,
  ): EcsDeployAction {
    return new EcsDeployAction({
      actionName: 'EcsDeployAction',
      service: this.createLoadBalancedFargateService(
        this,
        vpc,
        ecrRepo,
        pipelineProject,
      ).service,
      input: buildOutput,
    });
  }

  public createLoadBalancedFargateService(
    scope: Construct,
    vpc: ec2.Vpc,
    ecrRepository: ecr.Repository,
    pipelineProject: PipelineProject,
  ) {
    const fargateService =
      new ecspatterns.ApplicationLoadBalancedFargateService(
        scope,
        'myLbFargateService',
        {
          vpc: vpc,
          memoryLimitMiB: 512,
          cpu: 256,
          assignPublicIp: true,
          // certificate: this.certificate,
          taskImageOptions: {
            containerName: this.repoName,
            image: ecs.ContainerImage.fromRegistry(
              'okaycloud/dummywebserver:latest',
            ),
            containerPort: 8080,
            // environment: {
            //   AWS_COGNITO_REGION: 'us-east-1',
            //   AWS_COGNITO_POOL_ID: this.props.cognito.poolId,
            //   AWS_COGNITO_APP_CLIENT_ID: this.props.cognito.poolClientId,
            //   AWS_COGNITO_IDENTITY_ID: this.props.cognito.identityPoolId,
            //   AWS_OAUTH_DOMAIN: this.props.cognito.oauthDomain,
            //   AWS_OAUTH_REDIRECT_SIGNIN:
            //     this.props.config.production.oAuth.callbackUrls[0],
            //   AWS_OAUTH_REDIRECT_SIGNOUT:
            //     this.props.config.production.oAuth.logoutUrls[0],
            // },
          },
        },
      );

    fargateService.taskDefinition.executionRole?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonEC2ContainerRegistryPowerUser',
      ),
    );

    fargateService.targetGroup.configureHealthCheck({
      path: '/api/health',
      healthyHttpCodes: '200-299',
      interval: cdk.Duration.seconds(45),
      timeout: cdk.Duration.seconds(30),
      unhealthyThresholdCount: 5,
      healthyThresholdCount: 2,
    });

    fargateService.targetGroup.setAttribute(
      'deregistration_delay.timeout_seconds',
      '60',
    );

    fargateService.targetGroup.setAttribute(
      'slow_start.duration_seconds',
      '30',
    );

    new route53.ARecord(this, 'MapDomain', {
      zone: this.hostedZone,
      recordName: undefined,
      target: route53.RecordTarget.fromAlias(
        new route53targets.LoadBalancerTarget(fargateService.loadBalancer),
      ),
    });

    return fargateService;
  }
}
