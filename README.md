# AWS Cost Intelligence — Elastic Beanstalk Deployment Runbook

A step-by-step reference for redeploying the AWS Cost Intelligence dashboard to Elastic Beanstalk using the existing Docker Compose file and ECR images.

> **Purpose:** Rebuild the practice environment, deploy the frontend/backend containers, configure HTTPS with the existing ACM certificate, update GoDaddy DNS, and troubleshoot the deployment.
>
> **Important:** Review resource names and ARNs before running commands. This runbook records the practice setup performed in October 2026. AWS-generated IDs can change when an environment is recreated.

## 1. Environment details

| Item | Value |
|---|---|
| AWS Region | `us-east-1` |
| AWS account | `195231312458` |
| Elastic Beanstalk application | `aws-cost-intelligence-platform` |
| Practice environment | `aws-cost-intelligence-practice` |
| Environment ID (current run) | `e-p43yhiac98` |
| EB platform | `64bit Amazon Linux 2023 v4.13.10 running Docker` |
| Actual EC2 instance type used in this run | `t3.small` |
| EC2 instance profile | `AWSCostIntelligence-EB-EC2-Role` |
| EB service role | `AWSCostIntelligence-EB-Service-Role` |
| Frontend ECR image | `195231312458.dkr.ecr.us-east-1.amazonaws.com/aws-cost-intelligence-frontend:v1.0.1` |
| Backend ECR image | `195231312458.dkr.ecr.us-east-1.amazonaws.com/aws-cost-intelligence-backend:v1.0.1` |
| S3 deployment bucket | `elasticbeanstalk-us-east-1-195231312458` |
| S3 deployment key | `aws-cost-intelligence/eb-deploy-practice-v1.0.1.zip` |
| Application version | `practice-v1.0.1` |
| Custom domain | `cost.manishcloudops.in` |
| ACM certificate ARN | `arn:aws:acm:us-east-1:195231312458:certificate/70e769c9-dd67-4218-ba48-8df3c84728af` |
| Practice EB CNAME | `aws-cost-intelligence-practice.eba-kizgsrme.us-east-1.elasticbeanstalk.com` |
| Practice ALB DNS | `awseb--AWSEB-AsnXD8YQXvpo-1322403750.us-east-1.elb.amazonaws.com` |
| Practice ALB security group | `sg-07cee9c578591e19f` |
| Practice target group ARN | `arn:aws:elasticloadbalancing:us-east-1:195231312458:targetgroup/awseb-AWSEB-IYLQMP973QLB/196f9ccad05b6e39` |

**Instance size note:** The successful environment creation command specified `t3.small`, not `t3.medium`. The environment was confirmed to be running `t3.small`. To use `t3.medium` next time, set `InstanceType` to `t3.medium` during environment creation.

**Security note:** Do not commit credentials, access keys, secret values, or unreviewed environment dumps to Git.

## 2. Prerequisites and initial checks

Run commands from the project directory:

```bash
cd /Users/manish/devops/aws-cost-intelligence-platform-cognito
```

### 2.1 Confirm the AWS account

```bash
aws sts get-caller-identity
```

Shows the AWS account and IAM identity used by the CLI. Confirm the account is the intended one before making changes.

### 2.2 Check deployment files

```bash
ls -l docker-compose.yml docker-compose.eb.yml eb-deploy/docker-compose.yml
```

Confirms the expected Compose files exist.

### 2.3 Confirm the ECR images

```bash
aws ecr describe-images \
  --repository-name aws-cost-intelligence-frontend \
  --region us-east-1 \
  --query 'imageDetails[].imageTags' \
  --output table

aws ecr describe-images \
  --repository-name aws-cost-intelligence-backend \
  --region us-east-1 \
  --query 'imageDetails[].imageTags' \
  --output table
```

Confirm that both repositories have the `v1.0.1` tag before deploying.

### 2.4 Verify IAM roles

```bash
aws iam get-role \
  --role-name AWSCostIntelligence-EB-Service-Role \
  --query 'Role.[RoleName,Arn]' \
  --output table

aws iam get-instance-profile \
  --instance-profile-name AWSCostIntelligence-EB-EC2-Role \
  --query 'InstanceProfile.[InstanceProfileName,Roles[].RoleName]' \
  --output json
```

