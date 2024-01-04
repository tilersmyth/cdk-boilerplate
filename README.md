# CDK Boilerplate

## Getting Started
1. Login into AWS console root account
    - Navigate to AWS Organizations and add AWS accounts (e.g staging, production) - In the context of CDK, these will be the "stages" or environments.
    - In IAM, go to User groups and Create group (you can get as fine grained as preferred with permission policies, I use "Administrator Access").
    - In IAM, go to Users and Create user (apply user group just created).
    - In IAM, go to Users, select newly created user, create access key (save somewhere secure for reference).

2. In this repo, open `packages/common/src/enums/index.ts` and update enum to include organizations created in Step 1.
    - Navigate to `packages/common` and run `yarn build`
 
2. Install AWS CLI ([Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
    - Run `aws configure --profile <profile name>` (this will populate the `~/.aws/credentials` file)
    - Open `~/.aws/config`, add the following snippet for each organization created:
    ```
    [profile <stage name>]
    role_arn = arn:aws:iam::<org ID>:role/OrganizationAccountAccessRole
    source_profile = <profile name (from above)>
    ```

3. In this repo, open `packages/root-account/package.json` update the `--profile` flag (set to profile name created in previous step) in the `deploy_root` script