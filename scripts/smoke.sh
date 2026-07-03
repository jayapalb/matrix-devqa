#!/usr/bin/env bash
# Health-check every service + prove the device tier registered into the room.
set -u
source .env 2>/dev/null || true

pass=0; fail=0
check() { # name url
  if curl -fsS -m 4 "$2" >/dev/null 2>&1; then echo "  OK   $1 ($2)"; pass=$((pass+1)); else echo "  FAIL $1 ($2)"; fail=$((fail+1)); fi
}

echo "== HTTP health =="
check "planner-web"     "http://localhost:${PLANNER_WEB_PORT:-5500}/"
check "planner-api"     "http://localhost:${PLANNER_API_PORT:-4500}/health"
check "ehr-adapter"     "http://localhost:${EHR_PORT:-4600}/v1/worklist"
check "device-registry" "http://localhost:${REGISTRY_PORT:-4430}/health"
check "audit-service"   "http://localhost:${AUDIT_PORT:-4460}/health"
check "app-store"       "http://localhost:${APPSTORE_PORT:-4410}/"
check "arthrex-surgeon" "http://localhost:${ARTHREX_PORT:-4402}/"

echo "== device tier registered into OR-03 =="
topo=$(curl -fsS -m 4 "http://localhost:${REGISTRY_PORT:-4430}/api/sites/SITE-001/rooms/OR-03/topology" 2>/dev/null)
if [ -n "$topo" ]; then
  echo "$topo" | python3 -c "import json,sys; t=json.load(sys.stdin)['topology']; [print('  -', d['deviceId'],'|',d['kind'],'|',d['presence']['state']) for d in t['devices']]" 2>/dev/null \
    && pass=$((pass+1)) || { echo "  FAIL topology parse"; fail=$((fail+1)); }
else
  echo "  FAIL registry topology unreachable"; fail=$((fail+1))
fi

echo "== planner readiness (live device merge) =="
curl -fsS -m 4 "http://localhost:${PLANNER_API_PORT:-4500}/api/rooms/OR-03/readiness" 2>/dev/null \
  | python3 -c "import json,sys; r=json.load(sys.stdin).get('report',{}); print('  live:', r.get('live')); [print('  LIVE', i['status'].upper(), i['label'], '·', i['detail']) for i in (r.get('items') or []) if '(live)' in (i.get('label') or '')]" 2>/dev/null || echo "  (no readiness / no bound case)"

echo ""
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
