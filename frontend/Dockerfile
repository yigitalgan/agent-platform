FROM node:20-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

# Dev server with hot-reload; source is bind-mounted via compose.
CMD ["npm", "run", "dev"]
