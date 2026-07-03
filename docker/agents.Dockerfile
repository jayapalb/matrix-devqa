# Matrix device agents (SDK + all mock agents). Context: ../matrix-device-agents
# The specific agent is selected by the compose `command`. Zero hard deps —
# the SDK is dependency-light; `mqtt` is an optional peer (HTTP-only without it).
# node 22+: global WebSocket client (the barco events bridge needs it)
FROM node:22-alpine
WORKDIR /agents
COPY . .
# mqtt is an optional SDK peer — install it so agents use the room broker
# (Last-Will presence + retained state). Absent, agents run HTTP-only.
RUN npm install mqtt@^5 --no-audit --no-fund 2>/dev/null || true
# barco 4550 · light 4520 · recorder 4530 · display 4540 · pump 4560 · shaver 4570
EXPOSE 4520 4530 4540 4550 4560 4570
CMD ["node", "light-controller-agent/agent.mjs"]
