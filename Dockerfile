FROM node:20-slim

# Install Python 3 for PDF generation
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
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

# Build Next.js
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
