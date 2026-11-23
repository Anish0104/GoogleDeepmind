FROM node:22-slim AS runner

# Install FFmpeg and essential media libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV NEXT_TELEMETRY_DISABLED=1

# Enable and prepare pnpm
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy package manifests
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy application source code
COPY . .

# Build Next.js production bundle
RUN pnpm build

# Expose the Cloud Run port
EXPOSE 8080

CMD ["sh", "-c", "pnpm start -- -p ${PORT:-8080} -H 0.0.0.0"]
