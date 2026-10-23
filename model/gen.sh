#!/usr/bin/env bash
# Runs Hunyuan3D-2mv shape generation on the free HF Space and saves the GLB.
# usage: gen.sh <out.glb> <front path> <back path> <left path> [steps] [octree] [seed]
set -e
SPACE=https://tencent-hunyuan3d-2mv.hf.space
f() { printf '{"path":"%s","meta":{"_type":"gradio.FileData"}}' "$1"; }
DATA="{\"data\":[\"\",null,$(f "$2"),$(f "$3"),$(f "$4"),null,${5:-5},5,${7:-1234},${6:-256},true,8000,false]}"
ID=$(curl -s -m 60 -X POST "$SPACE/call/shape_generation" -H "Content-Type: application/json" -d "$DATA" | node -pe "JSON.parse(require('fs').readFileSync(0)).event_id")
RES=$(curl -s -N -m 560 "$SPACE/call/shape_generation/$ID" | grep '^data:' | tail -1 | cut -c7-)
P=$(printf '%s' "$RES" | node -pe "JSON.parse(require('fs').readFileSync(0))[0].value.path")
curl -s -m 180 -o "$1" "$SPACE/file=$P"
echo "saved $1 ($(stat -c %s "$1") bytes)"
