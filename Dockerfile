# Step 1: Build the React frontend and bundle the backend server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application files (see .dockerignore)
COPY . .

# Run build (vite build + esbuild server bundle)
RUN npm run build

# Step 2: Create the production runtime image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
# Settings (including bot tokens and API keys) live here; mount a volume on /app/data to keep them.
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

CMD ["node", "dist/server.cjs"]
