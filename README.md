# CDK Boilerplate

## Getting Started
1. Login into AWS console root account
    - Navigate to AWS Organizations and add AWS accounts (e.g staging, production) - In the context of CDK, these will be the "stages" or environments.
    - In IAM, go to User groups and Create group (you can get as fine grained as preferred with permission policies, I use "Administrator Access").
    - In IAM, go to Users and Create user (apply user group just created).
    - In IAM, go to Users, select newly created user, create access key (save somewhere secure for reference).
    - In IAM, go to Roles, Create role, select Custom trust policy and add policy below. On the next page add the AdministratorAccess permission policy. This needs to be done for each environment.
        ```
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {
                        "AWS": "arn:aws:iam::<child org id>:root"
                    },
                    "Action": "sts:AssumeRole",
                    "Condition": {}
                }
            ]
        }
        ``` 

2. In this repo, open `packages/common/src/enums/index.ts` and update enum to include organizations created in Step 1.
    - Navigate to `packages/common` and run `yarn build`
 
3. Install AWS CLI ([Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
    - Run `aws configure --profile <profile name>` (this will populate the `~/.aws/credentials` file)
    - Open `~/.aws/config`, add the following snippet for each organization created:
    ```
    [profile <sub profile alias>] (e.g <profile name>-<stage name>)
    role_arn = arn:aws:iam::<org ID>:role/OrganizationAccountAccessRole
    source_profile = <profile name (from above)>
    ```

4. Setup, bootstrap and deploy the **sub account stack**. Run the following from the repo root:
    - `cd packages/sub-account-common`
    - `cp example.config-env.json config-env.json` and enter values
    - `cdk bootstrap --profile=<sub profile alias> --context stage=<stage name>` (this needs to be done for each environment)
    - `cdk deploy --profile=<sub profile alias> --context stage=<stage name> --all` (this will output the role ARN - this will be used in the next step!)

**_HINT:_** Add `deploy` (and `destroy`) scripts to the `scripts` section of `package.json` for added convenience

5. Setup, bootstrap and deploy the **root account stack**. Run the following from the repo root:
    - `cd packages/root-account`
    - `cp example.config-env.json config-env.json` and enter values (use role ARN(s) from last step)
    - `cdk bootstrap --profile=<profile name>`
    - `cdk deploy --profile=<profile name>` (Uncomment code block in `user-stack.ts` to output an access key and secret access key that can be used with GitHub Actions)