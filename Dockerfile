# Dockerfile - TrialSetu CTMS Production Cloud Deployment
FROM node:22-bookworm-slim

# Install security updates
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source code and frontend
COPY src/ ./src/
COPY public/ ./public/
COPY n8n_voice_ae_reporting.json ./

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/trialsetu.sqlite

# Create volume mount point for persistent SQLite database
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user for least-privilege security
USER node

# Expose HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/dashboard/leadership').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start TrialSetu
CMD ["node", "src/server.js"]
