#!/bin/bash
# AWS Deployment Script - Docker Version
# This version uses Docker for guaranteed reliability
#
# Usage:
#   ./scripts/deploy-to-aws-docker.sh              # Interactive mode
#   ./scripts/deploy-to-aws-docker.sh --auto       # Auto mode with defaults

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }
print_step() { echo -e "${BLUE}▶ $1${NC}"; }

# Parse arguments
AUTO_MODE=false
if [[ "$1" == "--auto" ]] || [[ "$1" == "--no-prompt" ]]; then
    AUTO_MODE=true
fi

echo "========================================="
echo "Arke Mirror - Docker AWS Deployment"
echo "========================================="
echo ""

# Prerequisites check
print_step "Checking prerequisites..."
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI not found"
    exit 1
fi

if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS CLI not configured"
    exit 1
fi

print_success "Prerequisites met"
echo ""

# Load configuration from .env file
print_step "Loading configuration from .env file..."
ENV_FILE="$PROJECT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    print_error ".env file not found at: $ENV_FILE"
    exit 1
fi

OPENAI_KEY=$(grep "^OPENAI_API_KEY=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
PINECONE_KEY=$(grep "^PINECONE_API_KEY=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
BACKEND_API_URL=$(grep "^BACKEND_API_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
ARKE_API_URL=$(grep "^ARKE_API_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
ENABLE_PINECONE=$(grep "^ENABLE_PINECONE=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")

# Validate and set defaults
if [ -z "$OPENAI_KEY" ] || [ -z "$PINECONE_KEY" ]; then
    print_error "API keys not found in .env file"
    exit 1
fi

BACKEND_API_URL=${BACKEND_API_URL:-https://ipfs-api.arke.institute}
ARKE_API_URL=${ARKE_API_URL:-https://api.arke.institute}
ENABLE_PINECONE=${ENABLE_PINECONE:-true}

print_success "Configuration loaded"
echo ""

# Get AWS settings
if [ "$AUTO_MODE" = true ]; then
    AWS_REGION="us-east-1"
    INSTANCE_NAME="arke-pinecone-mirror"
    print_info "Auto mode: Using defaults (Region: $AWS_REGION, Instance: $INSTANCE_NAME)"
else
    read -p "AWS Region [us-east-1]: " AWS_REGION
    AWS_REGION=${AWS_REGION:-us-east-1}
    read -p "Instance name [arke-pinecone-mirror]: " INSTANCE_NAME
    INSTANCE_NAME=${INSTANCE_NAME:-arke-pinecone-mirror}
fi
echo ""

# Setup EC2
KEY_NAME="${INSTANCE_NAME}-key"
KEY_FILE="$HOME/.ssh/${KEY_NAME}.pem"

print_step "Setting up AWS resources..."

# Get AMI
AMI_ID=$(aws ec2 describe-images \
    --region $AWS_REGION \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023*-kernel-*-x86_64" "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)

# Get VPC/Subnet
VPC_ID=$(aws ec2 describe-vpcs \
    --region $AWS_REGION \
    --filters "Name=isDefault,Values=true" \
    --query 'Vpcs[0].VpcId' \
    --output text)

SUBNET_ID=$(aws ec2 describe-subnets \
    --region $AWS_REGION \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=default-for-az,Values=true" \
    --query 'Subnets[0].SubnetId' \
    --output text)

# Create key pair
if ! aws ec2 describe-key-pairs --region $AWS_REGION --key-names $KEY_NAME &> /dev/null; then
    aws ec2 create-key-pair \
        --region $AWS_REGION \
        --key-name $KEY_NAME \
        --query 'KeyMaterial' \
        --output text > $KEY_FILE
    chmod 400 $KEY_FILE
    print_success "SSH key created"
else
    print_info "Using existing SSH key"
fi

# Create security group
SG_NAME="${INSTANCE_NAME}-sg"
EXISTING_SG=$(aws ec2 describe-security-groups \
    --region $AWS_REGION \
    --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "None")

if [ "$EXISTING_SG" != "None" ] && [ ! -z "$EXISTING_SG" ]; then
    SG_ID=$EXISTING_SG
    print_info "Using existing security group"
else
    SG_ID=$(aws ec2 create-security-group \
        --region $AWS_REGION \
        --group-name $SG_NAME \
        --description "Arke Mirror - outbound HTTPS only" \
        --vpc-id $VPC_ID \
        --query 'GroupId' \
        --output text)

    MY_IP=$(curl -s https://checkip.amazonaws.com)
    aws ec2 authorize-security-group-ingress \
        --region $AWS_REGION \
        --group-id $SG_ID \
        --protocol tcp \
        --port 22 \
        --cidr ${MY_IP}/32 > /dev/null

    print_success "Security group created"
fi

# Launch instance
print_step "Launching EC2 instance..."

# User data script to install Docker and run container
USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
# Install Docker
dnf update -y
dnf install -y docker
systemctl start docker
systemctl enable docker
usermod -a -G docker ec2-user

# Create data directory
mkdir -p /var/lib/arke-mirror
chown ec2-user:ec2-user /var/lib/arke-mirror
USERDATA
)

INSTANCE_ID=$(aws ec2 run-instances \
    --region $AWS_REGION \
    --image-id $AMI_ID \
    --instance-type t3a.micro \
    --key-name $KEY_NAME \
    --security-group-ids $SG_ID \
    --subnet-id $SUBNET_ID \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=8,VolumeType=gp3}' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --user-data "$USER_DATA" \
    --query 'Instances[0].InstanceId' \
    --output text)

print_success "Instance launched: $INSTANCE_ID"

# Wait for instance
print_info "Waiting for instance to be ready..."
aws ec2 wait instance-running --region $AWS_REGION --instance-ids $INSTANCE_ID

PUBLIC_IP=$(aws ec2 describe-instances \
    --region $AWS_REGION \
    --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)

print_success "Instance running at: $PUBLIC_IP"
echo ""

# Wait for SSH and Docker
print_info "Waiting for SSH and Docker installation (60 seconds)..."
sleep 60

SSH_OPTS="-i $KEY_FILE -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

# Test SSH connection
MAX_RETRIES=10
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    if ssh $SSH_OPTS ec2-user@$PUBLIC_IP "echo 'ready'" &> /dev/null; then
        print_success "SSH connection established"
        break
    else
        RETRY=$((RETRY+1))
        if [ $RETRY -lt $MAX_RETRIES ]; then
            sleep 5
        else
            print_error "Could not establish SSH connection"
            exit 1
        fi
    fi
done
echo ""

# Build and deploy with Docker
print_step "Deploying with Docker..."

# Create Dockerfile on instance
ssh $SSH_OPTS ec2-user@$PUBLIC_IP 'mkdir -p ~/arke-mirror'

# Copy project files
print_info "Uploading project files..."
rsync -avz --progress \
    -e "ssh $SSH_OPTS" \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude '*.log' \
    --exclude 'mirror-state.json' \
    --exclude 'mirror-data.jsonl' \
    "$PROJECT_DIR/" \
    ec2-user@$PUBLIC_IP:~/arke-mirror/

print_success "Files uploaded"
echo ""

# Build and run Docker container
print_info "Building Docker image and starting container..."

ssh $SSH_OPTS ec2-user@$PUBLIC_IP <<ENDSSH
set -e

cd ~/arke-mirror

# Build Docker image
echo "Building Docker image..."
docker build -t arke-mirror:latest . > /dev/null 2>&1

# Stop and remove old container if exists
docker stop arke-mirror 2>/dev/null || true
docker rm arke-mirror 2>/dev/null || true

# Run container
echo "Starting container..."
docker run -d \
  --name arke-mirror \
  --restart unless-stopped \
  -e BACKEND_API_URL=$BACKEND_API_URL \
  -e ARKE_API_URL=$ARKE_API_URL \
  -e ENABLE_PINECONE=$ENABLE_PINECONE \
  -e OPENAI_API_KEY=$OPENAI_KEY \
  -e PINECONE_API_KEY=$PINECONE_KEY \
  -e STATE_FILE_PATH=/data/mirror-state.json \
  -e DATA_FILE_PATH=/data/mirror-data.jsonl \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -v /var/lib/arke-mirror:/data \
  arke-mirror:latest

# Wait a moment for container to start
sleep 3

# Check container status
docker ps --filter name=arke-mirror --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

ENDSSH

print_success "Container deployed and running!"
echo ""

# Save connection info
INFO_FILE="$PROJECT_DIR/aws-instance-info.txt"
cat > $INFO_FILE <<EOF
Arke Mirror AWS Deployment (Docker)
====================================

Instance ID:    $INSTANCE_ID
Public IP:      $PUBLIC_IP
Region:         $AWS_REGION
SSH Key:        $KEY_FILE

Connect:        ssh -i $KEY_FILE ec2-user@$PUBLIC_IP

View logs:      ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'docker logs -f arke-mirror'
Container:      ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'docker ps'
State:          ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'cat /var/lib/arke-mirror/mirror-state.json | jq .'

Restart:        ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'docker restart arke-mirror'
Stop:           ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'docker stop arke-mirror'

AWS Console:    https://console.aws.amazon.com/ec2/v2/home?region=$AWS_REGION#Instances:instanceId=$INSTANCE_ID

Terminate:      aws ec2 terminate-instances --region $AWS_REGION --instance-ids $INSTANCE_ID
EOF

echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "Instance Details:"
echo "  Instance ID:  $INSTANCE_ID"
echo "  Public IP:    $PUBLIC_IP"
echo "  Region:       $AWS_REGION"
echo ""
echo "View logs:"
echo "  ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'docker logs -f arke-mirror'"
echo ""
echo "Connection info saved to: $INFO_FILE"
echo ""

# Offer to show logs
if [ "$AUTO_MODE" = true ]; then
    print_success "All done! Container is running."
else
    read -p "View live logs now? (y/n): " VIEW_LOGS
    if [ "$VIEW_LOGS" = "y" ] || [ "$VIEW_LOGS" = "Y" ]; then
        echo ""
        print_info "Connecting to view logs (Ctrl+C to exit)..."
        echo ""
        sleep 2
        ssh $SSH_OPTS ec2-user@$PUBLIC_IP 'docker logs -f arke-mirror'
    fi
fi

print_success "Deployment complete!"
