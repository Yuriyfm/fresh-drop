FROM node:20-alpine AS app

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package.json yarn.lock .yarnrc ./
RUN TMPDIR=/tmp yarn install --frozen-lockfile

COPY . .
RUN TMPDIR=/tmp yarn build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

EXPOSE 4173

CMD ["yarn", "start"]
