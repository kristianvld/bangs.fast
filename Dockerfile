FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/conf.d/security-headers.conf
COPY dist /usr/share/nginx/html
RUN sed -i 's/^user\s\+nginx;/# user nginx;/' /etc/nginx/nginx.conf \
  && sed -i 's|^pid\s\+.*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx

EXPOSE 8080
USER nginx
CMD ["nginx", "-g", "daemon off;"]
