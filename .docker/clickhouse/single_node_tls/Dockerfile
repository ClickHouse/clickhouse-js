FROM clickhouse/clickhouse-server:22.9.2-alpine
COPY .docker/clickhouse/single_node_tls/certificates /etc/clickhouse-server/certs
RUN chown clickhouse:clickhouse -R /etc/clickhouse-server/certs \
    && chmod 600 /etc/clickhouse-server/certs/* \
    && chmod 755 /etc/clickhouse-server/certs
