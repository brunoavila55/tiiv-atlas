FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /atlas ./cmd/api
FROM alpine:3.22
RUN adduser -D -u 10001 atlas
COPY --from=build /atlas /usr/local/bin/atlas
USER atlas
EXPOSE 8080
ENTRYPOINT ["atlas"]

