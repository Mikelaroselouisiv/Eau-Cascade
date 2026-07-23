# Backend image (NestJS + Prisma) — buildé par GitHub Actions → ECR.
# OpenSSL + libc6-compat requis sur Alpine pour les binaires Prisma (migrate / client).
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat tzdata
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Port-au-Prince
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
# Le client Prisma valide est généré dans `builder` (schéma présent) ; `deps` n’a que le stub post-install.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
