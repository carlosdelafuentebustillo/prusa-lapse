# ==============================================================================
# PrusaLapse - Production Multi-Stage Dockerfile
# Optimized for Next.js Standalone Mode + Alpine Linux + Built-in FFmpeg & Curl
# ==============================================================================

# --- Stage 1: Dependency & Build ---
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package definitions
COPY webapp/package.json webapp/package-lock.json* ./
RUN npm ci || npm install

# Copy application source
COPY webapp/ ./

# Environment variable to enable Next.js standalone tracing
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build standalone Next.js bundle
RUN npm run build

# --- Stage 2: Minimal Production Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app

# Install system dependencies:
# - ffmpeg: Required for high-speed multi-frame timelapse video rendering (H.264 / MP4)
# - curl: Required for robust ESP32-CAM OTA firmware flashing with TCP flow control
# - tzdata: Accurate timestamps for timelapse session organization
RUN apk add --no-cache ffmpeg curl tzdata

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV PRUSALAPSE_CONFIG_FILE=/app/config/prusa-lapse.config.json
ENV PRUSALAPSE_CAPTURES_DIR=/app/public/captures

# Create unprivileged system user for secure container execution
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Create required persistent mount directories
RUN mkdir -p /app/config /app/public/captures && \
    chown -R nextjs:nodejs /app/config /app/public/captures

# Copy standalone output from builder
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Ensure captures and config permissions
RUN chown -R nextjs:nodejs /app/public/captures /app/config

USER nextjs

EXPOSE 3000

# Persistent storage mount points
VOLUME ["/app/public/captures", "/app/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/config || exit 1

CMD ["node", "server.js"]
