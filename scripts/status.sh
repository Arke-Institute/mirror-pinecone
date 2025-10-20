#!/bin/bash
# Check status of deployed Arke Mirror instance
# Reads connection info from aws-instance-info.txt

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INFO_FILE="$PROJECT_DIR/aws-instance-info.txt"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}$1${NC}"; }
print_header() { echo -e "${BLUE}$1${NC}"; }

# Check if deployment exists
if [ ! -f "$INFO_FILE" ]; then
    print_error "No deployment found"
    echo "Run ./scripts/deploy-to-aws-docker.sh first"
    exit 1
fi

# Parse instance info
INSTANCE_ID=$(grep "Instance ID:" "$INFO_FILE" | awk '{print $3}')
PUBLIC_IP=$(grep "Public IP:" "$INFO_FILE" | awk '{print $3}')
REGION=$(grep "Region:" "$INFO_FILE" | awk '{print $2}')
SSH_KEY=$(grep "SSH Key:" "$INFO_FILE" | awk '{print $3}')
PINECONE_INDEX=$(grep "Pinecone Index:" "$INFO_FILE" | awk '{print $3}' || echo "unknown")

echo ""
print_header "=== Arke Mirror Status ==="
echo ""

# Check EC2 instance state
print_info "Checking EC2 instance..."
INSTANCE_STATE=$(aws ec2 describe-instances \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text 2>/dev/null || echo "unknown")

if [ "$INSTANCE_STATE" = "running" ]; then
    print_success "Instance $INSTANCE_ID is running"
    echo "  IP: $PUBLIC_IP"
    echo "  Region: $REGION"
elif [ "$INSTANCE_STATE" = "stopped" ]; then
    print_error "Instance is stopped"
    exit 1
elif [ "$INSTANCE_STATE" = "terminated" ]; then
    print_error "Instance has been terminated"
    exit 1
else
    print_error "Instance state: $INSTANCE_STATE"
    exit 1
fi

echo ""
print_info "Checking Docker container..."

# SSH options
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10"

# Check container status
CONTAINER_STATUS=$(ssh $SSH_OPTS ec2-user@$PUBLIC_IP 'docker ps --filter name=arke-mirror --format "{{.Status}}"' 2>/dev/null || echo "")

if [ -z "$CONTAINER_STATUS" ]; then
    print_error "Container not found or not running"
    exit 1
else
    print_success "Container: $CONTAINER_STATUS"
fi

echo ""
print_info "Fetching mirror state..."

# Get mirror state
STATE_JSON=$(ssh $SSH_OPTS ec2-user@$PUBLIC_IP 'cat /var/lib/arke-mirror/mirror-state.json 2>/dev/null' || echo "{}")

if [ "$STATE_JSON" = "{}" ]; then
    print_error "Could not read mirror state"
    exit 1
fi

# Parse state (using jq if available, otherwise simple grep)
if command -v jq &> /dev/null; then
    TOTAL_ENTITIES=$(echo "$STATE_JSON" | jq -r '.total_entities // 0')
    LAST_POLL=$(echo "$STATE_JSON" | jq -r '.last_poll_time // "never"')
    BACKOFF=$(echo "$STATE_JSON" | jq -r '.backoff_seconds // 0')
    PHASE=$(echo "$STATE_JSON" | jq -r '.phase // "unknown"')

    # Pinecone stats
    PROCESSED=$(echo "$STATE_JSON" | jq -r '.pinecone.processed_count // 0')
    FAILED=$(echo "$STATE_JSON" | jq -r '.pinecone.failed_count // 0')
    SKIPPED=$(echo "$STATE_JSON" | jq -r '.pinecone.skipped_count // 0')
    QUEUE_SIZE=$(echo "$STATE_JSON" | jq -r '.pinecone.queue_size // 0')
    LAST_PROCESSED=$(echo "$STATE_JSON" | jq -r '.pinecone.last_processed_time // "never"')
else
    # Fallback without jq
    TOTAL_ENTITIES=$(echo "$STATE_JSON" | grep -o '"total_entities":[0-9]*' | grep -o '[0-9]*' || echo "0")
    LAST_POLL=$(echo "$STATE_JSON" | grep -o '"last_poll_time":"[^"]*"' | cut -d'"' -f4 || echo "never")
    BACKOFF=$(echo "$STATE_JSON" | grep -o '"backoff_seconds":[0-9]*' | grep -o '[0-9]*' || echo "0")
    PHASE=$(echo "$STATE_JSON" | grep -o '"phase":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

    PROCESSED=$(echo "$STATE_JSON" | grep -o '"processed_count":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")
    FAILED=$(echo "$STATE_JSON" | grep -o '"failed_count":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")
    SKIPPED=$(echo "$STATE_JSON" | grep -o '"skipped_count":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")
    QUEUE_SIZE=$(echo "$STATE_JSON" | grep -o '"queue_size":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")
fi

echo ""
print_header "Mirror Statistics:"
echo "  Phase:           $PHASE"
echo "  Total Entities:  $TOTAL_ENTITIES"
echo "  Last Poll:       $LAST_POLL"
echo "  Backoff:         ${BACKOFF}s"

echo ""
print_header "Pinecone ($PINECONE_INDEX):"
echo "  Processed:       $PROCESSED vectors"
echo "  Failed:          $FAILED"
echo "  Skipped:         $SKIPPED"
echo "  Queue Size:      $QUEUE_SIZE"

echo ""
print_info "Recent logs (last 10 lines):"
echo -e "${GRAY}"
ssh $SSH_OPTS ec2-user@$PUBLIC_IP 'docker logs --tail 10 arke-mirror 2>&1' || echo "Could not fetch logs"
echo -e "${NC}"

echo ""
print_success "Mirror is healthy and running"
echo ""
echo "Commands:"
echo "  View logs:   ssh -i $SSH_KEY ec2-user@$PUBLIC_IP 'docker logs -f arke-mirror'"
echo "  Restart:     ssh -i $SSH_KEY ec2-user@$PUBLIC_IP 'docker restart arke-mirror'"
echo ""
