import { CfnOutput, Duration, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'

export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    })

    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'thai-ler-dev-github-deploy',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            // The `:pull_request` subs are what let the per-PR preview workflow
            // deploy and destroy its own stack.
            'token.actions.githubusercontent.com:sub': [
              'repo:tylerschloesser@2300885/thai.ler.dev@1357787239:ref:refs/heads/main',
              'repo:tylerschloesser/thai.ler.dev:ref:refs/heads/main',
              'repo:tylerschloesser@2300885/thai.ler.dev@1357787239:pull_request',
              'repo:tylerschloesser/thai.ler.dev:pull_request',
            ],
          },
        },
      ),
    })

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          'arn:aws:iam::063257577013:role/cdk-hnb659fds-*-063257577013-us-east-1',
        ],
      }),
    )

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DeleteStack', 'cloudformation:DescribeStacks'],
        resources: [
          'arn:aws:cloudformation:us-east-1:063257577013:stack/ThaiLerDevPreview*/*',
        ],
      }),
    )

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:BatchWriteItem'],
        resources: [
          'arn:aws:dynamodb:us-east-1:063257577013:table/ThaiLerDevPreview*',
        ],
      }),
    )

    new CfnOutput(this, 'GithubDeployRoleArn', { value: role.roleArn })
  }
}
