FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN useradd --create-home --shell /usr/sbin/nologin app

WORKDIR /app
RUN chown app:app /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --chown=app:app package.json package-lock.json ./
USER app
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=app:app src ./src
COPY --chown=app:app public ./public

EXPOSE 3000

CMD ["npm", "start"]

