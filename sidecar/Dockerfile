FROM node:22-alpine

WORKDIR /app
COPY sidecar/src ./src

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

USER node
CMD ["node", "src/server.mjs"]
