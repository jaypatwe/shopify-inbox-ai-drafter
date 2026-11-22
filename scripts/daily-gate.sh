#!/bin/zsh
# Daily batch for the pilot gate, run by launchd at 05:45 local time (free quota resets 00:00 UTC).
#
#   Phase 1: draft replies into data/answer.csv until all 120 are done.
#   Phase 2: once the CSV is complete, grade with promptfoo (code checks + llm-rubric AI judge).
#
# Each run spends that day's 50 free OpenRouter requests and stops; cached work is never redone.
# When every reply is graded, it notifies you and removes its own launchd job.
#
# Manual run:  zsh scripts/daily-gate.sh
# Log:         logs/daily-gate.log

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1

PROJECT="${0:A:h:h}"
LABEL="local.shopify-reply-gate"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# Safety stop so a stuck job can't run forever.
STOP_AFTER="2026-12-15"

cd "$PROJECT" || exit 1
mkdir -p logs
exec >> logs/daily-gate.log 2>&1

notify() { osascript -e "display notification \"$1\" with title \"Shopify reply gate\"" >/dev/null 2>&1 || true; }
status() { node -e 'const s=require("./promptfoo/gate-status.json"); console.log(s[process.argv[1]])' "$1" 2>/dev/null; }
pending_answers() {
  node -e '
    const fs = require("fs"), Papa = require("papaparse");
    if (!fs.existsSync("data/answer.csv")) { console.log(120); process.exit(0); }
    const rows = Papa.parse(fs.readFileSync("data/answer.csv", "utf8"), { header: true, skipEmptyLines: true }).data;
    console.log(rows.filter((r) => !r.draft_status || r.draft_status === "pending").length);'
}
remove_job() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  rm -f "$PLIST"
}

echo ""
echo "================ $(date '+%Y-%m-%d %H:%M %Z') ================"

if [[ "$(date +%F)" > "$STOP_AFTER" ]]; then
  echo "Past $STOP_AFTER: removing the daily job."
  notify "Daily gate job stopped (past $STOP_AFTER). Check logs/daily-gate.log."
  remove_job
  exit 0
fi

before=$(pending_answers)
if (( before > 0 )); then
  echo "Phase 1: $before answers pending. Drafting..."
  npm run --silent answers
fi
after=$(pending_answers)

if (( after == 0 )); then
  echo "Phase 2: all 120 answers drafted. Grading with promptfoo..."
  npm run --silent grade
else
  echo "Phase 1: $after answers still pending (drafted $((before - after)) today). Grading starts once all 120 are drafted."
  npx tsx scripts/gate-report.ts >/dev/null
fi

drafted=$(status drafted); graded=$(status graded); passed=$(status passed); gate=$(status gate)
echo "Status: drafted $drafted/120, graded $graded/120, passed $passed, gate: $gate"

if [[ "$(status complete)" == "true" ]]; then
  notify "All 120 graded. Gate: $gate ($passed/120 passed). See promptfoo/gate-report.md"
  echo "Complete. Removing the daily job."
  remove_job
else
  notify "Today: drafted $drafted/120, graded $graded/120. Next batch tomorrow 05:45."
fi
