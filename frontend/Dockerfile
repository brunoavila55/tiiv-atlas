FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /usr/local/bin/atlas-nginx-entrypoint
RUN chmod +x /usr/local/bin/atlas-nginx-entrypoint
COPY --from=build /app/dist /usr/share/nginx/html
ENTRYPOINT ["/usr/local/bin/atlas-nginx-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 80
