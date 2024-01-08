import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { ConfigEnv } from './app-config';

interface Props extends cdk.StackProps {
  stageName: string;
  config: ConfigEnv
}

export class Ecstack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const ecrRepo = new ecr.Repository(this, 'EcrRepo', { repositoryName: `${props.stageName}-ecr-repo`, removalPolicy: cdk.RemovalPolicy.DESTROY});

    ecrRepo.addLifecycleRule({
      maxImageCount: 20
    });

    /**
     * create a new vpc with single nat gateway
     */
    const vpc = new ec2.Vpc(this, "FargateNodeJsVpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "ingress",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "application",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const loadbalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
    });


    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: `${props.stageName}-ecs-cluster`
    });

     const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });

    // Meed to use publicly available image to initially spin up ECS services.
    // If we try to use image that's not available it will break CDK deployment.
    const temporary_image = "amazon/amazon-ecs-sample";
    const containerName = `${props.stageName}-container`
    const apl = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "FargateNodeService",
      {
        cluster,
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry(temporary_image),
          containerName,
          family: `${props.stageName}-ecs-task-def`,
          containerPort: 80,
          executionRole,
        },
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 2,
        serviceName: `${props.stageName}-esc-service`,
        taskSubnets: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }),
        loadBalancer: loadbalancer,
      }
    );


    const ecrRepository = ecr.Repository.fromRepositoryAttributes(this, "Repository", {
      repositoryArn: ecrRepo.repositoryArn,
      repositoryName: ecrRepo.repositoryName,
    });
  
    const secGroup = new ec2.SecurityGroup(this, "CodePipelineSg", {
      vpc,
      allowAllOutbound: true
    });
  
    const pipeline = new codepipeline.Pipeline(this, "Deployment");
  
    const sourceOutput = new codepipeline.Artifact('sourceImage');
    const sourceAction = new codepipeline_actions.EcrSourceAction({
      actionName: 'ListenEcrPush',
      repository: ecrRepository,
      imageTag: 'latest',
      output: sourceOutput,
    });

    ecrRepository.grantPull(pipeline.role);

    const sourceStage = pipeline.addStage({
      stageName: 'Source',
    });
    sourceStage.addAction(sourceAction);

    const project = new codebuild.PipelineProject(this, `ConvertEcrOutputToImageDefns-${props.stageName}`, {
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
      environment: {
        computeType: codebuild.ComputeType.SMALL,
        // https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-codebuild.LinuxBuildImage.html
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
        environmentVariables: {
          CONTAINER_NAME: {
            value: containerName,
          },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          build: {
            commands: [
              "apt-get install jq -y",
              "ImageURI=$(cat imageDetail.json | jq -r '.ImageURI')",
              "printf '[{\"name\":\"CONTAINER_NAME\",\"imageUri\":\"IMAGE_URI\"}]' > imagedefinitions.json",
              "sed -i -e \"s|CONTAINER_NAME|$CONTAINER_NAME|g\" imagedefinitions.json",
              "sed -i -e \"s|IMAGE_URI|$ImageURI|g\" imagedefinitions.json",
              "cat imagedefinitions.json",
            ]
          }
        },
        artifacts: {
          files: "imagedefinitions.json"
        }
      })
    });

    // STAGE - Convert ECR Output to compatible input for ECS Deploy Action
    // see pipeline/convert-ecr-output-to-image-defns for details
    const webImageDefinitionOutput = new codepipeline.Artifact("webImageDefinitionArtifacts");
    const webImageDefnAction = new codepipeline_actions.CodeBuildAction({
      actionName: "ConvertEcrOutputToImageDefinitionsWeb",
      project,
      input: sourceOutput,
      outputs: [webImageDefinitionOutput]
    });

    pipeline.addStage({
      stageName: 'BuildImages',
      actions: [webImageDefnAction],
    });

    const deployStage = pipeline.addStage({
      stageName: "DeployServices"
    });
    const webContainerDeploy = new codepipeline_actions.EcsDeployAction({
      actionName: "DeployCoreWeb",
      input: webImageDefinitionOutput,
      service: apl.service
    });
    deployStage.addAction(webContainerDeploy);


    // Configure Pipeline to Auto-Deploy
  // Rule implements: https://docs.aws.amazon.com/codepipeline/latest/userguide/create-cwe-ecr-source-console.html
  // More info on AWS Event Rules: https://docs.aws.amazon.com/cdk/api/latest/docs/aws-events-readme.html
  new events.Rule(this, `AutoDeploy`, {
    description: `Trigger Code Pipeline Deploy`,
    targets: [new targets.CodePipeline(pipeline)],
    eventPattern: {
      detailType: ["ECR Image Action"],
      detail: {
        "action-type": ["PUSH"],
        "image-tag": ["latest"],
        "repository-name": [ecrRepository.repositoryName],
        "result": ["SUCCESS"],
      }
    }
  });


    // const gitHubSource = codebuild.Source.gitHub({
    //   owner: props.config.github_username,
    //   repo: props.config.github_repo,
    //   webhook: true, // optional, default: true if `webhookfilteres` were provided, false otherwise
    //   webhookFilters: [
    //     codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andBranchIs('ci-deploy-test'),
    //   ], // optional, by default all pushes and pull requests will trigger a build
    // });

    // // codebuild - project
    // const project = new codebuild.Project(this, 'myProject', {
    //   projectName: `${this.stackName}`,
    //   source: gitHubSource,
    //   environment: {
    //     buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
    //     privileged: true
    //   },
    //   environmentVariables: {
    //     'cluster_name': {
    //       value: `${cluster.clusterName}`
    //     },
    //     'ecr_repo_uri': {
    //       value: `${ecrRepo.repositoryUri}`
    //     }
    //   },
    //   badge: true,
    //   // TODO - I had to hardcode tag here
    //   buildSpec: codebuild.BuildSpec.fromObject({
    //     version: "0.2",
    //     phases: {
    //       pre_build: {
    //         /*
    //         commands: [
    //           'env',
    //           'export tag=${CODEBUILD_RESOLVED_SOURCE_VERSION}'
    //         ]
    //         */
    //         commands: [
    //           'env',
    //           'export tag=latest'
    //         ]
    //       },
    //       build: {
    //         commands: [
    //           `docker build -t $ecr_repo_uri:$tag .`,
    //           '$(aws ecr get-login --no-include-email)',
    //           'docker push $ecr_repo_uri:$tag'
    //         ]
    //       },
    //       post_build: {
    //         commands: [
    //           'echo "in post-build stage"',
    //           'cd ..',
    //           "printf '[{\"name\":\"nextjs-app\",\"imageUri\":\"%s\"}]' $ecr_repo_uri:$tag > imagedefinitions.json",
    //           "pwd; ls -al; cat imagedefinitions.json"
    //         ]
    //       }
    //     },
    //     artifacts: {
    //       files: [
    //         'imagedefinitions.json'
    //       ]
    //     }
    //   })
    // });


    //  // ***pipeline actions***

    //  const sourceOutput = new codepipeline.Artifact();
    //  const buildOutput = new codepipeline.Artifact();
    //  const sourceAction = new codepipeline_actions.GitHubSourceAction({
    //    actionName: 'github_source',
    //    owner: props.config.github_username,
    //    repo: props.config.github_repo,
    //    branch: 'main',
    //    oauthToken: cdk.SecretValue.secretsManager(props.config.github_pat_secret_name_on_aws),
    //    output: sourceOutput
    //  });
 
    //  const buildAction = new codepipeline_actions.CodeBuildAction({
    //    actionName: 'codebuild',
    //    project: project,
    //    input: sourceOutput,
    //    outputs: [buildOutput], // optional
    //  });
 
    //  const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
    //    actionName: 'approve',
    //  });
 
    //  const deployAction = new codepipeline_actions.EcsDeployAction({
    //    actionName: 'deployAction',
    //    service: fargateService.service,
    //    imageFile: new codepipeline.ArtifactPath(buildOutput, `imagedefinitions.json`)
    //  });
 
 
 
    //  // pipeline stages
 
 
    //  // NOTE - Approve action is commented out!
    //  new codepipeline.Pipeline(this, 'myecspipeline', {
    //    stages: [
    //      {
    //        stageName: 'source',
    //        actions: [sourceAction],
    //      },
    //      {
    //        stageName: 'build',
    //        actions: [buildAction],
    //      },
    //      {
    //        stageName: 'approve',
    //        actions: [manualApprovalAction],
    //      },
    //      {
    //        stageName: 'deploy-to-ecs',
    //        actions: [deployAction],
    //      }
    //    ]
    //  });
 
 
    //  ecrRepo.grantPullPush(project.role!)
    //  project.addToRolePolicy(new iam.PolicyStatement({
    //    actions: [
    //      "ecs:describecluster",
    //      "ecr:getauthorizationtoken",
    //      "ecr:batchchecklayeravailability",
    //      "ecr:batchgetimage",
    //      "ecr:getdownloadurlforlayer"
    //    ],
    //    resources: [`${cluster.clusterArn}`],
    //  }));
 
 
    //  new cdk.CfnOutput(this, "image", { value: ecrRepo.repositoryUri + ":latest" })
    //  new cdk.CfnOutput(this, 'loadbalancerdns', { value: fargateService.loadBalancer.loadBalancerDnsName });

  }
}
