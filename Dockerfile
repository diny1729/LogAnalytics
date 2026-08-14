# Step 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install --prefix server && npm install --prefix client

# Step 2: Build client & server static assets & TypeScript
FROM deps AS build
WORKDIR /app
COPY server server
COPY client client
RUN npm run build --prefix server && npm run build --prefix client

# Step 3: Production Runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy package manifests and install only production dependencies
COPY server/package.json server/package.json
RUN npm install --prefix server --omit=dev && npm cache clean --force

# Copy built application code
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# Security: Run as non-root user
USER node

WORKDIR /app/server
EXPOSE 8080

CMD ["node", "dist/index.js"]
