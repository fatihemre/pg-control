# Development-only Patroni node: PostgreSQL 16 + Patroni (etcd v3 DCS).
FROM postgres:16
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/patroni \
 && /opt/patroni/bin/pip install --no-cache-dir 'patroni[etcd3]>=4.0,<5' 'psycopg[binary]>=3.1' \
 && mkdir -p /data && chown postgres:postgres /data
COPY patroni.yml /etc/patroni.yml
COPY post_init.sh /usr/local/bin/post_init.sh
COPY --from=seed 01-seed.sql /seed/01-seed.sql
USER postgres
ENTRYPOINT []
CMD ["/opt/patroni/bin/patroni", "/etc/patroni.yml"]
