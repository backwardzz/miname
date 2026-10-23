#!/usr/bin/env bash
# Creates the public repo backwardzz/miname and uploads the three edited reference views to ref/.
set -e
cd "$(dirname "$0")"
gh repo create backwardzz/miname --public --description "miname" || true
for v in front side back; do
  printf '{"message":"Add %s reference view","content":"%s"}' "$v" "$(base64 -w0 "${v}_edit.png")" > "body_$v.json"
  gh api -X PUT "repos/backwardzz/miname/contents/ref/$v.png" --input "body_$v.json" --jq .content.download_url
  rm "body_$v.json"
done
