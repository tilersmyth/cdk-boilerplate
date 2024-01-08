import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { ConfigEnv } from './app-config';
import { Pipeline } from './pipeline';

interface Props extends cdk.StackProps {
  stageName: string;
  config: ConfigEnv;
}

export class Ecstack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const ecrRepository = new ecr.Repository(this, 'EcrRepo', {
      repositoryName: `${props.stageName}-ecr-repo`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    ecrRepository.addLifecycleRule({
      maxImageCount: 20,
    });

    /**
     * create a new vpc with single nat gateway
     */
    const vpc = new ec2.Vpc(this, 'FargateNodeJsVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'ingress',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'application',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const loadbalancer = new ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: `${props.stageName}-ecs-cluster`,
    });

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    // Meed to use publicly available image to initially spin up ECS services.
    // If we try to use image that's not available it will break CDK deployment.
    const temporary_image = 'amazon/amazon-ecs-sample';
    const containerName = `${props.stageName}-container`;
    const apl = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      'FargateNodeService',
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
      },
    );

    const secGroup = new ec2.SecurityGroup(this, 'CodePipelineSg', {
      vpc,
      allowAllOutbound: true,
    });

    const pipeline = new Pipeline(this, 'Deployment', {
      stageName: props.stageName,
      repository: ecrRepository,
      containerName,
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [pipeline.listenToPush()],
    });

    pipeline.addStage({
      stageName: 'BuildImages',
      actions: [pipeline.buildImage()],
    });

    pipeline.addStage({
      stageName: 'DeployServices',
      actions: [pipeline.deploy(apl.service)],
    });
  }
}
