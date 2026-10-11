I'll look at your repo first so the manifests match your actual app (ports, env vars, services).I read your repo, so this guide is tailored to what you actually run. These details drive the design:

- **Two containers.** The frontend is Nginx on port 80 and proxies `/api/` to the FastAPI backend on port 8000. In Compose it reaches the backend by the hostname `backend`. **Keep that name as the Kubernetes Service name** so Nginx works without changes.
- **Only the frontend needs to be public.** Nginx already handles `/api/`, so the ALB sends everything to the frontend.
- **Environment variables:** `COST_DATA_MODE`, `AWS_REGION`, `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID` and `ALLOWED_EMAILS`. None of these are secrets, so a ConfigMap is fine.
- **Region, account and certificate:** `us-east-1`, account `195231312458`, and the ACM certificate ARN from your runbook. The certificate is in the same region as the ALB, which is required.
- **Cognito needs no change.** The callback `https://cost.manishcloudops.in/auth/callback` stays the same because the origin stays the same.

## Phase 0: Prerequisites

Install `aws`, `eksctl`, `kubectl` and `helm` (v3). Then set variables you'll reuse:

```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=195231312458
export CLUSTER=cost-intel-eks
export NS=cost-intel
export CERT_ARN=arn:aws:acm:us-east-1:195231312458:certificate/70e769c9-dd67-4218-ba48-8df3c84728af

aws sts get-caller-identity   # confirm the right account
```

## Phase 1: EKS cluster

`eksctl` creates the VPC (public and private subnets across 2+ AZs, NAT gateway) and tags the subnets the ALB controller needs (`kubernetes.io/role/elb` and `kubernetes.io/role/internal-elb`). Save this as `cluster.yaml`:

```yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
  name: cost-intel-eks
  region: us-east-1
iam:
  withOIDC: true            # required for IRSA
managedNodeGroups:
  - name: ng-1
    instanceType: t3.medium
    minSize: 1
    maxSize: 3
    desiredCapacity: 2
    volumeSize: 30
    privateNetworking: true  # nodes in private subnets; ALB stays public
```

Then create the cluster (about 15 to 20 minutes) and verify:

```bash
eksctl create cluster -f cluster.yaml

aws eks update-kubeconfig --name $CLUSTER --region $AWS_REGION
kubectl get nodes
```

**Cost note:** the EKS control plane is about $0.10/hour (~$73/month), plus 2 nodes, a NAT gateway and the ALB. This costs noticeably more than your single `t3.small` EB setup, so tear it down when you're done practicing (see the cleanup section).

## Phase 2: IAM, IRSA and ECR

### 2a. ECR pull access (nothing extra to do)

Your images are in the same account, and `eksctl` attaches `AmazonEC2ContainerRegistryReadOnly` to the node role by default. Nodes can therefore pull `195231312458.dkr.ecr.us-east-1.amazonaws.com/...` with no `imagePullSecrets`. To confirm:

```bash
NODE_ROLE=$(aws eks describe-nodegroup --cluster-name $CLUSTER --nodegroup-name ng-1 \
  --query 'nodegroup.nodeRole' --output text | awk -F/ '{print $NF}')
aws iam list-attached-role-policies --role-name $NODE_ROLE
```

### 2b. Translate the EC2 instance profile into IRSA

First, see exactly what the old role allowed. It still exists even though the EB environment is gone:

```bash
ROLE=AWSCostIntelligence-EB-EC2-Role
aws iam list-attached-role-policies --role-name $ROLE
aws iam list-role-policies --role-name $ROLE
# for each inline policy:
aws iam get-role-policy --role-name $ROLE --policy-name <NAME>
```

The EB-specific managed policies (`AWSElasticBeanstalkWebTier`, `AWSElasticBeanstalkMulticontainerDocker` and similar) are **not needed** in Kubernetes. What you want is the app-specific part, which for this app is most likely Cost Explorer read access. If the role has no usable custom policy, a minimal starting point is:

```bash
cat > cost-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ce:GetCostAndUsage",
      "ce:GetCostForecast",
      "ce:GetDimensionValues",
      "ce:GetTags",
      "ce:GetRightsizingRecommendation",
      "ce:GetReservationUtilization",
      "ce:GetSavingsPlansUtilization"
    ],
    "Resource": "*"
  }]
}
EOF

aws iam create-policy --policy-name CostIntelAppPolicy \
  --policy-document file://cost-policy.json
```

