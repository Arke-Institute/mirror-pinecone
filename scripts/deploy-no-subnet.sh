#!/bin/bash
# Quick deploy script that lets AWS pick the availability zone
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_step() { echo -e "${BLUE}▶ $1${NC}"; }

echo "Quick AWS Deploy (Auto-select AZ)"
echo ""

# Load config
ENV_FILE="$PROJECT_DIR/.env"
OPENAI_KEY=$(grep "^OPENAI_API_KEY=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
PINECONE_KEY=$(grep "^PINECONE_API_KEY=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
BACKEND_API_URL=$(grep "^BACKEND_API_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
ARKE_API_URL=$(grep "^ARKE_API_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")

BACKEND_API_URL=${BACKEND_API_URL:-https://ipfs-api.arke.institute}
ARKE_API_URL=${ARKE_API_URL:-https://api.arke.institute}

AWS_REGION="us-east-1"
INSTANCE_NAME="arke-pinecone-mirror-new"
KEY_NAME="${INSTANCE_NAME}-key"
KEY_FILE="$HOME/.ssh/${KEY_NAME}.pem"

print_step "Getting AWS resources..."
AMI_ID=$(aws ec2 describe-images \
    --region $AWS_REGION \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023*-kernel-*-x86_64" "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)

VPC_ID=$(aws ec2 describe-vpcs \
    --region $AWS_REGION \
    --filters "Name=isDefault,Values=true" \
    --query 'Vpcs[0].VpcId' \
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
else
    SG_ID=$(aws ec2 create-security-group \
        --region $AWS_REGION \
        --group-name $SG_NAME \
        --description "Arke Mirror" \
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

# Launch without specifying subnet (let AWS pick AZ)
print_step "Launching instance (AWS will auto-select AZ)..."

USER_DATA='#!/bin/bash
dnf update -y
dnf install -y docker
systemctl start docker
systemctl enable docker
usermod -a -G docker ec2-user
mkdir -p /var/lib/arke-mirror
chown ec2-user:ec2-user /var/lib/arke-mirror'

INSTANCE_ID=$(aws ec2 run-instances \
    --region $AWS_REGION \
    --image-id $AMI_ID \
    --instance-type t3a.micro \
    --key-name $KEY_NAME \
    --security-group-ids $SG_ID \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=8,VolumeType=gp3}' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --user-data "$USER_DATA" \
    --query 'Instances[0].InstanceId' \
    --output text)

print_success "Instance launched: $INSTANCE_ID"

print_step "Waiting for instance..."
aws ec2 wait instance-running --region $AWS_REGION --instance-ids $INSTANCE_ID

PUBLIC_IP=$(aws ec2 describe-instances \
    --region $AWS_REGION \
    --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)

print_success "Running at: $PUBLIC_IP"

# Wait for SSH and Docker
sleep 60

SSH_OPTS="-i $KEY_FILE -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

print_step "Testing SSH..."
MAX_RETRIES=10
for i in $(seq 1 $MAX_RETRIES); do
    if ssh $SSH_OPTS ec2-user@$PUBLIC_IP "echo ready" &> /dev/null; then
        print_success "SSH ready"
        break
    fi
    sleep 5
done

# Deploy
print_step "Uploading code..."
ssh $SSH_OPTS ec2-user@$PUBLIC_IP 'mkdir -p ~/arke-mirror'

rsync -az -e "ssh $SSH_OPTS" \
    --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
    --exclude '*.log' --exclude 'mirror-state.json' --exclude 'mirror-data.jsonl' \
    "$PROJECT_DIR/" ec2-user@$PUBLIC_IP:~/arke-mirror/

print_success "Code uploaded"

print_step "Building and starting container..."
ssh $SSH_OPTS ec2-user@$PUBLIC_IP "cd ~/arke-mirror && docker build -t arke-mirror:latest . && docker run -d --name arke-mirror --restart unless-stopped -e BACKEND_API_URL=$BACKEND_API_URL -e ARKE_API_URL=$ARKE_API_URL -e ENABLE_PINECONE=true -e OPENAI_API_KEY=$OPENAI_KEY -e PINECONE_API_KEY=$PINECONE_KEY -e STATE_FILE_PATH=/data/mirror-state.json -e DATA_FILE_PATH=/data/mirror-data.jsonl -e NODE_ENV=production -v /var/lib/arke-mirror:/data arke-mirror:latest"

sleep 3
print_success "Container started!"

# Save info
cat > "$PROJECT_DIR/aws-instance-info.txt" <<EOF
Instance ID: $INSTANCE_ID
Public IP: $PUBLIC_IP
SSH: ssh -i $KEY_FILE ec2-user@$PUBLIC_IP
Logs: ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'docker logs -f arke-mirror'
EOF

echo ""
echo "Deployment complete!"
echo "View logs: ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'docker logs -f arke-mirror'"
