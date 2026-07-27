#!/bin/sh

set -eu

body="$(
  wget -q -T 1 -O - \
    http://127.0.0.1:8080/_plugin/health
)"

[ "$body" = '{"status":"alive"}' ]