Add any other actions you saw on the old role, such as `ec2:Describe*`, `budgets:ViewBudget` or `cloudwatch:GetMetricData`. Then create the namespace and bind the policy to a Kubernetes ServiceAccount with IRSA:

```bash
kubectl create namespace $NS

eksctl create iamserviceaccount \
  --cluster $CLUSTER --region $AWS_REGION \
  --namespace $NS --name cost-intel-backend-sa \
  --attach-policy-arn arn:aws:iam::$ACCOUNT_ID:policy/CostIntelAppPolicy \
  --approve
```

This creates an IAM role with a trust policy tied to your cluster's OIDC provider and this specific ServiceAccount, and annotates the ServiceAccount with the role ARN. Only pods using `cost-intel-backend-sa` get these permissions. That's tighter than the old setup, where every process on the EC2 host shared the instance profile.

## Phase 3: Kubernetes manifests

Save this as `app.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cost-intel-config
  namespace: cost-intel
data:
  COST_DATA_MODE: "auto"
  AWS_REGION: "us-east-1"
  COGNITO_REGION: "us-east-1"
  COGNITO_USER_POOL_ID: "us-east-1_ZS4MbbMgy"
  COGNITO_APP_CLIENT_ID: "6pr07jbhi2htkretkl73drp06o"
  ALLOWED_EMAILS: "manish.gokhare@gmail.com"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: cost-intel
spec:
  replicas: 2
  selector:
    matchLabels: { app: backend }
  template:
    metadata:
      labels: { app: backend }
    spec:
      serviceAccountName: cost-intel-backend-sa   # IRSA
      containers:
        - name: backend
          image: 195231312458.dkr.ecr.us-east-1.amazonaws.com/aws-cost-intelligence-backend:v1.0.1
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef: { name: cost-intel-config }
          readinessProbe:
            tcpSocket: { port: 8000 }
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            tcpSocket: { port: 8000 }
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { cpu: 500m, memory: 512Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: backend            # MUST stay "backend": Nginx proxies to backend:8000
  namespace: cost-intel
spec:
  type: ClusterIP
  selector: { app: backend }
  ports:
    - port: 8000
      targetPort: 8000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: cost-intel
spec:
  replicas: 2
  selector:
    matchLabels: { app: frontend }
  template:
    metadata:
      labels: { app: frontend }
    spec:
      containers:
        - name: frontend
          image: 195231312458.dkr.ecr.us-east-1.amazonaws.com/aws-cost-intelligence-frontend:v1.0.1
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet: { path: /, port: 80 }
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits:   { cpu: 250m, memory: 128Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: cost-intel
spec:
  type: ClusterIP          # ALB targets pod IPs directly, so NodePort isn't needed
  selector: { app: frontend }
  ports:
    - port: 80
      targetPort: 80
```

Apply it and check:

```bash
kubectl apply -f app.yaml
kubectl -n $NS get pods,svc
kubectl -n $NS logs deploy/backend --tail=30
```

I used probes on the TCP port because I couldn't see your backend's health route. If FastAPI exposes something like `/health`, switch to `httpGet`.

## Phase 4: AWS Load Balancer Controller and Ingress

### 4a. Install the controller

```bash
# Check https://github.com/kubernetes-sigs/aws-load-balancer-controller/releases for the latest v2.x
export LBC_VERSION=v2.13.3   # example; replace with the latest release

curl -o iam_policy.json \
  https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/$LBC_VERSION/docs/install/iam_policy.json

aws iam create-policy \
  --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://iam_policy.json

eksctl create iamserviceaccount \
  --cluster $CLUSTER --region $AWS_REGION \
  --namespace kube-system --name aws-load-balancer-controller \
  --attach-policy-arn arn:aws:iam::$ACCOUNT_ID:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

helm repo add eks https://aws.github.io/eks-charts && helm repo update

VPC_ID=$(aws eks describe-cluster --name $CLUSTER --query 'cluster.resourcesVpcConfig.vpcId' --output text)

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=$CLUSTER \
  --set region=$AWS_REGION \
  --set vpcId=$VPC_ID \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller

kubectl -n kube-system rollout status deploy/aws-load-balancer-controller
```

The controller is another IRSA example: its ServiceAccount carries its own IAM role, separate from your app's.

