#!/bin/bash
# Live monitoring for deployed Arke Mirror instance
# Auto-refreshes status every 10 seconds

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INFO_FILE="$PROJECT_DIR/aws-instance-info.txt"

# Parse arguments
MODE="dashboard"
INTERVAL=10

while [[ $# -gt 0 ]]; do
    case $1 in
        --logs)
            MODE="logs"
            shift
            ;;
        --interval)
            INTERVAL="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --logs           Follow Docker logs (tail -f mode)"
            echo "  --interval N     Refresh interval in seconds (default: 10)"
            echo "  -h, --help       Show this help"
            echo ""
            echo "Examples:"
            echo "  $0               # Dashboard mode, refresh every 10s"
            echo "  $0 --interval 5  # Dashboard mode, refresh every 5s"
            echo "  $0 --logs        # Just follow logs"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Run with --help for usage"
            exit 1
            ;;
    esac
done

# Check if deployment exists
if [ ! -f "$INFO_FILE" ]; then
    echo "Error: No deployment found"
    echo "Run ./scripts/deploy-to-aws-docker.sh first"
    exit 1
fi

# Parse connection info
PUBLIC_IP=$(grep "Public IP:" "$INFO_FILE" | awk '{print $3}')
SSH_KEY=$(grep "SSH Key:" "$INFO_FILE" | awk '{print $3}')

SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

# Logs mode - just follow docker logs
if [ "$MODE" = "logs" ]; then
    echo "Following Docker logs (Ctrl+C to exit)..."
    echo ""
    ssh $SSH_OPTS ec2-user@$PUBLIC_IP 'docker logs -f --tail 50 arke-mirror'
    exit 0
fi

# Dashboard mode
echo "Starting live monitor (Ctrl+C to exit)"
echo "Refresh interval: ${INTERVAL}s"
echo ""
sleep 2

# Trap Ctrl+C for clean exit
trap 'echo ""; echo "Monitoring stopped"; exit 0' INT

while true; do
    clear

    # Header with timestamp
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          Arke Mirror Live Monitor                              ║"
    echo "║  $(date '+%Y-%m-%d %H:%M:%S')                                        ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    # Run status script (suppress the commands at the bottom)
    STATUS_OUTPUT=$("$SCRIPT_DIR/status.sh" 2>/dev/null || echo "")

    if [ -z "$STATUS_OUTPUT" ]; then
        echo "Error: Failed to get status"
        echo "The instance may be down or unreachable"
    else
        # Show everything except the last "Commands:" section
        echo "$STATUS_OUTPUT" | sed -n '/^Commands:/q;p'
    fi

    echo ""
    echo "────────────────────────────────────────────────────────────────"
    echo "Auto-refresh: ${INTERVAL}s | Press Ctrl+C to exit | For logs: $0 --logs"

    sleep "$INTERVAL"
done
