# Step 1: Build the React frontend and bundle the backend server
# The build output is plain JavaScript, so this stage always runs on the build
# machine's own CPU type, even when producing an image for another (e.g. ARM).
FROM --platform=$BUILDPLATFORM node:20-slim AS builder

WORKDIR /app

# Copy package files first for caching (the lockfile pins every package)
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application files (see .dockerignore)
COPY . .

# Run build (vite build + esbuild server bundle)
RUN npm run build

# Step 2: Create the production runtime image
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Settings (including bot tokens and API keys) live here; keep /app/data on a volume.
ENV CONFIG_PATH=/app/data/config.json

# Install production-only dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built assets and server bundle from the builder stage
COPY --from=builder /app/dist ./dist
COPY config.example.json ./

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# Lets Portainer show the container as Healthy once the dashboard answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/security/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
