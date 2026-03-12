FROM golang:1.24-alpine AS build

WORKDIR /src
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}

COPY go.mod go.sum ./
RUN go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/openclaw-server .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates

ENV HOST=0.0.0.0
ENV PORT=8787

COPY --from=build /out/openclaw-server /usr/local/bin/openclaw-server

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1

CMD ["openclaw-server"]
