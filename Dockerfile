FROM node:22-alpine

WORKDIR /app

# Instala todas as dependencias (incluindo devDependencies, necessarias para o build)
COPY package.json ./
RUN npm install

# Copia o restante do codigo e gera o build de producao (Vite + esbuild do server.ts)
COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
