FROM golang:1.25-bookworm AS build

WORKDIR /src
COPY services/iscp-controller/go.mod services/iscp-controller/go.sum* ./
RUN go mod download
COPY services/iscp-controller/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/iscp-controller ./cmd/controller
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/iscp-relay github.com/Infinimesh-ai/ISCP/services/relay-reference/cmd/relayd

FROM gcr.io/distroless/static-debian12:nonroot AS controller
COPY --from=build /out/iscp-controller /usr/local/bin/iscp-controller
ENTRYPOINT ["/usr/local/bin/iscp-controller"]

FROM gcr.io/distroless/static-debian12:nonroot AS relay
COPY --from=build /out/iscp-relay /usr/local/bin/iscp-relay
ENTRYPOINT ["/usr/local/bin/iscp-relay"]
