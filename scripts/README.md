# AWS Deployment Scripts

Automated Docker-based deployment scripts for the Arke Mirror on AWS EC2.

## Quick Start

### 1. Test Prerequisites

Validate your environment before deploying:

```bash
./scripts/test-deploy.sh
```

This checks:
- `.env` file exists with required API keys
- AWS CLI installed and configured
- API endpoints are reachable
- All required project files present

### 2. Deploy to AWS

Deploy with a single command:

```bash
./scripts/deploy-to-aws-docker.sh --auto
```

Or run interactively (prompts for region and instance name):

```bash
./scripts/deploy-to-aws-docker.sh
```

**What it does:**
1. Creates SSH key pair (if needed)
2. Creates security group with SSH access
3. Launches EC2 t3a.micro instance (~$8-9/month)
4. Installs Docker on the instance
5. Uploads project files
6. Builds Docker image
7. Runs container with auto-restart enabled

**Time:** ~5-10 minutes

### 3. Check Status

After deployment, check the mirror health:

```bash
./scripts/status.sh
```

Shows:
- EC2 instance state
- Docker container status
- Mirror statistics (entities, last poll, backoff)
- Pinecone stats (processed, failed, skipped)
- Recent log output

---

## Prerequisites

Before deploying, you need:

### 1. AWS CLI Setup

```bash
# Install AWS CLI
brew install awscli  # macOS
# or: sudo apt install awscli  # Ubuntu

# Configure with your credentials
aws configure
```

### 2. Environment File

Create `.env` file with your API keys:

```bash
# Copy the example
cp .env.example .env

# Edit and add your keys
nano .env
```

Required variables:
- `OPENAI_API_KEY` - Get from https://platform.openai.com/api-keys
- `PINECONE_API_KEY` - Get from https://app.pinecone.io/

### 3. Other Tools

- `rsync` (usually pre-installed on macOS/Linux)
- `ssh` client

---

## Scripts Reference

### `test-deploy.sh`

Validates prerequisites before deployment.

**Usage:**
```bash
./scripts/test-deploy.sh
```

**Checks:**
- `.env` file exists and contains API keys
- Keys are not placeholder values
- AWS CLI installed and configured
- API endpoints reachable
- Required project files present

**Exit codes:**
- `0` - All checks passed, ready to deploy
- `1` - One or more checks failed

---

### `deploy-to-aws-docker.sh`

Complete Docker-based deployment to AWS EC2.

**Usage:**
```bash
# Interactive mode (prompts for region/name)
./scripts/deploy-to-aws-docker.sh

# Auto mode with defaults
./scripts/deploy-to-aws-docker.sh --auto
```

**Defaults (auto mode):**
- Region: `us-east-1`
- Instance name: `arke-pinecone-mirror`

**Configuration:**
- Reads API keys from `.env` file automatically
- Uses production endpoints from `.env`:
  - `BACKEND_API_URL=https://ipfs-api.arke.institute`
  - `ARKE_API_URL=https://api.arke.institute`

**Creates:**
- SSH key: `~/.ssh/arke-pinecone-mirror-key.pem`
- Security group: `arke-pinecone-mirror-sg` (SSH from your IP only)
- EC2 instance: t3a.micro with Amazon Linux 2023
- Connection info: `aws-instance-info.txt`

**Container details:**
- Image: Built on EC2 from project Dockerfile
- Data volume: `/var/lib/arke-mirror` (persists state)
- Restart policy: `unless-stopped`
- Environment: All variables from `.env`

---

### `status.sh`

Check the health and status of a deployed mirror.

**Usage:**
```bash
./scripts/status.sh
```

**What it shows:**
- EC2 instance state (running, stopped, terminated)
- Docker container status and uptime
- Mirror statistics:
  - Phase (bulk_sync or polling)
  - Total entities synced
  - Last poll time
  - Current backoff interval
- Pinecone statistics:
  - Vectors processed
  - Failed count
  - Skipped count
  - Queue size
- Last 10 log lines

**Requirements:**
- `aws-instance-info.txt` must exist (created by deploy script)
- AWS CLI configured
- SSH access to instance

**Exit codes:**
- `0` - Mirror is healthy
- `1` - Error (instance not found, container not running, etc.)

---

## Common Operations

All commands below use values from `aws-instance-info.txt`.

### View Live Logs