The service role is used by Elastic Beanstalk to manage environment resources. The instance profile is attached to EC2 instances and supplies their AWS permissions.

## 3. Create the Elastic Beanstalk environment

The environment was created as a load-balanced environment, with one EC2 instance initially and an Application Load Balancer.

```bash
aws elasticbeanstalk create-environment \
  --application-name aws-cost-intelligence-platform \
  --environment-name aws-cost-intelligence-practice \
  --description "AWS Cost Intelligence learning rebuild" \
  --solution-stack-name "64bit Amazon Linux 2023 v4.13.10 running Docker" \
  --region us-east-1 \
  --option-settings \
    Namespace=aws:elasticbeanstalk:environment,OptionName=ServiceRole,Value=AWSCostIntelligence-EB-Service-Role \
    Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=AWSCostIntelligence-EB-EC2-Role \
    Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.small \
    Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=LoadBalanced \
    Namespace=aws:elasticbeanstalk:environment,OptionName=LoadBalancerType,Value=application \
    Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=1 \
    Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=1
```

Main options:
- `ServiceRole`: role Elastic Beanstalk uses to manage environment resources.
- `IamInstanceProfile`: instance profile attached to EC2.
- `InstanceType`: EC2 size. This run used `t3.small`; use `t3.medium` if that is the intended size next time.
- `EnvironmentType=LoadBalanced`: creates a load-balanced environment.
- `LoadBalancerType=application`: requests an Application Load Balancer.
- `MinSize=1` and `MaxSize=1`: starts with one EC2 instance and prevents this environment's Auto Scaling group from scaling beyond one instance.

Environment creation can take several minutes.

### 3.1 Check environment status

```bash
aws elasticbeanstalk describe-environments \
  --environment-names aws-cost-intelligence-practice \
  --region us-east-1 \
  --query 'Environments[0].[EnvironmentName,Status,Health,CNAME]' \
  --output table
```

Wait for `Ready`; health should ideally be `Green`.

### 3.2 Verify EC2 instance type

```bash
aws ec2 describe-instances \
  --region us-east-1 \
  --filters "Name=tag:elasticbeanstalk:environment-name,Values=aws-cost-intelligence-practice" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name]' \
  --output table
```

## 4. Package the Docker Compose deployment file

The deployment ZIP must have `docker-compose.yml` at the root of the archive, not nested inside an `eb-deploy/` folder.

```bash
cd /Users/manish/devops/aws-cost-intelligence-platform-cognito/eb-deploy
zip -j ../eb-deploy-v1.0.1.zip docker-compose.yml
cd ..
```

`-j` means “junk paths”: the ZIP stores only `docker-compose.yml`, without its parent directory.

Verify the ZIP:

```bash
unzip -l eb-deploy-v1.0.1.zip
```

The listing should show `docker-compose.yml` at the archive root.

### Compose file used

`eb-deploy/docker-compose.yml` uses the existing ECR images:

```yaml
services:
  backend:
    image: 195231312458.dkr.ecr.us-east-1.amazonaws.com/aws-cost-intelligence-backend:v1.0.1
    environment:
      COST_DATA_MODE: ${COST_DATA_MODE:-auto}
      AWS_REGION: ${AWS_REGION:-us-east-1}
      COGNITO_REGION: ${COGNITO_REGION}
      COGNITO_USER_POOL_ID: ${COGNITO_USER_POOL_ID}
      COGNITO_APP_CLIENT_ID: ${COGNITO_APP_CLIENT_ID}
      ALLOWED_EMAILS: ${ALLOWED_EMAILS}
    expose:
      - "8000"
    restart: unless-stopped

  frontend:
    image: 195231312458.dkr.ecr.us-east-1.amazonaws.com/aws-cost-intelligence-frontend:v1.0.1
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped
```

The frontend publishes port 80 on the EC2 host. The backend exposes port 8000 internally to the Compose network.

## 5. Upload the bundle to S3

### 5.1 Check the existing bucket

```bash
aws s3 ls s3://elasticbeanstalk-us-east-1-195231312458/ --region us-east-1
```

