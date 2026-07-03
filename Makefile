# Matrix Plus dev environment — convenience targets.
# Usage: make certs && make up && make smoke   (make down to stop)

COMPOSE = docker compose
CERTS = certs/site-cert-package/operating-rooms/OR-03/room-auth.json

.PHONY: help certs up up-core up-devices down logs ps smoke shell-env clean

help:
	@echo "Matrix Plus dev environment"
	@echo "  make certs      generate room-auth certs (run once)"
	@echo "  make up         build + start the whole platform"
	@echo "  make up-core    control plane only (planner, registry, audit, ehr, app-store)"
	@echo "  make up-devices device agents only (needs core up)"
	@echo "  make down       stop + remove"
	@echo "  make logs       tail all logs"
	@echo "  make ps         service status"
	@echo "  make smoke      health-check every service"
	@echo "  make shell-env  print the env for Matrix Shell (run on the laptop)"

certs: $(CERTS)
$(CERTS):
	@echo "generating room-auth certs for SITE-001 (OR-01..03) + cart package"
	cd ../matrix-tools/room-cert-gen && node src/index.cjs generate --siteId SITE-001 --siteName "Demo Hospital" --rooms 3 --out $(CURDIR)/certs/site-cert-package
	cd ../matrix-tools/room-cert-gen && node src/index.cjs export-cart --package $(CURDIR)/certs/site-cert-package --out $(CURDIR)/certs/cart

up: certs
	$(COMPOSE) up --build -d
	@echo "up. planner-web → http://localhost:$${PLANNER_WEB_PORT:-5500}  registry console → http://localhost:$${REGISTRY_PORT:-4430}/assets/room.html?siteId=SITE-001&roomId=OR-03"

up-core: certs
	$(COMPOSE) up --build -d device-registry audit-service ehr-adapter planner-api planner-web app-store arthrex-surgeon

up-devices: certs
	$(COMPOSE) up --build -d barco-agent light-agent recorder-agent display-agent pump-agent shaver-agent

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=50

ps:
	$(COMPOSE) ps

surgery: ## Run the headless end-to-end simulated surgery (the story, asserted)
	node scripts/run-surgery.mjs

chaos: ## Inject exceptions into the running OR and assert it FAILS SAFE
	node scripts/run-chaos.mjs

shell-units: ## Layer-1 shell unit tests (no docker): electron main (node:test) + renderer panels (vitest)
	npm --prefix ../matrix-shell run check

shell-qa: ## Touchstone electron mode: test the REAL shell window (stop `make shell` first)
	npm --prefix . run qa:shell

shell-fuzz: ## Touchstone: hammer every IPC handler with hostile input on a THROWAWAY profile (stop `make shell` first)
	npm --prefix . run qa:fuzz

campaign: ## Touchstone: simulate a DAY of cases with woven chaos, collect data (QA_CAMPAIGN_CASES=N)
	npm --prefix . run qa:campaign

campaign-install: ## One-time: install the touchstone QA host deps
	npm --prefix . install

test-all: ## Every unit/integration suite across the platform
	cd ../matrix-device-agents && node --test sdk/src/*.test.mjs
	cd ../matrix-device-agents/barco-agent && npm test
	cd ../matrix-device-registry && node --test
	cd ../matrix-planner && npm test --workspace @matrix/contract && npm test --workspace @matrix/api
	cd ../matrix-shell && npm test

ci: ## The CI gate: unit suites, then the full simulated OR from scratch
	$(MAKE) test-all
	$(MAKE) up
	sleep 25
	bash scripts/smoke.sh
	node scripts/run-surgery.mjs
	node scripts/run-chaos.mjs

smoke:
	./scripts/smoke.sh

shell: ## Launch the native Electron shell wired to this stack (window opens on your screen)
	cd ../matrix-shell && npm run dev

shell-env:
	@echo "# Point Matrix Shell (Electron, on the laptop) at the dockerized services:"
	@echo "export MATRIX_PLANNER_URL=http://localhost:$${PLANNER_API_PORT:-14500}"
	@echo "export MATRIX_CASE_WORKLIST_URL=http://localhost:$${EHR_PORT:-14600}/v1/worklist"
	@echo "export MATRIX_AUDIT_URL=http://localhost:$${AUDIT_PORT:-4460}"
	@echo "export MATRIX_BARCO_AGENT_URL=http://localhost:$${BARCO_PORT:-4550}"
	@echo "export MATRIX_SNAPSHOT_TRUST=warn"
	@echo "# Room identity: matrix-shell/.env is pre-wired; or import certs/.../OR-03/room-auth.json in Shell Settings."

clean: down
	docker volume rm matrix-plus-dev_planner-data matrix-plus-dev_audit-data matrix-plus-dev_registry-data 2>/dev/null || true
