FROM node:22.19.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
ENV DEPLOY_TARGET=node
RUN npm run build

FROM node:22.19.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY solver_service/requirements.txt /tmp/solver-requirements.txt
RUN python3 -m venv /opt/solver \
    && /opt/solver/bin/pip install --no-cache-dir -r /tmp/solver-requirements.txt
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production DEPLOY_TARGET=node PYTHON_EXECUTABLE=/opt/solver/bin/python \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 NODE_OPTIONS=--max-old-space-size=256 \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
EXPOSE 10000
CMD ["node", "scripts/start-render.mjs"]