The bucket already existed, so no new bucket was needed.

### 5.2 Upload the practice bundle

```bash
aws s3 cp eb-deploy-v1.0.1.zip \
  s3://elasticbeanstalk-us-east-1-195231312458/aws-cost-intelligence/eb-deploy-practice-v1.0.1.zip \
  --region us-east-1
```

A separate S3 key preserves the previous deployment bundle. Uploading to an existing key otherwise replaces the current object by default (subject to S3 versioning configuration).

## 6. Register an Elastic Beanstalk application version

```bash
aws elasticbeanstalk create-application-version \
  --application-name aws-cost-intelligence-platform \
  --version-label practice-v1.0.1 \
  --description "Practice deployment using Docker Compose v1.0.1" \
  --source-bundle S3Bucket=elasticbeanstalk-us-east-1-195231312458,S3Key=aws-cost-intelligence/eb-deploy-practice-v1.0.1.zip \
  --region us-east-1
```

This registers the S3 bundle as an application version. It does not deploy the version by itself. An initial `UNPROCESSED` status is not necessarily an error.

## 7. Deploy the application version

```bash
aws elasticbeanstalk update-environment \
  --environment-name aws-cost-intelligence-practice \
  --version-label practice-v1.0.1 \
  --region us-east-1
```

This tells the practice environment to deploy `practice-v1.0.1`.

### 7.1 Verify deployment status

```bash
aws elasticbeanstalk describe-environments \
  --environment-names aws-cost-intelligence-practice \
  --region us-east-1 \
  --query 'Environments[0].[Status,Health,VersionLabel,CNAME]' \
  --output table
```

Expected after successful deployment: `Ready`, `Green`, and `practice-v1.0.1`.

### 7.2 View recent Elastic Beanstalk events

```bash
aws elasticbeanstalk describe-events \
  --environment-name aws-cost-intelligence-practice \
  --region us-east-1 \
  --max-records 30 \
  --query 'Events[*].[EventDate,Severity,Message]' \
  --output table
```

Use this if deployment fails or health does not become Green.

## 8. Configure Elastic Beanstalk environment variables

The Compose file references `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `ALLOWED_EMAILS`, `AWS_REGION`, and `COST_DATA_MODE`.

```bash
aws elasticbeanstalk update-environment \
  --environment-name aws-cost-intelligence-practice \
  --region us-east-1 \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=COGNITO_REGION,Value=us-east-1 \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=COGNITO_USER_POOL_ID,Value=us-east-1_ZS4MbbMgy \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=COGNITO_APP_CLIENT_ID,Value=6pr07jbhi2htkretkl73drp06o \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=ALLOWED_EMAILS,Value=manish.gokhare@gmail.com \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=AWS_REGION,Value=us-east-1 \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=COST_DATA_MODE,Value=auto
```

This updates environment properties and triggers an environment update. Reapply the settings if absent after recreating the environment. Do not put credentials or secret values in source control.

## 9. Load balancer, security group, HTTPS listener, and ACM

Discover the environment load balancer:

```bash
aws elbv2 describe-load-balancers \
  --region us-east-1 \
  --query 'LoadBalancers[?contains(LoadBalancerName, `AWSEB`)].[LoadBalancerName,DNSName,LoadBalancerArn]' \
  --output table
```

The practice load balancer ARN in this run:

```text
arn:aws:elasticloadbalancing:us-east-1:195231312458:loadbalancer/app/awseb--AWSEB-AsnXD8YQXvpo/1dc3c91460986803
```

### 9.1 Find its security group

```bash
aws elbv2 describe-load-balancers \
  --load-balancer-arns arn:aws:elasticloadbalancing:us-east-1:195231312458:loadbalancer/app/awseb--AWSEB-AsnXD8YQXvpo/1dc3c91460986803 \
  --region us-east-1 \
  --query 'LoadBalancers[0].SecurityGroups' \
  --output table
```

The security group in this run was `sg-07cee9c578591e19f`.

### 9.2 Inspect inbound rules

```bash
aws ec2 describe-security-groups \
  --group-ids sg-07cee9c578591e19f \
  --region us-east-1 \
  --query 'SecurityGroups[0].IpPermissions[*].[IpProtocol,FromPort,ToPort,IpRanges[].CidrIp]' \
  --output table
