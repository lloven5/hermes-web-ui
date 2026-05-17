ARG BASE_IMAGE=hermes-agent:v2
FROM ${BASE_IMAGE}

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then NODE_ARCH="x64"; else NODE_ARCH="$ARCH"; fi \
    && echo "Downloading Node.js v23.11.0 for ${NODE_ARCH}" \
    && curl -fsSL "https://nodejs.org/dist/v23.11.0/node-v23.11.0-linux-${NODE_ARCH}.tar.gz" \
       -o /tmp/node.tar.gz \
    && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 \
    && rm -f /tmp/node.tar.gz \
    && node --version

WORKDIR /app

COPY package*.json ./
# Increase Node.js memory limit to prevent OOM during build
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm install --ignore-scripts && npm rebuild node-pty

COPY . .

# Use vite build and build-server script without vue-tsc type checking
RUN npx vite build && node scripts/build-server.mjs && npm prune --omit=dev

ENV NODE_ENV=production
ENV HERMES_HOME=/opt/data
ENV HOME=/opt/data

EXPOSE 3003

# 强制覆盖基础镜像的默认启动脚本，让镜像本身具备独立运行的能力
ENTRYPOINT ["node", "dist/server/index.js"]
CMD []
