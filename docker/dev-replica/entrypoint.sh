#!/bin/sh
# Streaming standby of the pg16 dev instance: clone with pg_basebackup on first start.
set -e
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  until pg_isready -h "$PRIMARY_HOST" -U postgres >/dev/null 2>&1; do sleep 1; done
  mkdir -p "$PGDATA" && chmod 700 "$PGDATA"
  PGPASSWORD=replicator pg_basebackup -d "host=$PRIMARY_HOST user=replicator application_name=pg16_replica" -D "$PGDATA" \
    -Fp -Xs -R -S dev_standby --checkpoint=fast
fi
exec docker-entrypoint.sh postgres -c shared_preload_libraries=pg_stat_statements -c wal_level=logical
