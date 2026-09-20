FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/cache/home \
    NPM_CONFIG_CACHE=/cache/npm \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    curl \
    git \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /cache/home /cache/npm \
  && chmod -R 0777 /cache

WORKDIR /workspace
ENTRYPOINT ["node", "scripts/test-in-docker.mjs"]
