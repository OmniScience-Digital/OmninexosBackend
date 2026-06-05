FROM node:22

WORKDIR /src

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 5001

CMD ["node", "dist/server.js"]