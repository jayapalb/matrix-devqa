# Matrix Planner monorepo (api · web · ehr-adapter). Context: ../matrix-planner
# The service (api / web / ehr) is selected by the compose `command`.
FROM node:20-alpine
WORKDIR /app
# Install with the workspace manifests present for a cacheable layer.
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/ehr-adapter/package.json apps/ehr-adapter/package.json
COPY packages/contract/package.json packages/contract/package.json
RUN npm install
COPY . .
# api 4500 · web 5500 · ehr 4600 (exposed; published per service in compose)
EXPOSE 4500 5500 4600
CMD ["npm", "run", "dev", "--workspace", "@matrix/api"]
