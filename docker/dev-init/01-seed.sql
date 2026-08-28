-- Sample data for developing and testing PgControl (reservation example).
-- Loaded into the "reservations" database on first start of each dev instance.
\connect postgres
CREATE DATABASE reservations;
\connect reservations

CREATE ROLE reservation_owner NOLOGIN;
CREATE ROLE reservation_read NOLOGIN;
CREATE ROLE reservation_write NOLOGIN;
CREATE ROLE reservation_api LOGIN PASSWORD 'api';
CREATE ROLE reservation_admin LOGIN PASSWORD 'admin';
CREATE ROLE reporting LOGIN PASSWORD 'reporting' NOINHERIT;
CREATE ROLE locked_out LOGIN PASSWORD 'locked' VALID UNTIL '2000-01-01';

GRANT reservation_read TO reservation_api;
GRANT reservation_read TO reservation_write;
GRANT reservation_write TO reservation_admin;
GRANT reservation_owner TO reservation_admin;
GRANT reservation_read TO reporting;   -- NOINHERIT: must SET ROLE to use it

CREATE SCHEMA sch_reservation AUTHORIZATION reservation_owner;
CREATE SCHEMA sch_billing AUTHORIZATION reservation_owner;

SET ROLE reservation_owner;
CREATE TABLE sch_reservation.reservations (
    id bigserial PRIMARY KEY,
    guest_name text NOT NULL,
    email text NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL
);
CREATE TABLE sch_reservation.rooms (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE sch_billing.invoices (
    id bigserial PRIMARY KEY,
    reservation_id bigint REFERENCES sch_reservation.reservations,
    amount numeric(10,2) NOT NULL
);
CREATE VIEW sch_reservation.upcoming AS
    SELECT id, guest_name, starts_at FROM sch_reservation.reservations WHERE starts_at > now();
CREATE FUNCTION sch_reservation.room_count() RETURNS int LANGUAGE sql AS $$ SELECT count(*)::int FROM sch_reservation.rooms $$;
RESET ROLE;

REVOKE ALL ON DATABASE reservations FROM PUBLIC;
GRANT CONNECT ON DATABASE reservations TO reservation_read;

GRANT USAGE ON SCHEMA sch_reservation TO reservation_read;
GRANT SELECT ON ALL TABLES IN SCHEMA sch_reservation TO reservation_read;
GRANT SELECT (id, amount) ON sch_billing.invoices TO reservation_read;   -- column-level only, no USAGE on schema

GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sch_reservation TO reservation_write;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA sch_reservation TO reservation_write;
GRANT USAGE ON SCHEMA sch_billing TO reservation_write;

ALTER DEFAULT PRIVILEGES FOR ROLE reservation_owner IN SCHEMA sch_reservation
    GRANT SELECT ON TABLES TO reservation_read;

ALTER TABLE sch_reservation.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON sch_reservation.reservations FOR SELECT TO reservation_api
    USING (email = current_setting('app.email', true));

ALTER ROLE reservation_api SET search_path = sch_reservation, public;
ALTER ROLE reservation_api CONNECTION LIMIT 20;