```bash
ssh -i ~/.ssh/arke-pinecone-mirror-key.pem ec2-user@<PUBLIC_IP> \
  'docker logs -f arke-mirror'
```

### Check Container Status

```bash
ssh -i ~/.ssh/arke-pinecone-mirror-key.pem ec2-user@<PUBLIC_IP> \
  'docker ps'
```

### View Mirror State

```bash
ssh -i ~/.ssh/arke-pinecone-mirror-key.pem ec2-user@<PUBLIC_IP> \
  'cat /var/lib/arke-mirror/mirror-state.json | jq .'
```

### Restart Container

```bash
ssh -i ~/.ssh/arke-pinecone-mirror-key.pem ec2-user@<PUBLIC_IP> \
  'docker restart arke-mirror'
```

### Stop Container

```bash
ssh -i ~/.ssh/arke-pinecone-mirror-key.pem ec2-user@<PUBLIC_IP> \
  'docker stop arke-mirror'
```

### Update Application

```bash
# 1. Upload new code
rsync -avz --progress \
  -e "ssh -i ~/.ssh/arke-pinecone-mirror-key.pem -o StrictHostKeyChecking=no" \
  --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
  . ec2-user@<PUBLIC_IP>:~/arke-mirror/

# 2. Rebuild and restart
ssh -i ~/.ssh/arke-pinecone-mirror-key.pem ec2-user@<PUBLIC_IP> \
  'cd ~/arke-mirror && docker build -t arke-mirror:latest . && docker restart arke-mirror'
```

---

## Cost Estimate

Based on default settings (t3a.micro in us-east-1):

```
EC2 t3a.micro:      $7.30/month
EBS 8GB gp3:        $0.80/month
Data transfer:      ~$0.50/month
────────────────────────────────
Total:              ~$8.60/month
```

---

## Troubleshooting

### Script fails with "AWS CLI not configured"

```bash
aws configure
# Enter your AWS access key, secret key, and default region
```

### Cannot SSH to instance

1. Check security group allows SSH from your current IP
2. Verify key permissions: `chmod 400 ~/.ssh/arke-pinecone-mirror-key.pem`
3. Wait 30-60 seconds for instance to fully boot
4. Check your IP: `curl https://checkip.amazonaws.com`

### Container not running

```bash
# Check container status
ssh -i ~/.ssh/arke-pinecone-mirror-key.pem ec2-user@<PUBLIC_IP> 'docker ps -a'

# Check container logs
ssh -i ~/.ssh/arke-pinecone-mirror-key.pem ec2-user@<PUBLIC_IP> 'docker logs arke-mirror'
```

### Build fails on EC2

The Docker build might fail if:
- Instance ran out of disk space (8GB should be enough)
- npm dependencies failed (check logs)
- TypeScript compilation errors (fix locally first)

---

## Clean Up

### Terminate Instance

```bash
# Get instance ID from aws-instance-info.txt or:
aws ec2 terminate-instances --region us-east-1 --instance-ids <INSTANCE_ID>
```

This will also delete the attached EBS volume.

### Delete SSH Key

```bash
# Delete from AWS
aws ec2 delete-key-pair --region us-east-1 --key-name arke-pinecone-mirror-key

# Delete local file
rm ~/.ssh/arke-pinecone-mirror-key.pem
```

### Delete Security Group

```bash
# Get security group ID
SG_ID=$(aws ec2 describe-security-groups --region us-east-1 \
  --filters "Name=group-name,Values=arke-pinecone-mirror-sg" \
  --query 'SecurityGroups[0].GroupId' --output text)

# Delete (only works after instance is terminated)
aws ec2 delete-security-group --region us-east-1 --group-id $SG_ID
```

---

## Files

### Local Machine
- `~/.ssh/arke-pinecone-mirror-key.pem` - SSH private key (chmod 400)
- `aws-instance-info.txt` - Connection details and commands

### EC2 Instance
- `~/arke-mirror/` - Project source code
- `/var/lib/arke-mirror/mirror-state.json` - Persistent state
- `/var/lib/arke-mirror/mirror-data.jsonl` - Event data

---

## See Also

- [DEPLOYMENT.md](../DEPLOYMENT.md) - General deployment documentation
- [Dockerfile](../Dockerfile) - Container configuration
- [.env.example](../.env.example) - Environment variable template