### 4b. Ingress with ACM and HTTPS

Save this as `ingress.yaml`. It's the same ARN as in `$CERT_ARN`, so paste it literally:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cost-intel
  namespace: cost-intel
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-1:195231312458:certificate/70e769c9-dd67-4218-ba48-8df3c84728af
    alb.ingress.kubernetes.io/ssl-policy: ELBSecurityPolicy-TLS13-1-2-2021-06
    alb.ingress.kubernetes.io/healthcheck-path: /
spec:
  ingressClassName: alb
  rules:
    - host: cost.manishcloudops.in
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
```

Then apply it and wait for the ALB address (2 to 3 minutes):

```bash
kubectl apply -f ingress.yaml
kubectl -n $NS get ingress cost-intel -w
```

The controller automatically creates the ALB, both listeners (80 redirecting to 443, and 443 with your certificate), the target group and the security groups. You don't need the manual `authorize-security-group-ingress` and `create-listener` steps from the EB runbook.

## Phase 5: DNS cutover in GoDaddy

Get the ALB hostname:

```bash
ALB=$(kubectl -n $NS get ingress cost-intel -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo $ALB
```

**Test before touching DNS**, using the same technique as your runbook:

```bash
curl -Iv --connect-to cost.manishcloudops.in:443:$ALB:443 https://cost.manishcloudops.in/
```

You should see a valid certificate for `cost.manishcloudops.in` and an HTTP 200. Also check that the target group is healthy:

```bash
aws elbv2 describe-target-health --target-group-arn $(aws elbv2 describe-target-groups \
  --query "TargetGroups[?contains(TargetGroupName,'k8s-costinte')].TargetGroupArn | [0]" --output text)
```

Then, in GoDaddy DNS for `manishcloudops.in`:

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name | `cost` |
| Value | the ALB hostname from above, e.g. `k8s-costinte-xxxx-123456.us-east-1.elb.amazonaws.com` |
| TTL | 600 seconds or 1 hour |

**Edit the existing `cost` CNAME** (it still points at the deleted EB hostname) rather than adding a second record, because GoDaddy won't allow two CNAMEs for the same name. **Keep the ACM validation CNAME** (`_xxxx.cost` → `*.acm-validations.aws`), since ACM needs it for renewal.

Verify:

```bash
dig +short cost.manishcloudops.in
curl -I http://cost.manishcloudops.in    # expect 301 to https
curl -I https://cost.manishcloudops.in   # expect 200
```

Finally, open the site and sign in with Google to test the Cognito flow end to end.

## Troubleshooting checklist

- **Ingress has no ADDRESS:** check `kubectl -n kube-system logs deploy/aws-load-balancer-controller`. The usual causes are missing subnet tags or an IAM policy issue.
- **ALB returns 502/503:** the targets are probably unhealthy. Check `kubectl -n $NS get endpoints frontend` and the target group health.
- **UI loads but API calls fail:** the Service isn't named `backend`, or the backend pods aren't ready. Test with `kubectl -n $NS exec deploy/frontend -- wget -qO- http://backend:8000/` (if `wget` isn't in the image, use `curl`).
- **Dashboard shows demo or empty data:** I'm inferring that `COST_DATA_MODE=auto` falls back to sample data when AWS calls fail. That would make an IRSA misconfiguration look like a working app, so verify the role is actually applied:
  ```bash
  kubectl -n $NS exec deploy/backend -- env | grep -E 'AWS_ROLE_ARN|AWS_WEB_IDENTITY'
  kubectl -n $NS logs deploy/backend | grep -i -E 'accessdenied|unauthorized'
  ```
- **Google sign-in redirect error:** the callback and sign-out URLs in the Cognito app client must still include `https://cost.manishcloudops.in/auth/callback` and `https://cost.manishcloudops.in/`.

## Cleanup

Delete the Ingress first so the controller removes the ALB. Otherwise the leftover ALB can block VPC deletion.

```bash
kubectl delete -f ingress.yaml
sleep 60
eksctl delete cluster -f cluster.yaml --wait
```

If you tear down the cluster, point the GoDaddy `cost` record elsewhere or remove it.

Two things would help me tighten this further. Could you paste the output of `aws iam list-attached-role-policies --role-name AWSCostIntelligence-EB-EC2-Role` plus any inline policy? Then I can give you an exact least-privilege IRSA policy instead of the starter one.
