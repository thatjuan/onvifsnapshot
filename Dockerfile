FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create public directory
RUN mkdir -p public

# Expose port
EXPOSE 3000

# Run the application
CMD ["node", "server.js"]