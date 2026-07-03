# Generic standalone Node service (registry · audit · app-store · arthrex).
# Reused across contexts — each supplies its own package.json + `npm start`.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev 2>/dev/null || npm install 2>/dev/null || true
COPY . .
CMD ["npm", "start"]
