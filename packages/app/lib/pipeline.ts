import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

interface Props {
  stageName: string;
  repository: cdk.aws_ecr.Repository;
}

export class Pipeline extends codepipeline.Pipeline {
  private project: cdk.aws_codebuild.PipelineProject;

  private sourceOutput: cdk.aws_codepipeline.Artifact;
  private imageDefinitionOuput: cdk.aws_codepipeline.Artifact;

  constructor(
    scope: Construct,
    id: string,
    private props: Props,
  ) {
    super(scope, id);

    this.props = props;

    this.project = this.createProject();

    props.repository.grantPull(this.role);

    this.sourceOutput = new codepipeline.Artifact('sourceImage');

    this.imageDefinitionOuput = new codepipeline.Artifact(
      'imageDefinitionArtifacts',
    );
  }

  private createProject = () =>
    new codebuild.PipelineProject(
      this,
      `ConvertEcrOutputToImageDefns-${this.props.stageName}`,
      {
        cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
        environment: {
          computeType: codebuild.ComputeType.SMALL,
          // https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-codebuild.LinuxBuildImage.html
          buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
          environmentVariables: {
            CONTAINER_NAME: {
              value: this.props.repository.repositoryName,
            },
            IMAGE_URI: {
              value: `${this.props.repository.repositoryUriForTag()}:latest`,
            },
          },
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            build: {
              commands: [
                // 'apt-get install jq -y',
                // "ImageURI=$(cat imageDetail.json | jq -r '.ImageURI')",
                'printf \'[{"name":"CONTAINER_NAME","imageUri":"IMAGE_URI"}]\' > imagedefinitions.json',
                'sed -i -e "s|CONTAINER_NAME|$CONTAINER_NAME|g" imagedefinitions.json',
                'sed -i -e "s|IMAGE_URI|$IMAGE_URI|g" imagedefinitions.json',
                'cat imagedefinitions.json',
              ],
            },
          },
          artifacts: {
            files: 'imagedefinitions.json',
          },
        }),
      },
    );

  public autoDeploy = () => {
    new events.Rule(this, `AutoDeploy`, {
      description: `Trigger Code Pipeline Deploy`,
      targets: [new targets.CodePipeline(this)],
      eventPattern: {
        detailType: ['ECR Image Action'],
        detail: {
          'action-type': ['PUSH'],
          'image-tag': ['latest'],
          'repository-name': [this.props.repository.repositoryName],
          result: ['SUCCESS'],
        },
      },
    });
  };

  public listenToPush = () =>
    new codepipeline_actions.EcrSourceAction({
      actionName: 'ListenEcrPush',
      repository: this.props.repository,
      imageTag: 'latest',
      output: this.sourceOutput,
    });

  public buildImage = () =>
    new codepipeline_actions.CodeBuildAction({
      actionName: 'ConvertEcrOutputToImageDefinitions',
      project: this.project,
      input: this.sourceOutput,
      outputs: [this.imageDefinitionOuput],
    });

  public deploy = (service: cdk.aws_ecs.FargateService) =>
    new codepipeline_actions.EcsDeployAction({
      actionName: 'DeployCoreWeb',
      input: this.imageDefinitionOuput,
      service,
    });
}
