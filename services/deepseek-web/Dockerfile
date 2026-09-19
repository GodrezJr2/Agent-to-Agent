FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8790
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8790/health || exit 1
CMD ["node", "src/index.js"]
