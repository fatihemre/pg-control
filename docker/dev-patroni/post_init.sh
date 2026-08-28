#!/bin/sh
# Runs once after Patroni bootstraps the cluster: load the shared sample data.
set -e
psql -v ON_ERROR_STOP=1 -d "$1" -f /seed/01-seed.sql >/dev/null
