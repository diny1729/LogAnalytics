# Step 1: Install all dependencies & build application
FROM node:22-alpine AS build
WORKDIR /app

# Copy root workspace manifests
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json

# Install dependencies for both workspaces
RUN npm install --no-audit

# Copy source code and build dist bundles
COPY server server
COPY client client
RUN npm run build

# Prune devDependencies to keep only production packages
RUN npm prune --omit=dev --no-audit

# Step 2: Production Runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy production node_modules from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

# Security: Run as non-root user
USER node

WORKDIR /app/server
EXPOSE 8080

CMD ["node", "dist/index.js"]
