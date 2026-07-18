# Step 1: Build the React frontend and bundle the backend server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./
RUN npm ci

# Copy the rest of the application files
COPY . .

# Run build (vite build + esbuild server bundle)
RUN npm run build

# Step 2: Create the production runtime image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package configuration
COPY package*.json ./

# Install production-only dependencies
RUN npm ci --only=production

# Copy built assets and server binary from the builder stage
COPY --from=builder /app/dist ./dist

# Create an empty config.json file so it can be mounted as a file or directory safely if desired
RUN echo "{}" > config.json

# Expose Port 3000
EXPOSE 3000

# Start the Node.js production server
CMD ["npm", "run", "start"]
