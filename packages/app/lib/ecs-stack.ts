import * as cdk from 'aws-cdk-lib';
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
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { ConfigEnv } from './app-config';

interface Props extends cdk.StackProps {
  stageName: string;
  config: ConfigEnv;
}

export class Ecstack extends cdk.Stack {
  private repoName: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

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

  createLoadBalancedFargateService(
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
          // listenerPort: 8080,
          taskImageOptions: {
            containerName: this.repoName,
            image: ecs.ContainerImage.fromRegistry(
              'okaycloud/dummywebserver:latest',
            ),
            containerPort: 8080,
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

    return fargateService;
  }
}
