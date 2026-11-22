# Railway build: Node app + Python notebooklm-py CLI (chapter video explainers) + ffmpeg (video compression).
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv pipx ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# notebooklm-py CLI on PATH (auth comes from NOTEBOOKLM_AUTH_JSON at runtime; no browser extra needed)
ENV PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin
RUN pipx install notebooklm-py && notebooklm --version

WORKDIR /app
COPY package.json ./
COPY server/package.json server/package-lock.json server/
COPY web/package.json web/package-lock.json web/
RUN npm --prefix server ci --include=dev && npm --prefix web ci --include=dev

COPY . .
RUN npm --prefix web run build

ENV NODE_ENV=production
CMD ["npm", "start"]
