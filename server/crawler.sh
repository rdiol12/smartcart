#!/bin/bash
set -euo pipefail

# Args
SKIP_CRAWL=false
KEEP_FILES=false
IDLE_SECONDS=120
MAX_MINUTES=45

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-crawl)
            SKIP_CRAWL=true
            shift
            ;;
        --keep-files)
            KEEP_FILES=true
            shift
            ;;
        --idle-seconds)
            IDLE_SECONDS="$2"
            shift 2
            ;;
        --max-minutes)
            MAX_MINUTES="$2"
            shift 2
            ;;
        -h|--help)
            cat <<EOF
Usage: $0 [options]
  --skip-crawl           Skip docker crawler, run parser only on existing dumps
  --keep-files           Don't wipe TARGET_DIR before crawling
  --idle-seconds N       Stop crawler after N seconds with no new files (default 120)
  --max-minutes N        Hard ceiling on crawler runtime in minutes (default 45)
EOF
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# Load .env. The previous `export $(grep -v '^#' "$ENV_FILE" | xargs)` was a
# minefield: xargs split on whitespace (so any value containing a space broke
# everything after it), stripped/mangled quotes, expanded $-tokens through
# the subshell, and treated multi-line values as multiple args. `set -a`
# tells bash to auto-export every variable until `set +a`, so source-ing
# the file Just Works for normal KEY=value lines (including values with
# spaces, quotes, and $-signs).
ENV_FILE="$(dirname "$0")/.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
else
    echo "ERROR: .env file not found at $ENV_FILE"
    exit 1
fi

# Validate required vars
for var in PROJECT_DIR TARGET_DIR; do
    if [ -z "${!var:-}" ]; then
        echo "ERROR: Missing required env variable: $var"
        exit 1
    fi
done

echo "=== Starting Supermarket Data Update Process ==="
echo "Timestamp: $(date)"

if [ "$SKIP_CRAWL" = true ]; then
    echo "[1-3/4] --skip-crawl set: skipping wipe + docker crawler, using existing files in $TARGET_DIR"
    if [ ! -d "$TARGET_DIR" ]; then
        echo "ERROR: TARGET_DIR does not exist: $TARGET_DIR" >&2
        exit 1
    fi
else
    # Step 1: Prepare directory
    if [ ! -d "$TARGET_DIR" ]; then
        echo "[1/4] Creating directory: $TARGET_DIR"
        mkdir -p "$TARGET_DIR"
    elif [ "$KEEP_FILES" = true ]; then
        echo "[1/4] --keep-files set: keeping existing files in $TARGET_DIR"
    else
        echo "[1/4] Cleaning old files in $TARGET_DIR..."
        rm -rf "${TARGET_DIR:?}"/*
    fi

    # Step 2: Run Docker crawler in detached mode with auto-stop.
    # The image runs a polling loop that never exits on its own; we watch
    # TARGET_DIR for new files and stop the container once downloads stabilize.
    CONTAINER="smartcart-scraper-$$"
    echo "[2/4] Starting Docker crawler as container $CONTAINER ..."

    # Image tag is overridable via $SCRAPER_IMAGE so operators can pin to a
    # known-good digest (e.g. erlichsefi/...@sha256:...) without editing
    # this script. Default stays at :latest for convenience, but doing so
    # means a pipeline that affects what users see can change overnight if
    # upstream pushes a new image. Pin in env for anything production.
    SCRAPER_IMAGE="${SCRAPER_IMAGE:-erlichsefi/israeli-supermarket-scarpers:latest}"
    docker run -d --name "$CONTAINER" -v "${TARGET_DIR}:/usr/src/app/dumps" \
        "$SCRAPER_IMAGE" > /dev/null

    # Make sure the container is cleaned up even if we're interrupted.
    cleanup() {
        docker stop "$CONTAINER" >/dev/null 2>&1 || true
        docker rm "$CONTAINER" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT INT TERM

    start_ts=$(date +%s)
    last_change=$start_ts
    last_count=0
    while true; do
        sleep 15
        now=$(date +%s)
        elapsed_min=$(( (now - start_ts) / 60 ))
        if [ "$elapsed_min" -ge "$MAX_MINUTES" ]; then
            echo "  Reached --max-minutes=$MAX_MINUTES, stopping crawler."
            break
        fi

        current=$(find "$TARGET_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
        if [ "$current" -gt "$last_count" ]; then
            delta=$(( current - last_count ))
            last_count=$current
            last_change=$now
            echo "  Downloaded: $current files (+$delta in last 15s, elapsed ${elapsed_min} min)"
        else
            idle=$(( now - last_change ))
            if [ "$current" -gt 0 ] && [ "$idle" -ge "$IDLE_SECONDS" ]; then
                echo "  No new files for ${idle}s with $current files downloaded. Stopping crawler."
                break
            fi
            echo "  Idle: ${idle}s ($current files, waiting up to ${IDLE_SECONDS}s)"
        fi
    done

    cleanup
    trap - EXIT INT TERM

    echo "[3/4] Crawler stopped. Files in: $TARGET_DIR"
fi

# Step 3: Import to database
echo "[4/4] Importing prices to database..."
cd "$(dirname "$0")"
node db/run-parser.js

echo "=== Process Completed Successfully! ==="
echo "Database updated with fresh supermarket prices."
