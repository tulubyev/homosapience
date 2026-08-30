FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG NEXT_PUBLIC_API_URL=http://api:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

RUN addgroup -g 1001 -S app && adduser -S -u 1001 -G app app && chown -R app:app /app
USER app

CMD ["npm", "start"]
