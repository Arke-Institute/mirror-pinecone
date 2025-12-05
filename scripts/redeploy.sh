#!/bin/bash
# Redeploy to existing AWS instance
# Updates code and restarts the Docker container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }
print_step() { echo -e "${BLUE}▶ $1${NC}"; }

# Load instance info
INFO_FILE="$PROJECT_DIR/aws-instance-info.txt"
if [ ! -f "$INFO_FILE" ]; then
    echo "ERROR: No instance info file found at: $INFO_FILE"
    echo "Please run deploy-to-aws-docker.sh first"
    exit 1
fi

PUBLIC_IP=$(grep "Public IP:" "$INFO_FILE" | awk '{print $3}')
SSH_KEY=$(grep "SSH Key:" "$INFO_FILE" | awk '{print $3}')

if [ -z "$PUBLIC_IP" ] || [ -z "$SSH_KEY" ]; then
    echo "ERROR: Could not parse instance info from $INFO_FILE"
    exit 1
fi

SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

echo "========================================="
echo "Arke Mirror - Redeploy to Existing Instance"
echo "========================================="
echo ""
echo "Instance IP: $PUBLIC_IP"
echo ""

# Load environment variables for container
print_step "Loading configuration..."
ENV_FILE="$PROJECT_DIR/.env"
OPENAI_KEY=$(grep "^OPENAI_API_KEY=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
PINECONE_KEY=$(grep "^PINECONE_API_KEY=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
BACKEND_API_URL=$(grep "^BACKEND_API_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
ARKE_API_URL=$(grep "^ARKE_API_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
ENABLE_PINECONE=$(grep "^ENABLE_PINECONE=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")

BACKEND_API_URL=${BACKEND_API_URL:-https://ipfs-api.arke.institute}
ARKE_API_URL=${ARKE_API_URL:-https://api.arke.institute}
ENABLE_PINECONE=${ENABLE_PINECONE:-true}

print_success "Configuration loaded"
echo ""

# Upload new code
print_step "Uploading updated code..."
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

print_success "Code uploaded"
echo ""

# Rebuild and restart container
print_step "Rebuilding Docker image and restarting container..."

ssh $SSH_OPTS ec2-user@$PUBLIC_IP <<ENDSSH
set -e

cd ~/arke-mirror

# Build new Docker image
echo "Building Docker image..."
docker build -t arke-mirror:latest . > /dev/null 2>&1

# Stop and remove old container
echo "Stopping old container..."
docker stop arke-mirror 2>/dev/null || true
docker rm arke-mirror 2>/dev/null || true

# Start new container
echo "Starting new container..."
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

# Wait for container to start
sleep 3

# Show container status
docker ps --filter name=arke-mirror --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

echo ""
echo "Container restarted successfully!"
ENDSSH

print_success "Deployment complete!"
echo ""
echo "========================================="
echo ""
echo "View logs:"
echo "  ssh -i $SSH_KEY ec2-user@$PUBLIC_IP 'docker logs -f arke-mirror'"
echo ""

# Offer to show logs
read -p "View live logs now? (y/n): " VIEW_LOGS
if [ "$VIEW_LOGS" = "y" ] || [ "$VIEW_LOGS" = "Y" ]; then
    echo ""
    print_info "Connecting to view logs (Ctrl+C to exit)..."
    echo ""
    sleep 2
    ssh $SSH_OPTS ec2-user@$PUBLIC_IP 'docker logs -f --tail 50 arke-mirror'
fi