```

### 9.3 Allow inbound HTTPS on port 443

Port 443 was missing, so the following rule was added to the **load balancer security group**:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-07cee9c578591e19f \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --region us-east-1
```

This permits public IPv4 HTTPS traffic to the public load balancer. Only add this rule if missing; AWS may return a duplicate-rule error if it already exists. Port 80 was already allowed.

### 9.4 Find the target group

```bash
aws elbv2 describe-target-groups \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:195231312458:loadbalancer/app/awseb--AWSEB-AsnXD8YQXvpo/1dc3c91460986803 \
  --region us-east-1 \
  --query 'TargetGroups[*].[TargetGroupName,TargetGroupArn,Port,Protocol]' \
  --output table
```

Target group ARN in this run:

```text
arn:aws:elasticloadbalancing:us-east-1:195231312458:targetgroup/awseb-AWSEB-IYLQMP973QLB/196f9ccad05b6e39
```

### 9.5 Check existing listeners

```bash
aws elbv2 describe-listeners \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:195231312458:loadbalancer/app/awseb--AWSEB-AsnXD8YQXvpo/1dc3c91460986803 \
  --region us-east-1 \
  --query 'Listeners[*].[Port,Protocol,Certificates[0].CertificateArn]' \
  --output table
```

The practice load balancer initially had only HTTP on port 80.

### 9.6 Create the HTTPS listener on port 443

The existing ACM certificate was reused:

```text
arn:aws:acm:us-east-1:195231312458:certificate/70e769c9-dd67-4218-ba48-8df3c84728af
```

```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:195231312458:loadbalancer/app/awseb--AWSEB-AsnXD8YQXvpo/1dc3c91460986803 \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:us-east-1:195231312458:certificate/70e769c9-dd67-4218-ba48-8df3c84728af \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:us-east-1:195231312458:targetgroup/awseb-AWSEB-IYLQMP973QLB/196f9ccad05b6e39 \
  --region us-east-1
```

This terminates TLS at the load balancer and forwards requests to the target group over HTTP port 80.

**Durability note:** Manually created listeners and security group rules can be affected by later Elastic Beanstalk configuration changes or environment recreation. For a durable setup, encode HTTPS listener and security group configuration in EB configuration files or infrastructure as code.

### 9.7 Verify the HTTPS listener

```bash
aws elbv2 describe-listeners \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:195231312458:loadbalancer/app/awseb--AWSEB-AsnXD8YQXvpo/1dc3c91460986803 \
  --region us-east-1 \
  --query 'Listeners[*].[Port,Protocol,Certificates[0].CertificateArn]' \
  --output table
```

Expected: HTTP port 80 and HTTPS port 443, with the ACM certificate on port 443.

## 10. Update the GoDaddy DNS CNAME

The website CNAME was changed in the GoDaddy DNS console:

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name / Host | `cost` |
| Value / Points to | `aws-cost-intelligence-practice.eba-kizgsrme.us-east-1.elasticbeanstalk.com` |
| TTL | `1 Hour` |

This maps `cost.manishcloudops.in` to the practice environment.

**Keep the ACM validation CNAME.** Its name begins with a generated value such as `_1aeab...cost` and its target ends with `acm-validations.aws`. It proves domain ownership to ACM and is different from the website traffic CNAME.

## 11. Cognito callback URLs and Google sign-in

Existing Cognito resources:

- User Pool ID: `us-east-1_ZS4MbbMgy`
- App Client ID: `6pr07jbhi2htkretkl73drp06o`

Custom-domain callback and sign-out URLs:

```text
Callback URL:
https://cost.manishcloudops.in/auth/callback

Sign-out URL:
https://cost.manishcloudops.in/
```

Keep these in the Cognito app client's allowed callback and sign-out URL lists. The frontend's OAuth redirect configuration must use the same origin as the page that starts sign-in.

Cognito generally requires HTTPS for deployed callback URLs; HTTP is allowed for localhost development. The AWS-generated EB hostname is not covered by the certificate for `cost.manishcloudops.in`, so use the custom domain over HTTPS for this setup.

