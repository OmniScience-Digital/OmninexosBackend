FROM node:18

WORKDIR /src

COPY package*.json ./

# Install all dependencies including dev so tsc is available
RUN npm install

# Copy app source
COPY . .

# Build and copy assets
RUN npm run build && cp -r src/assets dist/assets

EXPOSE 5001

CMD ["node", "dist/server.js"]



# FROM node:22

# WORKDIR /src

# COPY package*.json ./

# # Install all dependencies including dev so tsc is available
# RUN npm install -g pm2 && npm install

# # Copy app source
# COPY . .

# # Build and copy assets
# RUN npm run build && cp -r src/assets dist/assets

# EXPOSE 5001

# # Run all processes under PM2
# CMD ["pm2-runtime", "ecosystem.config.js"]






