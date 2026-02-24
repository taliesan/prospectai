FROM node:20-slim

# Install Python 3 for PDF generation + OpenSSL for Prisma
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip3 install --break-system-packages -r requirements.txt

# Install Node dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and fonts
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
RUN npm run build

EXPOSE 3000

# Run migrations (skip if DATABASE_URL not set) then start
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then npx prisma migrate deploy || echo '[WARN] Migration failed — tables may not exist yet'; fi && npm start"]