Changing Cognito's allowlist alone will not fix a frontend that initiates OAuth with a different redirect URI.

## 12. DNS and HTTPS troubleshooting

### 12.1 DNS lookup

```bash
dig cost.manishcloudops.in
nslookup cost.manishcloudops.in
```

Check the DNS resolvers configured on macOS:

```bash
scutil --dns | grep 'nameserver\['
```

Query Google Public DNS explicitly:

```bash
nslookup cost.manishcloudops.in 8.8.8.8
```

### 12.2 Test HTTPS and certificate

```bash
curl -Iv https://cost.manishcloudops.in/
```

Expected signs of success include a certificate subject matching `cost.manishcloudops.in`, `SSL certificate verify ok`, and an HTTP response such as `200`.

### 12.3 Test the practice load balancer while bypassing DNS

```bash
curl -Iv \
  --connect-to cost.manishcloudops.in:443:awseb--AWSEB-AsnXD8YQXvpo-1322403750.us-east-1.elb.amazonaws.com:443 \
  https://cost.manishcloudops.in/
```

Alternatively, force an IP address:

```bash
curl -Iv --resolve cost.manishcloudops.in:443:3.233.201.214 \
  https://cost.manishcloudops.in/
```

`--resolve` bypasses DNS for that host/port combination while preserving the hostname for TLS certificate validation and the HTTP Host header.

In this deployment, the forced-IP test completed TLS, validated the ACM certificate, and returned `HTTP/2 200`.

### 12.4 Inspect EB events

```bash
aws elasticbeanstalk describe-events \
  --environment-name aws-cost-intelligence-practice \
  --region us-east-1 \
  --max-records 30 \
  --query 'Events[*].[EventDate,Severity,Message]' \
  --output table
```

### 12.5 Check environment status

```bash
aws elasticbeanstalk describe-environments \
  --environment-names aws-cost-intelligence-practice \
  --region us-east-1 \
  --query 'Environments[0].[EnvironmentName,Status,Health,VersionLabel,CNAME]' \
  --output table
```

### 12.6 Check certificate status and attachment

```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:195231312458:certificate/70e769c9-dd67-4218-ba48-8df3c84728af \
  --region us-east-1 \
  --query 'Certificate.[DomainName,Status,Type,InUseBy]' \
  --output json
```

## 13. Final verification checklist

- [ ] AWS CLI points to the intended account.
- [ ] Both ECR repositories contain the `v1.0.1` images.
- [ ] Environment is `Ready` and health is `Green`.
- [ ] EC2 instance type is correct.
- [ ] Deployment ZIP has `docker-compose.yml` at its root.
- [ ] ZIP uploaded to the intended S3 key.
- [ ] Application version `practice-v1.0.1` deployed.
- [ ] Cognito environment variables are configured.
- [ ] Load balancer security group allows TCP 443.
- [ ] HTTPS listener uses the ACM certificate and correct target group.
- [ ] GoDaddy `cost` CNAME points to the practice EB hostname.
- [ ] ACM validation CNAME remains in GoDaddy.
- [ ] DNS resolves as expected.
- [ ] HTTPS verifies the certificate and returns an HTTP response.
- [ ] Google sign-in works using the custom HTTPS domain.

## 14. Cost and cleanup reminder

A load-balanced environment can incur charges for EC2, the Application Load Balancer, data transfer, and other resources. ECR storage, S3 bundles, and CloudWatch logs may also incur charges.

When finished, terminate only the practice environment:

```bash
aws elasticbeanstalk terminate-environment \
  --environment-name aws-cost-intelligence-practice \
  --region us-east-1
```

Check termination:

```bash
aws elasticbeanstalk describe-environments \
  --environment-names aws-cost-intelligence-practice \
  --region us-east-1 \
  --query 'Environments[0].[EnvironmentName,Status,Health]' \
  --output table
```

After termination, separately inspect remaining load balancers, security groups, CloudWatch log groups, S3 objects, and DNS records. Do not assume every separately managed resource is removed automatically. If the custom domain should no longer point at the practice environment, update or remove its website CNAME in GoDaddy. Keep the ACM validation CNAME if you intend to reuse the certificate.

