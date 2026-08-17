#!/bin/sh
set -eu

if [ -z "${DNS_RESOLVER:-}" ]; then
  DNS_RESOLVER="$(awk '/^nameserver[[:space:]]/{print $2; exit}' /etc/resolv.conf)"
  export DNS_RESOLVER
fi

exec /docker-entrypoint.sh "$@"
