#!/bin/sh
# Dev-only replication setup: a REPLICATION role, a physical slot for the pg16 standby
# (docker-compose.dev.yml: pg16-replica) and a logical publication in "reservations".
set -e
echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
psql -v ON_ERROR_STOP=1 -U postgres <<'SQL'
CREATE ROLE replicator LOGIN REPLICATION PASSWORD 'replicator';
GRANT CONNECT ON DATABASE reservations TO replicator;
SELECT pg_create_physical_replication_slot('dev_standby');
\connect reservations
CREATE PUBLICATION dev_pub FOR TABLE sch_reservation.reservations, sch_reservation.rooms;
SQL
