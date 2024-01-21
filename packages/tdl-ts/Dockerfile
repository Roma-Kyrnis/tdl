FROM node:20-alpine AS node

COPY --from=wcsiu/tdlib:1.8-alpine /usr/local/include/td /usr/local/include/td
COPY --from=wcsiu/tdlib:1.8-alpine /usr/local/lib/libtd* /usr/local/lib/
COPY --from=wcsiu/tdlib:1.8-alpine /usr/lib/libssl.so /usr/local/lib/libssl.so.50
COPY --from=wcsiu/tdlib:1.8-alpine /usr/lib/libcrypto.so /usr/local/lib/libcrypto.so.47
COPY --from=wcsiu/tdlib:1.8-alpine /usr/lib/libcrypto* /usr/local/lib/
COPY --from=wcsiu/tdlib:1.8-alpine /lib/libz.a /usr/local/lib/libz.a
RUN apk add build-base && apk cache clean

ENV PYTHONUNBUFFERED=1
RUN apk add --update --no-cache python3 py3-pip && ln -sf python3 /usr/bin/python && apk cache clean

WORKDIR /tdlib

COPY package* .
COPY .swcrc .
COPY tsup.config.ts .
COPY tsconfig.json .

COPY prebuilds/ prebuilds/
COPY addon/ addon/
COPY binding.gyp binding.gyp

COPY src/ ./src/

RUN npm ci
RUN npm run build:prod

RUN ls -a -l /usr/local/lib/
RUN ls -a -l /tdlib/src/tdl/module/prebuilds/linux-x64

EXPOSE $PORT
ENTRYPOINT [ "npm", "run", "docker:entrypoint" ]
