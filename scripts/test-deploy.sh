#!/bin/bash
# Test script for deploy-to-aws.sh
# This validates the .env reading logic without actually deploying

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }

echo "=================================="
echo "Testing deploy-to-aws.sh logic"
echo "=================================="
echo ""

# Test 1: Check .env file exists
print_info "Test 1: Checking .env file exists..."
ENV_FILE="$PROJECT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    print_success ".env file found at: $ENV_FILE"
else
    print_error ".env file not found at: $ENV_FILE"
    exit 1
fi
echo ""

# Test 2: Read environment variables
print_info "Test 2: Reading environment variables..."
OPENAI_KEY=$(grep "^OPENAI_API_KEY=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
PINECONE_KEY=$(grep "^PINECONE_API_KEY=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
BACKEND_API_URL=$(grep "^BACKEND_API_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
ARKE_API_URL=$(grep "^ARKE_API_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
ENABLE_PINECONE=$(grep "^ENABLE_PINECONE=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")

# Set defaults
BACKEND_API_URL=${BACKEND_API_URL:-https://ipfs-api.arke.institute}
ARKE_API_URL=${ARKE_API_URL:-https://api.arke.institute}
ENABLE_PINECONE=${ENABLE_PINECONE:-true}

echo "Variables read:"
echo "  OPENAI_KEY: ${OPENAI_KEY:0:10}... (${#OPENAI_KEY} chars)"
echo "  PINECONE_KEY: ${PINECONE_KEY:0:10}... (${#PINECONE_KEY} chars)"
echo "  BACKEND_API_URL: $BACKEND_API_URL"
echo "  ARKE_API_URL: $ARKE_API_URL"
echo "  ENABLE_PINECONE: $ENABLE_PINECONE"
echo ""

# Test 3: Validate required keys
print_info "Test 3: Validating required API keys..."
ERRORS=0

if [ -z "$OPENAI_KEY" ]; then
    print_error "OPENAI_API_KEY is empty or not found"
    ERRORS=$((ERRORS + 1))
elif [[ "$OPENAI_KEY" == "sk-..." ]] || [[ "$OPENAI_KEY" == *"your-"* ]]; then
    print_error "OPENAI_API_KEY looks like a placeholder value"
    ERRORS=$((ERRORS + 1))
else
    print_success "OPENAI_API_KEY is set (${#OPENAI_KEY} characters)"
fi

if [ -z "$PINECONE_KEY" ]; then
    print_error "PINECONE_API_KEY is empty or not found"
    ERRORS=$((ERRORS + 1))
elif [[ "$PINECONE_KEY" == "pcsk_..." ]] || [[ "$PINECONE_KEY" == *"your-"* ]]; then
    print_error "PINECONE_API_KEY looks like a placeholder value"
    ERRORS=$((ERRORS + 1))
else
    print_success "PINECONE_API_KEY is set (${#PINECONE_KEY} characters)"
fi
echo ""

# Test 4: Check prerequisites
print_info "Test 4: Checking prerequisites..."

if command -v aws &> /dev/null; then
    print_success "AWS CLI is installed: $(aws --version | head -n1)"
else
    print_error "AWS CLI not found"
    ERRORS=$((ERRORS + 1))
fi

if command -v rsync &> /dev/null; then
    print_success "rsync is installed"
else
    print_error "rsync not found"
    ERRORS=$((ERRORS + 1))
fi

if command -v ssh &> /dev/null; then
    print_success "SSH client is installed"
else
    print_error "SSH client not found"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Test 5: Check AWS credentials
print_info "Test 5: Checking AWS credentials..."
if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
    print_success "AWS credentials are configured"
    echo "  Account: $ACCOUNT_ID"
    echo "  User: $USER_ARN"
else
    print_error "AWS credentials not configured or invalid"
    echo "  Run: aws configure"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Test 6: Validate API URLs
print_info "Test 6: Testing API connectivity..."

echo -n "  Testing $BACKEND_API_URL... "
if curl -s --max-time 5 "$BACKEND_API_URL/snapshot/latest" > /dev/null 2>&1; then
    print_success "reachable"
else
    print_error "not reachable (this may be OK if API is down)"
fi

echo -n "  Testing $ARKE_API_URL... "
if curl -s --max-time 5 "$ARKE_API_URL" > /dev/null 2>&1; then
    print_success "reachable"
else
    print_error "not reachable (this may be OK if API requires auth)"
fi
echo ""

# Test 7: Check project files
print_info "Test 7: Checking project files..."
REQUIRED_FILES=(
    "package.json"
    "tsconfig.json"
    "src/mirror.ts"
    "config/nara-config.json"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$PROJECT_DIR/$file" ]; then
        print_success "$file exists"
    else
        print_error "$file not found"
        ERRORS=$((ERRORS + 1))
    fi
done
echo ""

# Summary
echo "=================================="
echo "Test Summary"
echo "=================================="
if [ $ERRORS -eq 0 ]; then
    print_success "All tests passed! Ready to deploy."
    echo ""
    echo "To deploy to AWS, run:"
    echo "  ./scripts/deploy-to-aws.sh"
    echo ""
    echo "WARNING: This will create real AWS resources and incur costs (~$8-9/month)"
    exit 0
else
    print_error "Found $ERRORS error(s). Please fix before deploying."
    exit 1
fi
