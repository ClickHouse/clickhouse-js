/**
 * @see {@link https://github.com/ClickHouse/ClickHouse/blob/46ed4f6cdf68fbbdc59fbe0f0bfa9a361cc0dec1/src/Core/Settings.h}
 * @see {@link https://github.com/ClickHouse/ClickHouse/blob/5f84f06d6d26672da3d97d0b236ebb46b5080989/src/Core/Defines.h}
 * @see {@link https://github.com/ClickHouse/ClickHouse/blob/eae2667a1c29565c801be0ffd465f8bfcffe77ef/src/Storages/MergeTree/MergeTreeSettings.h}
 */

/////   regex / replace for common and format settings entries
/////   M\((?<type>.+?), {0,1}(?<name>.+?), {0,1}(?<default_value>.+?), {0,1}"{0,1}(?<description>.+?)"{0,1}?,.*
/////   /** $4 (default: $3) */\n$2: $1,\n
interface ClickHouseServerSettings {
  /** The actual size of the block to compress (default: 65536) */
  min_compress_block_size?: UInt64
  /** The maximum size of blocks of uncompressed data before compressing for writing to a table. (default: 1048576) */
  max_compress_block_size?: UInt64
  /** Maximum block size for reading (default: 65505) */
  max_block_size?: UInt64
  /** The maximum block size for insertion (default: 1048545) */
  max_insert_block_size?: UInt64
  /** Squash blocks passed to INSERT query to specified size in rows (default: 1048545) */
  min_insert_block_size_rows?: UInt64
  /** Squash blocks passed to INSERT query to specified size in bytes (default: (1048545 * 256)) */
  min_insert_block_size_bytes?: UInt64
  /** Like min_insert_block_size_rows (default: 0) */
  min_insert_block_size_rows_for_materialized_views?: UInt64
  /** Like min_insert_block_size_bytes (default: 0) */
  min_insert_block_size_bytes_for_materialized_views?: UInt64
  /** Maximum block size for JOIN result (if join algorithm supports it). 0 means unlimited. (default: 65505) */
  max_joined_block_size_rows?: UInt64
  /** The maximum number of threads to execute the INSERT SELECT query. Values 0 or 1 means that INSERT SELECT is not run in parallel. Higher values will lead to higher memory usage. Parallel INSERT SELECT has effect only if the SELECT part is run on parallel (default: 0) */
  max_insert_threads?: UInt64
  /** The maximum number of streams (columns) to delay final part flush. Default - auto (1000 in case of underlying storage supports parallel write (default: 0) */
  max_insert_delayed_streams_for_parallel_write?: UInt64
  /** The maximum number of threads to read from table with FINAL. (default: 16) */
  max_final_threads?: UInt64
  /** The maximum number of threads to execute the request. By default (default: 0) */
  max_threads?: MaxThreads
  /** The maximum number of threads to download data (e.g. for URL engine). (default: 4) */
  max_download_threads?: MaxThreads
  /** The maximal size of buffer for parallel downloading (e.g. for URL engine) per each thread. (default: 10*1024*1024) */
  max_download_buffer_size?: UInt64
  /** The maximum size of the buffer to read from the filesystem. (default: 1048576) */
  max_read_buffer_size?: UInt64
  /** The maximum number of connections for distributed processing of one query (should be greater than max_threads). (default: 1024) */
  max_distributed_connections?: UInt64
  /** Which part of the query can be read into RAM for parsing (the remaining data for INSERT (default: 262144) */
  max_query_size?: UInt64
  /** The interval in microseconds to check if the request is cancelled (default: 100000) */
  interactive_delay?: UInt64
  /** Connection timeout if there are no replicas. (default: 10) */
  connect_timeout?: Seconds
  /** Connection timeout for selecting first healthy replica. (default: 50) */
  connect_timeout_with_failover_ms?: Milliseconds
  /** Connection timeout for selecting first healthy replica (for secure connections). (default: 100) */
  connect_timeout_with_failover_secure_ms?: Milliseconds
  /** (default: 300) */
  receive_timeout?: Seconds
  /** (default: 300) */
  send_timeout?: Seconds
  /** Timeout for draining remote connections (default: 3) */
  drain_timeout?: Seconds
  /** The time in seconds the connection needs to remain idle before TCP starts sending keepalive probes (default: 290 (less than 300)) */
  tcp_keep_alive_timeout?: Seconds
  /** Connection timeout for establishing connection with replica for Hedged requests (default: 100) */
  hedged_connection_timeout_ms?: Milliseconds
  /** Connection timeout for receiving first packet of data or packet with positive progress from replica (default: 2000) */
  receive_data_timeout_ms?: Milliseconds
  /** Use hedged requests for distributed queries (default: true) */
  use_hedged_requests?: Bool
  /** Allow HedgedConnections to change replica until receiving first data packet (default: false) */
  allow_changing_replica_until_first_data_packet?: Bool
  /** The wait time in the request queue (default: 0) */
  queue_max_wait_ms?: Milliseconds
  /** The wait time when the connection pool is full. (default: 0) */
  connection_pool_max_wait_ms?: Milliseconds
  /** The wait time for running query with the same query_id to finish when setting 'replace_running_query' is active. (default: 5000) */
  replace_running_query_max_wait_ms?: Milliseconds
  /** The wait time for reading from Kafka before retry. (default: 5000) */
  kafka_max_wait_ms?: Milliseconds
  /** The wait time for reading from RabbitMQ before retry. (default: 5000) */
  rabbitmq_max_wait_ms?: Milliseconds
  /** Block at the query wait loop on the server for the specified number of seconds. (default: 10) */
  poll_interval?: UInt64
  /** Close idle TCP connections after specified number of seconds. (default: 3600) */
  idle_connection_timeout?: UInt64
  /** Maximum number of connections with one remote server in the pool. (default: 1024) */
  distributed_connections_pool_size?: UInt64
  /** The maximum number of attempts to connect to replicas. (default: 3) */
  connections_with_failover_max_tries?: UInt64
  /** The minimum size of part to upload during multipart upload to S3. (default: 16*1024*1024) */
  s3_min_upload_part_size?: UInt64
  /** Multiply s3_min_upload_part_size by this factor each time s3_multiply_parts_count_threshold parts were uploaded from a single write to S3. (default: 2) */
  s3_upload_part_size_multiply_factor?: UInt64
  /** Each time this number of parts was uploaded to S3 s3_min_upload_part_size multiplied by s3_upload_part_size_multiply_factor. (default: 1000) */
  s3_upload_part_size_multiply_parts_count_threshold?: UInt64
  /** The maximum size of object to upload using singlepart upload to S3. (default: 32*1024*1024) */
  s3_max_single_part_upload_size?: UInt64
  /** The maximum number of retries during single S3 read. (default: 4) */
  s3_max_single_read_retries?: UInt64
  /** Max number of S3 redirects hops allowed. (default: 10) */
  s3_max_redirects?: UInt64
  /** The maximum number of connections per server. (default: 1024) */
  s3_max_connections?: UInt64
  /** Enables or disables truncate before insert in s3 engine tables. (default: false) */
  s3_truncate_on_insert?: Bool
  /** Enables or disables creating a new file on each insert in s3 engine tables (default: false) */
  s3_create_new_file_on_insert?: Bool
  /** Enable very explicit logging of S3 requests. Makes sense for debug only. (default: false) */
  enable_s3_requests_logging?: Bool
  /** The actual number of replications can be specified when the hdfs file is created. (default: 0) */
  hdfs_replication?: UInt64
  /** Enables or disables truncate before insert in s3 engine tables (default: false) */
  hdfs_truncate_on_insert?: Bool
  /** Enables or disables creating a new file on each insert in hdfs engine tables (default: false) */
  hdfs_create_new_file_on_insert?: Bool
  /** Expired time for hsts. 0 means disable HSTS. (default: 0) */
  hsts_max_age?: UInt64
  /** Calculate minimums and maximums of the result columns. They can be output in JSON-formats. (default: false) */
  extremes?: Bool
  /** Whether to use the cache of uncompressed blocks. (default: false) */
  use_uncompressed_cache?: Bool
  /** Whether the running request should be canceled with the same id as the new one. (default: false) */
  replace_running_query?: Bool
  /** The maximum speed of data exchange over the network in bytes per second for replicated fetches. Zero means unlimited. Only has meaning at server startup. (default: 0) */
  max_replicated_fetches_network_bandwidth_for_server?: UInt64
  /** The maximum speed of data exchange over the network in bytes per second for replicated sends. Zero means unlimited. Only has meaning at server startup. (default: 0) */
  max_replicated_sends_network_bandwidth_for_server?: UInt64
  /** The maximum speed of data exchange over the network in bytes per second for read. Zero means unlimited. Only has meaning at server startup. (default: 0) */
  max_remote_read_network_bandwidth_for_server?: UInt64
  /** The maximum speed of data exchange over the network in bytes per second for write. Zero means unlimited. Only has meaning at server startup. (default: 0) */
  max_remote_write_network_bandwidth_for_server?: UInt64
  /** Allow direct SELECT query for Kafka (default: false) */
  stream_like_engine_allow_direct_select?: Bool
  /** When stream like engine reads from multiple queues (default: "") */
  stream_like_engine_insert_queue?: string
  /** Sleep time for StorageDistributed DirectoryMonitors (default: 100) */
  distributed_directory_monitor_sleep_time_ms?: Milliseconds
  /** Maximum sleep time for StorageDistributed DirectoryMonitors (default: 30000) */
  distributed_directory_monitor_max_sleep_time_ms?: Milliseconds
  /** Should StorageDistributed DirectoryMonitors try to batch individual inserts into bigger ones. (default: false) */
  distributed_directory_monitor_batch_inserts?: Bool
  /** Should StorageDistributed DirectoryMonitors try to split batch into smaller in case of failures. (default: false) */
  distributed_directory_monitor_split_batch_on_failure?: Bool
  /** Allows disabling WHERE to PREWHERE optimization in SELECT queries from MergeTree. (default: true) */
  optimize_move_to_prewhere?: Bool
  /** If query has `FINAL` (default: false) */
  optimize_move_to_prewhere_if_final?: Bool
  /** Wait for actions to manipulate the partitions. 0 - do not wait (default: 1) */
  replication_alter_partitions_sync?: UInt64
  /** Wait for inactive replica to execute ALTER/OPTIMIZE. Time in seconds (default: 120) */
  replication_wait_for_inactive_replica_timeout?: Int64
  /** Which replicas (among healthy replicas) to preferably send a query to (on the first attempt) for distributed processing. (default: 'random') */
  load_balancing?: LoadBalancing
  /** Which replica to preferably send a query when FIRST_OR_RANDOM load balancing strategy is used. (default: 0) */
  load_balancing_first_offset?: UInt64
  /** How to calculate TOTALS when HAVING is present (default: 'after_having_exclusive') */
  totals_mode?: TotalsMode
  /** The threshold for totals_mode = 'auto'. (default: 0.5) */
  totals_auto_threshold?: Float
  /** In CREATE TABLE statement allows specifying LowCardinality modifier for types of small fixed size (8 or less). Enabling this may increase merge times and memory consumption. (default: false) */
  allow_suspicious_low_cardinality_types?: Bool
  /** Compile some scalar functions and operators to native code. (default: true) */
  compile_expressions?: Bool
  /** The number of identical expressions before they are JIT-compiled (default: 3) */
  min_count_to_compile_expression?: UInt64
  /** Compile aggregate functions to native code. (default: true) */
  compile_aggregate_expressions?: Bool
  /** The number of identical aggregate expressions before they are JIT-compiled (default: 3) */
  min_count_to_compile_aggregate_expression?: UInt64
  /** Compile sort description to native code. (default: true) */
  compile_sort_description?: Bool
  /** The number of identical sort descriptions before they are JIT-compiled (default: 3) */
  min_count_to_compile_sort_description?: UInt64
  /** From what number of keys (default: 100000) */
  group_by_two_level_threshold?: UInt64
  /** From what size of the aggregation state in bytes (default: 50000000) */
  group_by_two_level_threshold_bytes?: UInt64
  /** Is the memory-saving mode of distributed aggregation enabled. (default: true) */
  distributed_aggregation_memory_efficient?: Bool
  /** Number of threads to use for merge intermediate aggregation results in memory efficient mode. When bigger (default: 0) */
  aggregation_memory_efficient_merge_threads?: UInt64
  /** Enable positional arguments in ORDER BY (default: true) */
  enable_positional_arguments?: Bool
  /** Treat columns mentioned in ROLLUP (default: false) */
  group_by_use_nulls?: Bool
  /** The maximum number of replicas of each shard used when the query is executed. For consistency (to get different parts of the same partition) (default: 1) */
  max_parallel_replicas?: UInt64
  /** " (default: 0) */
  parallel_replicas_count?: UInt64
  /** " (default: 0) */
  parallel_replica_offset?: UInt64
  /** If true (default: false) */
  allow_experimental_parallel_reading_from_replicas?: Bool
  /** If true (default: false) */
  skip_unavailable_shards?: Bool
  /** Process distributed INSERT SELECT query in the same cluster on local tables on every shard; if set to 1 - SELECT is executed on each shard; if set to 2 - SELECT and INSERT are executed on each shard (default: 0) */
  parallel_distributed_insert_select?: UInt64
  /** If 1 (default: 0) */
  distributed_group_by_no_merge?: UInt64
  /** If 1 (default: 1) */
  distributed_push_down_limit?: UInt64
  /** Optimize GROUP BY sharding_key queries (by avoiding costly aggregation on the initiator server). (default: true) */
  optimize_distributed_group_by_sharding_key?: Bool
  /** Limit for number of sharding key values (default: 1000) */
  optimize_skip_unused_shards_limit?: UInt64
  /** Assumes that data is distributed by sharding_key. Optimization to skip unused shards if SELECT query filters by sharding_key. (default: false) */
  optimize_skip_unused_shards?: Bool
  /** Rewrite IN in query for remote shards to exclude values that does not belong to the shard (requires optimize_skip_unused_shards) (default: true) */
  optimize_skip_unused_shards_rewrite_in?: Bool
  /** Allow non-deterministic functions (includes dictGet) in sharding_key for optimize_skip_unused_shards (default: false) */
  allow_nondeterministic_optimize_skip_unused_shards?: Bool
  /** Throw an exception if unused shards cannot be skipped (1 - throw only if the table has the sharding key (default: 0) */
  force_optimize_skip_unused_shards?: UInt64
  /** Same as optimize_skip_unused_shards (default: 0) */
  optimize_skip_unused_shards_nesting?: UInt64
  /** Same as force_optimize_skip_unused_shards (default: 0) */
  force_optimize_skip_unused_shards_nesting?: UInt64
  /** Enable parallel parsing for some data formats. (default: true) */
  input_format_parallel_parsing?: Bool
  /** The minimum chunk size in bytes (default: (10 * 1024 * 1024)) */
  min_chunk_bytes_for_parallel_parsing?: UInt64
  /** Enable parallel formatting for some data formats. (default: true) */
  output_format_parallel_formatting?: Bool
  /** If at least as many lines are read from one file (default: (20 * 8192)) */
  merge_tree_min_rows_for_concurrent_read?: UInt64
  /** If at least as many bytes are read from one file (default: (24 * 10 * 1024 * 1024)) */
  merge_tree_min_bytes_for_concurrent_read?: UInt64
  /** You can skip reading more than that number of rows at the price of one seek per file. (default: 0) */
  merge_tree_min_rows_for_seek?: UInt64
  /** You can skip reading more than that number of bytes at the price of one seek per file. (default: 0) */
  merge_tree_min_bytes_for_seek?: UInt64
  /** If the index segment can contain the required keys (default: 8) */
  merge_tree_coarse_index_granularity?: UInt64
  /** The maximum number of rows per request (default: (128 * 8192)) */
  merge_tree_max_rows_to_use_cache?: UInt64
  /** The maximum number of bytes per request (default: (192 * 10 * 1024 * 1024)) */
  merge_tree_max_bytes_to_use_cache?: UInt64
  /** Merge parts only in one partition in select final (default: false) */
  do_not_merge_across_partitions_select_final?: Bool
  /** The maximum number of rows in MySQL batch insertion of the MySQL storage engine (default: 65536) */
  mysql_max_rows_to_insert?: UInt64
  /** The minimum length of the expression `expr = x1 OR ... expr = xN` for optimization  (default: 3) */
  optimize_min_equality_disjunction_chain_length?: UInt64
  /** The minimum number of bytes for reading the data with O_DIRECT option during SELECT queries execution. 0 - disabled. (default: 0) */
  min_bytes_to_use_direct_io?: UInt64
  /** The minimum number of bytes for reading the data with mmap option during SELECT queries execution. 0 - disabled. (default: 0) */
  min_bytes_to_use_mmap_io?: UInt64
  /** Validate checksums on reading. It is enabled by default and should be always enabled in production. Please do not expect any benefits in disabling this setting. It may only be used for experiments and benchmarks. The setting only applicable for tables of MergeTree family. Checksums are always validated for other table engines and when receiving data over network. (default: true) */
  checksum_on_read?: Bool
  /** Throw an exception if there is a partition key in a table (default: false) */
  force_index_by_date?: Bool
  /** Throw an exception if there is primary key in a table (default: false) */
  force_primary_key?: Bool
  /** Use data skipping indexes during query execution. (default: true) */
  use_skip_indexes?: Bool
  /** If query has FINAL (default: false) */
  use_skip_indexes_if_final?: Bool
  /** Comma separated list of strings or literals with the name of the data skipping indices that should be used during query execution (default: "") */
  force_data_skipping_indices?: string
  /** Allows you to use more sources than the number of threads - to more evenly distribute work across threads. It is assumed that this is a temporary solution (default: 1) */
  max_streams_to_max_threads_ratio?: Float
  /** Ask more streams when reading from Merge table. Streams will be spread across tables that Merge table will use. This allows more even distribution of work across threads and especially helpful when merged tables differ in size. (default: 5) */
  max_streams_multiplier_for_merge_tables?: Float
  /** Allows you to select the method of data compression when writing. (default: "LZ4") */
  network_compression_method?: string
  /** Allows you to select the level of ZSTD compression. (default: 1) */
  network_zstd_compression_level?: Int64
  /** Allows you to select the max window log of ZSTD (it will not be used for MergeTree family) (default: 0) */
  zstd_window_log_max?: Int64
  /** Priority of the query. 1 - the highest (default: 0) */
  priority?: UInt64
  /** If non zero - set corresponding 'nice' value for query processing threads. Can be used to adjust query priority for OS scheduler. (default: 0) */
  os_thread_priority?: Int64
  /** Log requests and write the log to the system table. (default: true) */
  log_queries?: Bool
  /** Log formatted queries and write the log to the system table. (default: false) */
  log_formatted_queries?: Bool
  /** Minimal type in query_log to log (default: 'QUERY_START') */
  log_queries_min_type?: LogQueriesType
  /** Minimal time for the query to run (default: 0) */
  log_queries_min_query_duration_ms?: Milliseconds
  /** If query length is greater than specified threshold (in bytes) (default: 100000) */
  log_queries_cut_to_length?: UInt64
  /** Log queries with the specified probabality. (default: 1.) */
  log_queries_probability?: Float
  /** Log Processors profile events. (default: false) */
  log_processors_profiles?: Bool
  /** How are distributed subqueries performed inside IN or JOIN sections? (default: 'deny') */
  distributed_product_mode?: DistributedProductMode
  /** The maximum number of concurrent requests for all users. (default: 0) */
  max_concurrent_queries_for_all_users?: UInt64
  /** The maximum number of concurrent requests per user. (default: 0) */
  max_concurrent_queries_for_user?: UInt64
  /** For INSERT queries in the replicated table (default: true) */
  insert_deduplicate?: Bool
  /** For INSERT queries in the replicated table (default: 0) */
  insert_quorum?: UInt64Auto
  /** " (default: 600000) */
  insert_quorum_timeout?: Milliseconds
  /** For quorum INSERT queries - enable to make parallel inserts without linearizability (default: true) */
  insert_quorum_parallel?: Bool
  /** For SELECT queries from the replicated table (default: 0) */
  select_sequential_consistency?: UInt64
  /** The maximum number of different shards and the maximum number of replicas of one shard in the `remote` function. (default: 1000) */
  table_function_remote_max_addresses?: UInt64
  /** Setting to reduce the number of threads in case of slow reads. Pay attention only to reads that took at least that much time. (default: 1000) */
  read_backoff_min_latency_ms?: Milliseconds
  /** Settings to reduce the number of threads in case of slow reads. Count events when the read bandwidth is less than that many bytes per second. (default: 1048576) */
  read_backoff_max_throughput?: UInt64
  /** Settings to reduce the number of threads in case of slow reads. Do not pay attention to the event (default: 1000) */
  read_backoff_min_interval_between_events_ms?: Milliseconds
  /** Settings to reduce the number of threads in case of slow reads. The number of events after which the number of threads will be reduced. (default: 2) */
  read_backoff_min_events?: UInt64
  /** Settings to try keeping the minimal number of threads in case of slow reads. (default: 1) */
  read_backoff_min_concurrency?: UInt64
  /** For testing of `exception safety` - throw an exception every time you allocate memory with the specified probability. (default: 0.) */
  memory_tracker_fault_probability?: Float
  /** Compress the result if the client over HTTP said that it understands data compressed by gzip or deflate. (default: false) */
  enable_http_compression?: Bool
  /** Compression level - used if the client on HTTP said that it understands data compressed by gzip or deflate. (default: 3) */
  http_zlib_compression_level?: Int64
  /** If you uncompress the POST data from the client compressed by the native format (default: false) */
  http_native_compression_disable_checksumming_on_decompress?: Bool
  /** What aggregate function to use for implementation of count(DISTINCT ...) (default: "uniqExact") */
  count_distinct_implementation?: string
  /** Write add http CORS header. (default: false) */
  add_http_cors_header?: Bool
  /** Max number of http GET redirects hops allowed. Make sure additional security measures are in place to prevent a malicious server to redirect your requests to unexpected services. (default: 0) */
  max_http_get_redirects?: UInt64
  /** Use client timezone for interpreting DateTime string values (default: false) */
  use_client_time_zone?: Bool
  /** Send progress notifications using X-ClickHouse-Progress headers. Some clients do not support high amount of HTTP headers (Python requests in particular) (default: false) */
  send_progress_in_http_headers?: Bool
  /** Do not send HTTP headers X-ClickHouse-Progress more frequently than at each specified interval. (default: 100) */
  http_headers_progress_interval_ms?: UInt64
  /** Do fsync after changing metadata for tables and databases (.sql files). Could be disabled in case of poor latency on server with high load of DDL queries and high load of disk subsystem. (default: true) */
  fsync_metadata?: Bool
  /** Use NULLs for non-joined rows of outer JOINs for types that can be inside Nullable. If false (default: false) */
  join_use_nulls?: Bool
  /** Set default strictness in JOIN query (default: 'ALL') */
  join_default_strictness?: JoinStrictness
  /** Enable old ANY JOIN logic with many-to-one left-to-right table keys mapping for all ANY JOINs. It leads to confusing not equal results for 't1 ANY LEFT JOIN t2' and 't2 ANY RIGHT JOIN t1'. ANY RIGHT JOIN needs one-to-many keys mapping to be consistent with LEFT one. (default: false) */
  any_join_distinct_right_table_keys?: Bool
  /** " (default: 1000000) */
  preferred_block_size_bytes?: UInt64
  /** If set (default: 300) */
  max_replica_delay_for_distributed_queries?: UInt64
  /** Suppose max_replica_delay_for_distributed_queries is set and all replicas for the queried table are stale. If this setting is enabled (default: true) */
  fallback_to_stale_replicas_for_distributed_queries?: Bool
  /** Limit on max column size in block while reading. Helps to decrease cache misses count. Should be close to L2 cache size. (default: 0) */
  preferred_max_column_in_block_size_bytes?: UInt64
  /** If the destination table contains at least that many active parts in a single partition (default: 150) */
  parts_to_delay_insert?: UInt64
  /** If more than this number active parts in a single partition of the destination table (default: 300) */
  parts_to_throw_insert?: UInt64
  /** If setting is enabled (default: false) */
  insert_distributed_sync?: Bool
  /** Timeout for insert query into distributed. Setting is used only with insert_distributed_sync enabled. Zero value means no timeout. (default: 0) */
  insert_distributed_timeout?: UInt64
  /** Timeout for DDL query responses from all hosts in cluster. If a ddl request has not been performed on all hosts (default: 180) */
  distributed_ddl_task_timeout?: Int64
  /** Timeout for flushing data from streaming storages. (default: 7500) */
  stream_flush_interval_ms?: Milliseconds
  /** Timeout for polling data from/to streaming storages. (default: 500) */
  stream_poll_timeout_ms?: Milliseconds
  /** Time to sleep in sending tables status response in TCPHandler (default: 0) */
  sleep_in_send_tables_status_ms?: Milliseconds
  /** Time to sleep in sending data in TCPHandler (default: 0) */
  sleep_in_send_data_ms?: Milliseconds
  /** Time to sleep after receiving query in TCPHandler (default: 0) */
  sleep_after_receiving_query_ms?: Milliseconds
  /** Send unknown packet instead of data Nth data packet (default: 0) */
  unknown_packet_in_send_data?: UInt64
  /** Time to sleep in receiving cancel in TCPHandler (default: 0) */
  sleep_in_receive_cancel_ms?: Milliseconds
  /** If setting is enabled (default: false) */
  insert_allow_materialized_columns?: Bool
  /** HTTP connection timeout. (default: 1) */
  http_connection_timeout?: Seconds
  /** HTTP send timeout (default: 180) */
  http_send_timeout?: Seconds
  /** HTTP receive timeout (default: 180) */
  http_receive_timeout?: Seconds
  /** Maximum URI length of HTTP request (default: 1048576) */
  http_max_uri_size?: UInt64
  /** Maximum number of fields in HTTP header (default: 1000000) */
  http_max_fields?: UInt64
  /** Maximum length of field name in HTTP header (default: 1048576) */
  http_max_field_name_size?: UInt64
  /** Maximum length of field value in HTTP header (default: 1048576) */
  http_max_field_value_size?: UInt64
  /** Skip url's for globs with HTTP_NOT_FOUND error (default: true) */
  http_skip_not_found_url_for_globs?: Bool
  /** If setting is enabled and OPTIMIZE query didn't actually assign a merge then an explanatory exception is thrown (default: false) */
  optimize_throw_if_noop?: Bool
  /** Try using an index if there is a subquery or a table expression on the right side of the IN operator. (default: true) */
  use_index_for_in_with_subqueries?: Bool
  /** Force joined subqueries and table functions to have aliases for correct name qualification. (default: true) */
  joined_subquery_requires_alias?: Bool
  /** Return empty result when aggregating without keys on empty set. (default: false) */
  empty_result_for_aggregation_by_empty_set?: Bool
  /** Return empty result when aggregating by constant keys on empty set. (default: true) */
  empty_result_for_aggregation_by_constant_keys_on_empty_set?: Bool
  /** If it is set to true (default: true) */
  allow_distributed_ddl?: Bool
  /** If it is set to true (default: false) */
  allow_suspicious_codecs?: Bool
  /** If it is set to true (default: false) */
  allow_experimental_codecs?: Bool
  /** Period for real clock timer of query profiler (in nanoseconds). Set 0 value to turn off the real clock query profiler. Recommended value is at least 10000000 (100 times a second) for single queries or 1000000000 (once a second) for cluster-wide profiling. (default: QUERY_PROFILER_DEFAULT_SAMPLE_RATE_NS) */
  query_profiler_real_time_period_ns?: UInt64
  /** Period for CPU clock timer of query profiler (in nanoseconds). Set 0 value to turn off the CPU clock query profiler. Recommended value is at least 10000000 (100 times a second) for single queries or 1000000000 (once a second) for cluster-wide profiling. (default: QUERY_PROFILER_DEFAULT_SAMPLE_RATE_NS) */
  query_profiler_cpu_time_period_ns?: UInt64
  /** If enabled (default: false) */
  metrics_perf_events_enabled?: Bool
  /** Comma separated list of perf metrics that will be measured throughout queries' execution. Empty means all events. See PerfEventInfo in sources for the available events. (default: "") */
  metrics_perf_events_list?: string
  /** Probability to start an OpenTelemetry trace for an incoming query. (default: 0.) */
  opentelemetry_start_trace_probability?: Float
  /** Collect OpenTelemetry spans for processors. (default: false) */
  opentelemetry_trace_processors?: Bool
  /** Prefer using column names instead of aliases if possible. (default: false) */
  prefer_column_name_to_alias?: Bool
  /** If enabled (default: false) */
  prefer_global_in_and_join?: Bool
  /** Limit on read rows from the most 'deep' sources. That is (default: 0) */
  max_rows_to_read?: UInt64
  /** Limit on read bytes (after decompression) from the most 'deep' sources. That is (default: 0) */
  max_bytes_to_read?: UInt64
  /** What to do when the limit is exceeded. (default: 'throw') */
  read_overflow_mode?: OverflowMode
  /** Limit on read rows on the leaf nodes for distributed queries. Limit is applied for local reads only excluding the final merge stage on the root node. (default: 0) */
  max_rows_to_read_leaf?: UInt64
  /** Limit on read bytes (after decompression) on the leaf nodes for distributed queries. Limit is applied for local reads only excluding the final merge stage on the root node. (default: 0) */
  max_bytes_to_read_leaf?: UInt64
  /** What to do when the leaf limit is exceeded. (default: 'throw') */
  read_overflow_mode_leaf?: OverflowMode
  /** " (default: 0) */
  max_rows_to_group_by?: UInt64
  /** What to do when the limit is exceeded. (default: 'throw') */
  group_by_overflow_mode?: OverflowModeGroupBy
  /** " (default: 0) */
  max_bytes_before_external_group_by?: UInt64
  /** " (default: 0) */
  max_rows_to_sort?: UInt64
  /** " (default: 0) */
  max_bytes_to_sort?: UInt64
  /** What to do when the limit is exceeded. (default: 'throw') */
  sort_overflow_mode?: OverflowMode
  /** " (default: 0) */
  max_bytes_before_external_sort?: UInt64
  /** In case of ORDER BY with LIMIT (default: 1000000000) */
  max_bytes_before_remerge_sort?: UInt64
  /** If memory usage after remerge does not reduced by this ratio (default: 2.) */
  remerge_sort_lowered_memory_bytes_ratio?: Float
  /** Limit on result size in rows. Also checked for intermediate data sent from remote servers. (default: 0) */
  max_result_rows?: UInt64
  /** Limit on result size in bytes (uncompressed). Also checked for intermediate data sent from remote servers. (default: 0) */
  max_result_bytes?: UInt64
  /** What to do when the limit is exceeded. (default: 'throw') */
  result_overflow_mode?: OverflowMode
  /** " (default: 0) */
  max_execution_time?: Seconds
  /** What to do when the limit is exceeded. (default: 'throw') */
  timeout_overflow_mode?: OverflowMode
  /** Minimum number of execution rows per second. (default: 0) */
  min_execution_speed?: UInt64
  /** Maximum number of execution rows per second. (default: 0) */
  max_execution_speed?: UInt64
  /** Minimum number of execution bytes per second. (default: 0) */
  min_execution_speed_bytes?: UInt64
  /** Maximum number of execution bytes per second. (default: 0) */
  max_execution_speed_bytes?: UInt64
  /** Check that the speed is not too low after the specified time has elapsed. (default: 10) */
  timeout_before_checking_execution_speed?: Seconds
  /** " (default: 0) */
  max_columns_to_read?: UInt64
  /** " (default: 0) */
  max_temporary_columns?: UInt64
  /** " (default: 0) */
  max_temporary_non_const_columns?: UInt64
  /** " (default: 100) */
  max_subquery_depth?: UInt64
  /** " (default: 1000) */
  max_pipeline_depth?: UInt64
  /** Maximum depth of query syntax tree. Checked after parsing. (default: 1000) */
  max_ast_depth?: UInt64
  /** Maximum size of query syntax tree in number of nodes. Checked after parsing. (default: 50000) */
  max_ast_elements?: UInt64
  /** Maximum size of query syntax tree in number of nodes after expansion of aliases and the asterisk. (default: 500000) */
  max_expanded_ast_elements?: UInt64
  /** 0 - everything is allowed. 1 - only read requests. 2 - only read requests (default: 0) */
  readonly?: UInt64
  /** Maximum size of the set (in number of elements) resulting from the execution of the IN section. (default: 0) */
  max_rows_in_set?: UInt64
  /** Maximum size of the set (in bytes in memory) resulting from the execution of the IN section. (default: 0) */
  max_bytes_in_set?: UInt64
  /** What to do when the limit is exceeded. (default: 'throw') */
  set_overflow_mode?: OverflowMode
  /** Maximum size of the hash table for JOIN (in number of rows). (default: 0) */
  max_rows_in_join?: UInt64
  /** Maximum size of the hash table for JOIN (in number of bytes in memory). (default: 0) */
  max_bytes_in_join?: UInt64
  /** What to do when the limit is exceeded. (default: 'throw') */
  join_overflow_mode?: OverflowMode
  /** When disabled (default) ANY JOIN will take the first found row for a key. When enabled, it will take the last row seen if there are multiple rows for the same key. (default: false) */
  join_any_take_last_row?: Bool
  /** Specify join algorithm */
  join_algorithm?: JoinAlgorithm
  /** Maximum size of right-side table if limit is required but max_bytes_in_join is not set. (default: 1000000000) */
  default_max_bytes_in_join?: UInt64
  /** If not 0 group left table blocks in bigger ones for left-side table in partial merge join. It uses up to 2x of specified memory per joining thread. (default: 0) */
  partial_merge_join_left_table_buffer_bytes?: UInt64
  /** Split right-hand joining data in blocks of specified size. It's a portion of data indexed by min-max values and possibly unloaded on disk. (default: 65536) */
  partial_merge_join_rows_in_right_blocks?: UInt64
  /** For MergeJoin on disk set how much files it's allowed to sort simultaneously. Then this value bigger then more memory used and then less disk I/O needed. Minimum is 2. (default: 64) */
  join_on_disk_max_files_to_merge?: UInt64
  /** Compatibility ignore collation in create table (default: true) */
  compatibility_ignore_collation_in_create_table?: Bool
  /** Set compression codec for temporary files (sort and join on disk). I.e. LZ4 (default: "LZ4") */
  temporary_files_codec?: string
  /** Maximum size (in rows) of the transmitted external table obtained when the GLOBAL IN/JOIN section is executed. (default: 0) */
  max_rows_to_transfer?: UInt64
  /** Maximum size (in uncompressed bytes) of the transmitted external table obtained when the GLOBAL IN/JOIN section is executed. (default: 0) */
  max_bytes_to_transfer?: UInt64
  /** What to do when the limit is exceeded. (default: 'throw') */
  transfer_overflow_mode?: OverflowMode
  /** Maximum number of elements during execution of DISTINCT. (default: 0) */
  max_rows_in_distinct?: UInt64
  /** Maximum total size of state (in uncompressed bytes) in memory for the execution of DISTINCT. (default: 0) */
  max_bytes_in_distinct?: UInt64
  /** What to do when the limit is exceeded. (default: 'throw') */
  distinct_overflow_mode?: OverflowMode
  /** Maximum memory usage for processing of single query. Zero means unlimited. (default: 0) */
  max_memory_usage?: UInt64
  /** It represents soft memory limit on the user level. This value is used to compute query overcommit ratio. (default: 1_GiB) */
  memory_overcommit_ratio_denominator?: UInt64
  /** Maximum memory usage for processing all concurrently running queries for the user. Zero means unlimited. (default: 0) */
  max_memory_usage_for_user?: UInt64
  /** It represents soft memory limit on the global level. This value is used to compute query overcommit ratio. (default: 1_GiB) */
  memory_overcommit_ratio_denominator_for_user?: UInt64
  /** Small allocations and deallocations are grouped in thread local variable and tracked or profiled only when amount (in absolute value) becomes larger than specified value. If the value is higher than 'memory_profiler_step' it will be effectively lowered to 'memory_profiler_step'. (default: (4 * 1024 * 1024)) */
  max_untracked_memory?: UInt64
  /** Whenever query memory usage becomes larger than every next step in number of bytes the memory profiler will collect the allocating stack trace. Zero means disabled memory profiler. Values lower than a few megabytes will slow down query processing. (default: (4 * 1024 * 1024)) */
  memory_profiler_step?: UInt64
  /** Collect random allocations and deallocations and write them into system.trace_log with 'MemorySample' trace_type. The probability is for every alloc/free regardless to the size of the allocation. Note that sampling happens only when the amount of untracked memory exceeds 'max_untracked_memory'. You may want to set 'max_untracked_memory' to 0 for extra fine grained sampling. (default: 0.) */
  memory_profiler_sample_probability?: Float
  /** Maximum time thread will wait for memory to be freed in the case of memory overcommit. If timeout is reached and memory is not freed (default: 5'000'000) */
  memory_usage_overcommit_max_wait_microseconds?: UInt64
  /** The maximum speed of data exchange over the network in bytes per second for a query. Zero means unlimited. (default: 0) */
  max_network_bandwidth?: UInt64
  /** The maximum number of bytes (compressed) to receive or transmit over the network for execution of the query. (default: 0) */
  max_network_bytes?: UInt64
  /** The maximum speed of data exchange over the network in bytes per second for all concurrently running user queries. Zero means unlimited. (default: 0) */
  max_network_bandwidth_for_user?: UInt64
  /** The maximum speed of data exchange over the network in bytes per second for all concurrently running queries. Zero means unlimited. (default: 0) */
  max_network_bandwidth_for_all_users?: UInt64
  /** The maximum number of threads to execute BACKUP requests. (default: 16) */
  backup_threads?: UInt64
  /** The maximum number of threads to execute RESTORE requests. (default: 16) */
  restore_threads?: UInt64
  /** Log query performance statistics into the query_log (default: true) */
  log_profile_events?: Bool
  /** Log query settings into the query_log. (default: true) */
  log_query_settings?: Bool
  /** Log query threads into system.query_thread_log table. This setting have effect only when 'log_queries' is true. (default: false) */
  log_query_threads?: Bool
  /** Log query dependent views into system.query_views_log table. This setting have effect only when 'log_queries' is true. (default: true) */
  log_query_views?: Bool
  /** Log comment into system.query_log table and server log. It can be set to arbitrary string no longer than max_query_size. (default: "") */
  log_comment?: string
  /** Send server text logs with specified minimum level to client (default: 'fatal') */
  send_logs_level?: LogsLevel
  /** Send server text logs with specified regexp to match log source name. Empty means all sources. (default: "") */
  send_logs_source_regexp?: string
  /** If it is set to true (default: true) */
  enable_optimize_predicate_expression?: Bool
  /** Allow push predicate to final subquery. (default: true) */
  enable_optimize_predicate_expression_to_final_subquery?: Bool
  /** Allows push predicate when subquery contains WITH clause (default: true) */
  allow_push_predicate_when_subquery_contains_with?: Bool
  /** Maximum size (in rows) of shared global dictionary for LowCardinality type. (default: 8192) */
  low_cardinality_max_dictionary_size?: UInt64
  /** LowCardinality type serialization setting. If is true (default: false) */
  low_cardinality_use_single_dictionary_for_part?: Bool
  /** Check overflow of decimal arithmetic/comparison operations (default: true) */
  decimal_check_overflow?: Bool
  /** If it's true then queries will be always sent to local replica (if it exists). If it's false then replica to send a query will be chosen between local and remote ones according to load_balancing (default: true) */
  prefer_localhost_replica?: Bool
  /** Amount of retries while fetching partition from another host. (default: 5) */
  max_fetch_partition_retries_count?: UInt64
  /** Limit on size of multipart/form-data content. This setting cannot be parsed from URL parameters and should be set in user profile. Note that content is parsed and external tables are created in memory before start of query execution. And this is the only limit that has effect on that stage (limits on max memory usage and max execution time have no effect while reading HTTP form data). (default: 1024 * 1024 * 1024) */
  http_max_multipart_form_data_size?: UInt64
  /** Calculate text stack trace in case of exceptions during query execution. This is the default. It requires symbol lookups that may slow down fuzzing tests when huge amount of wrong queries are executed. In normal cases you should not disable this option. (default: true) */
  calculate_text_stack_trace?: Bool
  /** If it is set to true (default: true) */
  allow_ddl?: Bool
  /** Enables pushing to attached views concurrently instead of sequentially. (default: false) */
  parallel_view_processing?: Bool
  /** Allow ARRAY JOIN with multiple arrays that have different sizes. When this settings is enabled (default: false) */
  enable_unaligned_array_join?: Bool
  /** Enable ORDER BY optimization for reading data in corresponding order in MergeTree tables. (default: true) */
  optimize_read_in_order?: Bool
  /** Enable ORDER BY optimization in window clause for reading data in corresponding order in MergeTree tables. (default: true) */
  optimize_read_in_window_order?: Bool
  /** Enable GROUP BY optimization for aggregating data in corresponding order in MergeTree tables. (default: false) */
  optimize_aggregation_in_order?: Bool
  /** Maximal size of block in bytes accumulated during aggregation in order of primary key. Lower block size allows to parallelize more final merge stage of aggregation. (default: 50000000) */
  aggregation_in_order_max_block_bytes?: UInt64
  /** Minimal number of parts to read to run preliminary merge step during multithread reading in order of primary key. (default: 100) */
  read_in_order_two_level_merge_threshold?: UInt64
  /** Use LowCardinality type in Native format. Otherwise (default: true) */
  low_cardinality_allow_in_native_format?: Bool
  /** Cancel HTTP readonly queries when a client closes the connection without waiting for response. (default: false) */
  cancel_http_readonly_queries_on_client_close?: Bool
  /** If it is set to true (default: true) */
  external_table_functions_use_nulls?: Bool
  /** If it is set to true (default: false) */
  external_table_strict_query?: Bool
  /** Allow functions that use Hyperscan library. Disable to avoid potentially long compilation times and excessive resource usage. (default: true) */
  allow_hyperscan?: Bool
  /** Max length of regexp than can be used in hyperscan multi-match functions. Zero means unlimited. (default: 0) */
  max_hyperscan_regexp_length?: UInt64
  /** Max total length of all regexps than can be used in hyperscan multi-match functions (per every function). Zero means unlimited. (default: 0) */
  max_hyperscan_regexp_total_length?: UInt64
  /** Allow using simdjson library in 'JSON*' functions if AVX2 instructions are available. If disabled rapidjson will be used. (default: true) */
  allow_simdjson?: Bool
  /** Allow functions for introspection of ELF and DWARF for query profiling. These functions are slow and may impose security considerations. (default: false) */
  allow_introspection_functions?: Bool
  /** Limit maximum number of partitions in single INSERTed block. Zero means unlimited. Throw exception if the block contains too many partitions. This setting is a safety threshold (default: 100) */
  max_partitions_per_insert_block?: UInt64
  /** Limit the max number of partitions that can be accessed in one query. <= 0 means unlimited. (default: -1) */
  max_partitions_to_read?: Int64
  /** Return check query result as single 1/0 value (default: true) */
  check_query_single_value_result?: Bool
  /** Allow ALTER TABLE ... DROP DETACHED PART[ITION] ... queries (default: false) */
  allow_drop_detached?: Bool
  /** Connection pool size for PostgreSQL table engine and database engine. (default: 16) */
  postgresql_connection_pool_size?: UInt64
  /** Connection pool push/pop timeout on empty pool for PostgreSQL table engine and database engine. By default it will block on empty pool. (default: 5000) */
  postgresql_connection_pool_wait_timeout?: UInt64
  /** Close connection before returning connection to the pool. (default: false) */
  postgresql_connection_pool_auto_close_connection?: Bool
  /** Maximum number of allowed addresses (For external storages (default: 1000) */
  glob_expansion_max_elements?: UInt64
  /** Connection pool size for each connection settings string in ODBC bridge. (default: 16) */
  odbc_bridge_connection_pool_size?: UInt64
  /** Use connection pooling in ODBC bridge. If set to false (default: true) */
  odbc_bridge_use_connection_pooling?: Bool
  /** Time period reduces replica error counter by 2 times. (default: 60) */
  distributed_replica_error_half_life?: Seconds
  /** Max number of errors per replica (default: 1000) */
  distributed_replica_error_cap?: UInt64
  /** Number of errors that will be ignored while choosing replicas (default: 0) */
  distributed_replica_max_ignored_errors?: UInt64
  /** Enable LIVE VIEW. Not mature enough. (default: false) */
  allow_experimental_live_view?: Bool
  /** The heartbeat interval in seconds to indicate live query is alive. (default: 15) */
  live_view_heartbeat_interval?: Seconds
  /** Limit maximum number of inserted blocks after which mergeable blocks are dropped and query is re-executed. (default: 64) */
  max_live_view_insert_blocks_before_refresh?: UInt64
  /** Enable WINDOW VIEW. Not mature enough. (default: false) */
  allow_experimental_window_view?: Bool
  /** The clean interval of window view in seconds to free outdated data. (default: 60) */
  window_view_clean_interval?: Seconds
  /** The heartbeat interval in seconds to indicate watch query is alive. (default: 15) */
  window_view_heartbeat_interval?: Seconds
  /** Timeout for waiting for window view fire signal in event time processing (default: 10) */
  wait_for_window_view_fire_signal_timeout?: Seconds
  /** The minimum disk space to keep while writing temporary data used in external sorting and aggregation. (default: 0) */
  min_free_disk_space_for_temporary_data?: UInt64
  /** Default table engine used when ENGINE is not set in CREATE statement. (default: 'None') */
  default_table_engine?: DefaultTableEngine
  /** For tables in databases with Engine=Atomic show UUID of the table in its CREATE query. (default: false) */
  show_table_uuid_in_table_create_query_if_not_nil?: Bool
  /** When executing DROP or DETACH TABLE in Atomic database (default: false) */
  database_atomic_wait_for_drop_and_detach_synchronously?: Bool
  /** If it is set to true (default: true) */
  enable_scalar_subquery_optimization?: Bool
  /** Process trivial 'SELECT count() FROM table' query from metadata. (default: true) */
  optimize_trivial_count_query?: Bool
  /** If it is set to true (default: true) */
  optimize_respect_aliases?: Bool
  /** Wait for synchronous execution of ALTER TABLE UPDATE/DELETE queries (mutations). 0 - execute asynchronously. 1 - wait current server. 2 - wait all replicas if they exist. (default: 0) */
  mutations_sync?: UInt64
  /** Enable lightweight DELETE mutations for mergetree tables. Work in progress (default: false) */
  allow_experimental_lightweight_delete?: Bool
  /** Move functions out of aggregate functions 'any' (default: false) */
  optimize_move_functions_out_of_any?: Bool
  /** Rewrite aggregate functions that semantically equals to count() as count(). (default: true) */
  optimize_normalize_count_variants?: Bool
  /** Delete injective functions of one argument inside uniq*() functions. (default: true) */
  optimize_injective_functions_inside_uniq?: Bool
  /** Convert SELECT query to CNF (default: false) */
  convert_query_to_cnf?: Bool
  /** Optimize multiple OR LIKE into multiMatchAny. This optimization should not be enabled by default (default: false) */
  optimize_or_like_chain?: Bool
  /** Move arithmetic operations out of aggregation functions (default: true) */
  optimize_arithmetic_operations_in_aggregate_functions?: Bool
  /** Remove duplicate ORDER BY and DISTINCT if it's possible (default: true) */
  optimize_duplicate_order_by_and_distinct?: Bool
  /** Remove functions from ORDER BY if its argument is also in ORDER BY (default: true) */
  optimize_redundant_functions_in_order_by?: Bool
  /** Replace if(cond1 (default: false) */
  optimize_if_chain_to_multiif?: Bool
  /** Replace 'multiIf' with only one condition to 'if'. (default: true) */
  optimize_multiif_to_if?: Bool
  /** Replaces string-type arguments in If and Transform to enum. Disabled by default cause it could make inconsistent change in distributed query that would lead to its fail. (default: false) */
  optimize_if_transform_strings_to_enum?: Bool
  /** Replace monotonous function with its argument in ORDER BY (default: true) */
  optimize_monotonous_functions_in_order_by?: Bool
  /** Transform functions to subcolumns (default: false) */
  optimize_functions_to_subcolumns?: Bool
  /** Use constraints for query optimization (default: false) */
  optimize_using_constraints?: Bool
  /** Use constraints for column substitution (default: false) */
  optimize_substitute_columns?: Bool
  /** Use constraints in order to append index condition (indexHint) (default: false) */
  optimize_append_index?: Bool
  /** Normalize function names to their canonical names (default: true) */
  normalize_function_names?: Bool
  /** Allow atomic alter on Materialized views. Work in progress. (default: false) */
  allow_experimental_alter_materialized_view_structure?: Bool
  /** Enable query optimization where we analyze function and subqueries results and rewrite query if there're constants there (default: true) */
  enable_early_constant_folding?: Bool
  /** Should deduplicate blocks for materialized views if the block is not a duplicate for the table. Use true to always deduplicate in dependent tables. (default: false) */
  deduplicate_blocks_in_dependent_materialized_views?: Bool
  /** Changes format of directories names for distributed table insert parts. (default: true) */
  use_compact_format_in_distributed_parts_names?: Bool
  /** Throw exception if polygon is invalid in function pointInPolygon (e.g. self-tangent (default: true) */
  validate_polygons?: Bool
  /** Maximum parser depth (recursion depth of recursive descend parser). (default: 1000) */
  max_parser_depth?: UInt64
  /** Allow SETTINGS after FORMAT (default: false) */
  allow_settings_after_format_in_insert?: Bool
  /** Timeout after which temporary live view is deleted. (default: 5) */
  temporary_live_view_timeout?: Seconds
  /** Interval after which periodically refreshed live view is forced to refresh. (default: 60) */
  periodic_live_view_refresh?: Seconds
  /** If enabled (default: false) */
  transform_null_in?: Bool
  /** Allow non-deterministic functions in ALTER UPDATE/ALTER DELETE statements (default: false) */
  allow_nondeterministic_mutations?: Bool
  /** How long locking request should wait before failing (default: 120) */
  lock_acquire_timeout?: Seconds
  /** Apply TTL for old data (default: true) */
  materialize_ttl_after_modify?: Bool
  /** Choose function implementation for specific target or variant (experimental). If empty enable all of them. (default: "") */
  function_implementation?: string
  /** Allow geo data types such as Point (default: true) */
  allow_experimental_geo_types?: Bool
  /** Data types without NULL or NOT NULL will make Nullable (default: false) */
  data_type_default_nullable?: Bool
  /** CAST operator keep Nullable for result data type (default: false) */
  cast_keep_nullable?: Bool
  /** CAST operator into IPv4 (default: false) */
  cast_ipv4_ipv6_default_on_conversion_error?: Bool
  /** Output information about affected parts. Currently works only for FREEZE and ATTACH commands. (default: false) */
  alter_partition_verbose_result?: Bool
  /** Allow to create database with Engine=MaterializedMySQL(...). (default: false) */
  allow_experimental_database_materialized_mysql?: Bool
  /** Allow to create database with Engine=MaterializedPostgreSQL(...). (default: false) */
  allow_experimental_database_materialized_postgresql?: Bool
  /** Include all metrics (default: false) */
  system_events_show_zero_values?: Bool
  /** Which MySQL types should be converted to corresponding ClickHouse types (rather than being represented as String). Can be empty or any combination of 'decimal' (default: '') */
  mysql_datatypes_support_level?: MySQLDataTypesSupport
  /** Optimize trivial 'INSERT INTO table SELECT ... FROM TABLES' query (default: true) */
  optimize_trivial_insert_select?: Bool
  /** Allow to execute alters which affects not only tables metadata (default: true) */
  allow_non_metadata_alters?: Bool
  /** Propagate WITH statements to UNION queries and all subqueries (default: true) */
  enable_global_with_statement?: Bool
  /** Rewrite all aggregate functions in a query (default: false) */
  aggregate_functions_null_for_empty?: Bool
  /** Not ready for production (default: false) */
  optimize_syntax_fuse_functions?: Bool
  /** Not ready for production (default: false) */
  optimize_fuse_sum_count_avg?: Bool
  /** If true (default: true) */
  flatten_nested?: Bool
  /** Include MATERIALIZED columns for wildcard query (default: false) */
  asterisk_include_materialized_columns?: Bool
  /** Include ALIAS columns for wildcard query (default: false) */
  asterisk_include_alias_columns?: Bool
  /** Skip partitions with one part with level > 0 in optimize final (default: false) */
  optimize_skip_merged_partitions?: Bool
  /** Do the same transformation for inserted block of data as if merge was done on this block. (default: true) */
  optimize_on_insert?: Bool
  /** If projection optimization is enabled (default: false) */
  force_optimize_projection?: Bool
  /** Asynchronously read from socket executing remote query (default: true) */
  async_socket_for_remote?: Bool
  /** Insert DEFAULT values instead of NULL in INSERT SELECT (UNION ALL) (default: true) */
  insert_null_as_default?: Bool
  /** Deduce concrete type of columns of type Object in DESCRIBE query (default: false) */
  describe_extend_object_types?: Bool
  /** If true (default: false) */
  describe_include_subcolumns?: Bool
  /** Rewrite sumIf() and sum(if()) function countIf() function when logically equivalent (default: true) */
  optimize_rewrite_sum_if_to_count_if?: Bool
  /** If non zero (default: 0) */
  insert_shard_id?: UInt64
  /** Enable collecting hash table statistics to optimize memory allocation (default: true) */
  collect_hash_table_stats_during_aggregation?: Bool
  /** How many entries hash table statistics collected during aggregation is allowed to have (default: 10'000) */
  max_entries_for_hash_table_stats?: UInt64
  /** For how many elements it is allowed to preallocate space in all hash tables in total before aggregation (default: 10'000'000) */
  max_size_to_preallocate_for_aggregation?: UInt64
  /** Experimental data deduplication for SELECT queries based on part UUIDs (default: false) */
  allow_experimental_query_deduplication?: Bool
  /** Allows to select data from a file engine table without file (default: false) */
  engine_file_empty_if_not_exists?: Bool
  /** Enables or disables truncate before insert in file engine tables (default: false) */
  engine_file_truncate_on_insert?: Bool
  /** Enables or disables creating a new file on each insert in file engine tables if format has suffix. (default: false) */
  engine_file_allow_create_multiple_files?: Bool
  /** Allow to create databases with Replicated engine (default: false) */
  allow_experimental_database_replicated?: Bool
  /** How long initial DDL query should wait for Replicated database to precess previous DDL queue entries (default: 300) */
  database_replicated_initial_query_timeout_sec?: UInt64
  /** Enforces synchronous waiting for some queries (see also database_atomic_wait_for_drop_and_detach_synchronously (default: false) */
  database_replicated_enforce_synchronous_settings?: Bool
  /** Maximum distributed query depth (default: 5) */
  max_distributed_depth?: UInt64
  /** Execute DETACH TABLE as DETACH TABLE PERMANENTLY if database engine is Replicated (default: false) */
  database_replicated_always_detach_permanently?: Bool
  /** Allow to create only Replicated tables in database with engine Replicated (default: false) */
  database_replicated_allow_only_replicated_engine?: Bool
  /** Format of distributed DDL query result (default: 'throw') */
  distributed_ddl_output_mode?: DistributedDDLOutputMode
  /** Compatibility version of distributed DDL (ON CLUSTER) queries (default: 3) */
  distributed_ddl_entry_format_version?: UInt64
  /** Limit maximum number of rows when table with external engine should flush history data. Now supported only for MySQL table engine (default: 0) */
  external_storage_max_read_rows?: UInt64
  /** Limit maximum number of bytes when table with external engine should flush history data. Now supported only for MySQL table engine (default: 0) */
  external_storage_max_read_bytes?: UInt64
  /** Connect timeout in seconds. Now supported only for MySQL (default: DBMS_DEFAULT_CONNECT_TIMEOUT_SEC) */
  external_storage_connect_timeout_sec?: UInt64
  /** Read/write timeout in seconds. Now supported only for MySQL (default: 300) */
  external_storage_rw_timeout_sec?: UInt64
  /** Set default Union Mode in SelectWithUnion query (default: '') */
  union_default_mode?: UnionMode
  /** Eliminates min/max/any/anyLast aggregators of GROUP BY keys in SELECT section (default: true) */
  optimize_aggregators_of_group_by_keys?: Bool
  /** Eliminates functions of other keys in GROUP BY section (default: true) */
  optimize_group_by_function_keys?: Bool
  /** List all names of element of large tuple literals in their column names instead of hash. This settings exists only for compatibility reasons. It makes sense to set to 'true' (default: false) */
  legacy_column_name_of_tuple_literal?: Bool
  /** Apply optimizations to query plan (default: true) */
  query_plan_enable_optimizations?: Bool
  /** Limit the total number of optimizations applied to query plan. If zero (default: 10000) */
  query_plan_max_optimizations_to_apply?: UInt64
  /** Allow to push down filter by predicate query plan step (default: true) */
  query_plan_filter_push_down?: Bool
  /** Analyze primary key using query plan (instead of AST) (default: true) */
  query_plan_optimize_primary_key?: Bool
  /** Max matches of any single regexp per row (default: 1000) */
  regexp_max_matches_per_row?: UInt64
  /** Limit on read rows from the most 'end' result for select query (default: 0) */
  limit?: UInt64
  /** Offset on read rows from the most 'end' result for select query (default: 0) */
  offset?: UInt64
  /** Maximum number of values generated by function 'range' per block of data (sum of array sizes for every row in a block (default: 500000000) */
  function_range_max_elements_in_block?: UInt64
  /** Setting for short-circuit function evaluation configuration. Possible values: 'enable' - use short-circuit function evaluation for functions that are suitable for it, 'disable' - disable short-circuit function evaluation, 'force_enable' - use short-circuit function evaluation for all functions. (default: 'enable') */
  short_circuit_function_evaluation?: ShortCircuitFunctionEvaluation
  /** Method of reading data from local filesystem (default: "pread_threadpool") */
  local_filesystem_read_method?: string
  /** Method of reading data from remote filesystem (default: "threadpool") */
  remote_filesystem_read_method?: string
  /** Should use prefetching when reading data from local filesystem. (default: false) */
  local_filesystem_read_prefetch?: Bool
  /** Should use prefetching when reading data from remote filesystem. (default: true) */
  remote_filesystem_read_prefetch?: Bool
  /** Priority to read data from local filesystem. Only supported for 'pread_threadpool' method. (default: 0) */
  read_priority?: Int64
  /** If at least as many lines are read from one file (default: (20 * 8192)) */
  merge_tree_min_rows_for_concurrent_read_for_remote_filesystem?: UInt64
  /** If at least as many bytes are read from one file (default: (24 * 10 * 1024 * 1024)) */
  merge_tree_min_bytes_for_concurrent_read_for_remote_filesystem?: UInt64
  /** Min bytes required for remote read (url (default: 4 * 1048576) */
  remote_read_min_bytes_for_seek?: UInt64
  /** Maximum number of threads to actually parse and insert data in background. Zero means asynchronous mode is disabled (default: 16) */
  async_insert_threads?: UInt64
  /** If true (default: false) */
  async_insert?: Bool
  /** If true wait for processing of asynchronous insertion (default: true) */
  wait_for_async_insert?: Bool
  /** Timeout for waiting for processing asynchronous insertion (default: 120) */
  wait_for_async_insert_timeout?: Seconds
  /** Maximum size in bytes of unparsed data collected per query before being inserted (default: 100000) */
  async_insert_max_data_size?: UInt64
  /** Maximum time to wait before dumping collected data per query since the first data appeared (default: 200) */
  async_insert_busy_timeout_ms?: Milliseconds
  /** Maximum time to wait before dumping collected data per query since the last data appeared. Zero means no timeout at all (default: 0) */
  async_insert_stale_timeout_ms?: Milliseconds
  /** Max wait time when trying to read data for remote disk (default: 10000) */
  remote_fs_read_max_backoff_ms?: UInt64
  /** Max attempts to read with backoff (default: 5) */
  remote_fs_read_backoff_max_tries?: UInt64
  /** Use cache for remote filesystem. This setting does not turn on/off cache for disks (must be done via disk config) (default: true) */
  enable_filesystem_cache?: Bool
  /** Allow to wait at most this number of seconds for download of current remote_fs_buffer_size bytes (default: 5) */
  filesystem_cache_max_wait_sec?: UInt64
  /** Write into cache on write operations. To actually work this setting requires be added to disk config too (default: false) */
  enable_filesystem_cache_on_write_operations?: Bool
  /** Allows to record the filesystem caching log for each query (default: false) */
  enable_filesystem_cache_log?: Bool
  /** " (default: false) */
  read_from_filesystem_cache_if_exists_otherwise_bypass_cache?: Bool
  /** Skip download from remote filesystem if exceeds query cache size (default: true) */
  skip_download_if_exceeds_query_cache?: Bool
  /** Max remote filesystem cache size that can be used by a single query (default: (128UL * 1024 * 1024 * 1024)) */
  max_query_cache_size?: UInt64
  /** Use structure from insertion table instead of schema inference from data (default: false) */
  use_structure_from_insertion_table_in_table_functions?: Bool
  /** Max attempts to read via http. (default: 10) */
  http_max_tries?: UInt64
  /** Min milliseconds for backoff (default: 100) */
  http_retry_initial_backoff_ms?: UInt64
  /** Max milliseconds for backoff (default: 10000) */
  http_retry_max_backoff_ms?: UInt64
  /** Recursively remove data on DROP query. Avoids 'Directory not empty' error (default: false) */
  force_remove_data_recursively_on_drop?: Bool
  /** Check that DDL query (such as DROP TABLE or RENAME) will not break dependencies (default: true) */
  check_table_dependencies?: Bool
  /** Use local cache for remote storage like HDFS or S3 (default: true) */
  use_local_cache_for_remote_storage?: Bool
  /** Allow unrestricted (without condition on path) reads from system.zookeeper table (default: false) */
  allow_unrestricted_reads_from_keeper?: Bool
  /** Allow to create databases with deprecated Ordinary engine (default: false) */
  allow_deprecated_database_ordinary?: Bool
  /** Allow to create *MergeTree tables with deprecated engine definition syntax (default: false) */
  allow_deprecated_syntax_for_merge_tree?: Bool
  /** Changes other settings according to provided ClickHouse version. If we know that we changed some behaviour in ClickHouse by changing some settings in some version (default: "") */
  compatibility?: string
  /** Additional filter expression which would be applied after reading from specified table. Syntax: {'table1': 'expression' (default: "") */
  additional_table_filters?: Map
  /** Additional filter expression which would be applied to query result (default: "") */
  additional_result_filter?: string
  /** Enable experimental functions for funnel analysis. (default: false) */
  allow_experimental_funnel_functions?: Bool
  /** Enable experimental functions for natural language processing. (default: false) */
  allow_experimental_nlp_functions?: Bool
  /** Enable experimental hash functions (hashid (default: false) */
  allow_experimental_hash_functions?: Bool
  /** Allow Object and JSON data types (default: false) */
  allow_experimental_object_type?: Bool
  /** If not empty, used for duplicate detection instead of data digest (default: "") */
  insert_deduplication_token?: string
  /** Rewrite count distinct to subquery of group by (default: false) */
  count_distinct_optimization?: Bool
  /** Throw exception if unsupported query is used inside transaction (default: true) */
  throw_on_unsupported_query_inside_transaction?: Bool
  /** Wait for committed changes to become actually visible in the latest snapshot (default: 'wait_unknown') */
  wait_changes_become_visible_after_commit_mode?: TransactionsWaitCSNMode
  /** If enabled and not already inside a transaction (default: false) */
  implicit_transaction?: Bool
  /** Enables or disables empty INSERTs (default: true) */
  throw_if_no_data_to_insert?: Bool
  /** Ignore AUTO_INCREMENT keyword in column declaration if true (default: false) */
  compatibility_ignore_auto_increment_in_create_table?: Bool
  /** Do not add aliases to top level expression list on multiple joins rewrite (default: false) */
  multiple_joins_try_to_keep_original_names?: Bool
  /** Enable DISTINCT optimization if some columns in DISTINCT form a prefix of sorting. For example (default: true) */
  optimize_distinct_in_order?: Bool
  /** Optimize sorting by sorting properties of input stream (default: true) */
  optimize_sorting_by_input_stream_properties?: Bool
  /** ' (default: ') */
  format_csv_delimiter?: Char
  /** If it is set to true (default: false) */
  format_csv_allow_single_quotes?: Bool
  /** If it is set to true (default: true) */
  format_csv_allow_double_quotes?: Bool
  /** If it is set true (default: false) */
  output_format_csv_crlf_end_of_line?: Bool
  /** Treat inserted enum values in CSV formats as enum indices (default: false) */
  input_format_csv_enum_as_number?: Bool
  /** R"(When reading Array from CSV (default: false) */
  input_format_csv_arrays_as_nested_csv?: Bool
  /** Skip columns with unknown names from input data (it works for JSONEachRow (default: true) */
  input_format_skip_unknown_fields?: Bool
  /** For -WithNames input formats this controls whether format parser is to assume that column data appear in the input exactly as they are specified in the header. (default: true) */
  input_format_with_names_use_header?: Bool
  /** For -WithNamesAndTypes input formats this controls whether format parser should check if data types from the input match data types from the header. (default: true) */
  input_format_with_types_use_header?: Bool
  /** Map nested JSON data to nested tables (it works for JSONEachRow format). (default: false) */
  input_format_import_nested_json?: Bool
  /** For input data calculate default expressions for omitted fields (it works for JSONEachRow (default: true) */
  input_format_defaults_for_omitted_fields?: Bool
  /** Treat empty fields in CSV input as default values. (default: true) */
  input_format_csv_empty_as_default?: Bool
  /** Treat empty fields in TSV input as default values. (default: false) */
  input_format_tsv_empty_as_default?: Bool
  /** Treat inserted enum values in TSV formats as enum indices. (default: false) */
  input_format_tsv_enum_as_number?: Bool
  /** For text input formats initialize null fields with default values if data type of this field is not nullable (default: true) */
  input_format_null_as_default?: Bool
  /** Allow to insert array of structs into Nested table in Arrow input format. (default: false) */
  input_format_arrow_import_nested?: Bool
  /** Ignore case when matching Arrow columns with CH columns. (default: false) */
  input_format_arrow_case_insensitive_column_matching?: Bool
  /** Allow to insert array of structs into Nested table in ORC input format. (default: false) */
  input_format_orc_import_nested?: Bool
  /** Batch size when reading ORC stripes. (default: 100'000) */
  input_format_orc_row_batch_size?: Int64
  /** Ignore case when matching ORC columns with CH columns. (default: false) */
  input_format_orc_case_insensitive_column_matching?: Bool
  /** Allow to insert array of structs into Nested table in Parquet input format. (default: false) */
  input_format_parquet_import_nested?: Bool
  /** Ignore case when matching Parquet columns with CH columns. (default: false) */
  input_format_parquet_case_insensitive_column_matching?: Bool
  /** Allow seeks while reading in ORC/Parquet/Arrow input formats (default: true) */
  input_format_allow_seeks?: Bool
  /** Allow missing columns while reading ORC input formats (default: false) */
  input_format_orc_allow_missing_columns?: Bool
  /** Allow missing columns while reading Parquet input formats (default: false) */
  input_format_parquet_allow_missing_columns?: Bool
  /** Allow missing columns while reading Arrow input formats (default: false) */
  input_format_arrow_allow_missing_columns?: Bool
  /** Delimiter between fields in Hive Text File (default: '\x01') */
  input_format_hive_text_fields_delimiter?: Char
  /** Delimiter between collection(array or map) items in Hive Text File (default: '\x02') */
  input_format_hive_text_collection_items_delimiter?: Char
  /** Delimiter between a pair of map key/values in Hive Text File (default: '\x03') */
  input_format_hive_text_map_keys_delimiter?: Char
  /** The number of columns in inserted MsgPack data. Used for automatic schema inference from data. (default: 0) */
  input_format_msgpack_number_of_columns?: UInt64
  /** The way how to output UUID in MsgPack format. (default: 'ext') */
  output_format_msgpack_uuid_representation?: MsgPackUUIDRepresentation
  /** The maximum rows of data to read for automatic schema inference (default: 25000) */
  input_format_max_rows_to_read_for_schema_inference?: UInt64
  /** Use some tweaks and heuristics to infer schema in CSV format (default: true) */
  input_format_csv_use_best_effort_in_schema_inference?: Bool
  /** Use some tweaks and heuristics to infer schema in TSV format (default: true) */
  input_format_tsv_use_best_effort_in_schema_inference?: Bool
  /** Skip columns with unsupported types while schema inference for format Parquet (default: false) */
  input_format_parquet_skip_columns_with_unsupported_types_in_schema_inference?: Bool
  /** Skip fields with unsupported types while schema inference for format Protobuf (default: false) */
  input_format_protobuf_skip_fields_with_unsupported_types_in_schema_inference?: Bool
  /** Skip columns with unsupported types while schema inference for format CapnProto (default: false) */
  input_format_capn_proto_skip_fields_with_unsupported_types_in_schema_inference?: Bool
  /** Skip columns with unsupported types while schema inference for format ORC (default: false) */
  input_format_orc_skip_columns_with_unsupported_types_in_schema_inference?: Bool
  /** Skip columns with unsupported types while schema inference for format Arrow (default: false) */
  input_format_arrow_skip_columns_with_unsupported_types_in_schema_inference?: Bool
  /** The list of column names to use in schema inference for formats without column names. The format: 'column1 (default: "") */
  column_names_for_schema_inference?: string
  /** Allow to parse bools as numbers in JSON input formats (default: true) */
  input_format_json_read_bools_as_numbers?: Bool
  /** Try to infer numbers from string fields while schema inference (default: true) */
  input_format_json_try_infer_numbers_from_strings?: Bool
  /** Try to infer numbers from string fields while schema inference in text formats (default: true) */
  input_format_try_infer_integers?: Bool
  /** Try to infer dates from string fields while schema inference in text formats (default: true) */
  input_format_try_infer_dates?: Bool
  /** Try to infer datetimes from string fields while schema inference in text formats (default: true) */
  input_format_try_infer_datetimes?: Bool
  /** Enable Google wrappers for regular non-nested columns (default: false) */
  input_format_protobuf_flatten_google_wrappers?: Bool
  /** When serializing Nullable columns with Google wrappers (default: false) */
  output_format_protobuf_nullables_with_google_wrappers?: Bool
  /** Skip specified number of lines at the beginning of data in CSV format (default: 0) */
  input_format_csv_skip_first_lines?: UInt64
  /** Skip specified number of lines at the beginning of data in TSV format (default: 0) */
  input_format_tsv_skip_first_lines?: UInt64
  /** Method to read DateTime from text input formats (default: 'basic') */
  date_time_input_format?: DateTimeInputFormat
  /** Method to write DateTime to text output (default: 'simple') */
  date_time_output_format?: DateTimeOutputFormat
  /** Deserialization of IPv4 will use default values instead of throwing exception on conversion error. (default: false) */
  input_format_ipv4_default_on_conversion_error?: Bool
  /** Deserialization of IPV6 will use default values instead of throwing exception on conversion error. (default: false) */
  input_format_ipv6_default_on_conversion_error?: Bool
  /** Text to represent bool value in TSV/CSV formats. (default: "true") */
  bool_true_representation?: string
  /** Text to represent bool value in TSV/CSV formats. (default: "false") */
  bool_false_representation?: string
  /** For Values format: if the field could not be parsed by streaming parser (default: true) */
  input_format_values_interpret_expressions?: Bool
  /** For Values format: if the field could not be parsed by streaming parser (default: true) */
  input_format_values_deduce_templates_of_expressions?: Bool
  /** For Values format: when parsing and interpreting expressions using template (default: true) */
  input_format_values_accurate_types_of_literals?: Bool
  /** For Avro/AvroConfluent format: when field is not found in schema use default value instead of error (default: false) */
  input_format_avro_allow_missing_fields?: Bool
  /** For Avro/AvroConfluent format: insert default in case of null and non Nullable column (default: false) */
  input_format_avro_null_as_default?: Bool
  /** For AvroConfluent format: Confluent Schema Registry URL. (default: "") */
  format_avro_schema_registry_url?: URI
  /** Controls quoting of 64-bit integers in JSON output format. (default: true) */
  output_format_json_quote_64bit_integers?: Bool
  /** Enables '+nan' (default: false) */
  output_format_json_quote_denormals?: Bool
  /** Controls escaping forward slashes for string outputs in JSON output format. This is intended for compatibility with JavaScript. Don't confuse with backslashes that are always escaped. (default: true) */
  output_format_json_escape_forward_slashes?: Bool
  /** Serialize named tuple columns as JSON objects. (default: true) */
  output_format_json_named_tuples_as_objects?: Bool
  /** Output a JSON array of all rows in JSONEachRow(Compact) format. (default: false) */
  output_format_json_array_of_rows?: Bool
  /** Rows limit for Pretty formats. (default: 10000) */
  output_format_pretty_max_rows?: UInt64
  /** Maximum width to pad all values in a column in Pretty formats. (default: 250) */
  output_format_pretty_max_column_pad_width?: UInt64
  /** Maximum width of value to display in Pretty formats. If greater - it will be cut. (default: 10000) */
  output_format_pretty_max_value_width?: UInt64
  /** Use ANSI escape sequences to paint colors in Pretty formats (default: true) */
  output_format_pretty_color?: Bool
  /** Charset for printing grid borders. Available charsets: ASCII (default: "UTF-8") */
  output_format_pretty_grid_charset?: string
  /** Row group size in rows. (default: 1000000) */
  output_format_parquet_row_group_size?: UInt64
  /** Use Parquet String type instead of Binary for String columns. (default: false) */
  output_format_parquet_string_as_string?: Bool
  /** Compression codec used for output (default: "") */
  output_format_avro_codec?: string
  /** Sync interval in bytes. (default: 16 * 1024) */
  output_format_avro_sync_interval?: UInt64
  /** For Avro format: regexp of String columns to select as AVRO string. (default: "") */
  output_format_avro_string_column_pattern?: string
  /** Max rows in a file (if permitted by storage) (default: 1) */
  output_format_avro_rows_in_file?: UInt64
  /** If it is set true (default: false) */
  output_format_tsv_crlf_end_of_line?: Bool
  /** Custom NULL representation in CSV format (default: "\\N") */
  format_csv_null_representation?: string
  /** Custom NULL representation in TSV format (default: "\\N") */
  format_tsv_null_representation?: string
  /** Output trailing zeros when printing Decimal values. E.g. 1.230000 instead of 1.23. (default: false) */
  output_format_decimal_trailing_zeros?: Bool
  /** Maximum absolute amount of errors while reading text formats (like CSV (default: 0) */
  input_format_allow_errors_num?: UInt64
  /** Maximum relative amount of errors while reading text formats (like CSV (default: 0) */
  input_format_allow_errors_ratio?: Float
  /** Schema identifier (used by schema-based formats) (default: "") */
  format_schema?: string
  /** Path to file which contains format string for result set (for Template format) (default: "") */
  format_template_resultset?: string
  /** Path to file which contains format string for rows (for Template format) (default: "") */
  format_template_row?: string
  /** Delimiter between rows (for Template format) (default: "\n") */
  format_template_rows_between_delimiter?: string
  /** Field escaping rule (for CustomSeparated format) (default: "Escaped") */
  format_custom_escaping_rule?: EscapingRule
  /** Delimiter between fields (for CustomSeparated format) (default: "\t") */
  format_custom_field_delimiter?: string
  /** Delimiter before field of the first column (for CustomSeparated format) (default: "") */
  format_custom_row_before_delimiter?: string
  /** Delimiter after field of the last column (for CustomSeparated format) (default: "\n") */
  format_custom_row_after_delimiter?: string
  /** Delimiter between rows (for CustomSeparated format) (default: "") */
  format_custom_row_between_delimiter?: string
  /** Prefix before result set (for CustomSeparated format) (default: "") */
  format_custom_result_before_delimiter?: string
  /** Suffix after result set (for CustomSeparated format) (default: "") */
  format_custom_result_after_delimiter?: string
  /** Regular expression (for Regexp format) (default: "") */
  format_regexp?: string
  /** Field escaping rule (for Regexp format) (default: "Raw") */
  format_regexp_escaping_rule?: EscapingRule
  /** Skip lines unmatched by regular expression (for Regexp format) (default: false) */
  format_regexp_skip_unmatched?: Bool
  /** Enable streaming in output formats that support it. (default: false) */
  output_format_enable_streaming?: Bool
  /** Write statistics about read rows (default: true) */
  output_format_write_statistics?: Bool
  /** Add row numbers before each row for pretty output format (default: false) */
  output_format_pretty_row_numbers?: Bool
  /** If setting is enabled (default: false) */
  insert_distributed_one_random_shard?: Bool
  /** When enabled (default: false) */
  exact_rows_before_limit?: Bool
  /** Use inner join instead of comma/cross join if there're joining expressions in the WHERE section. Values: 0 - no rewrite (default: 1) */
  cross_to_inner_join_rewrite?: UInt64
  /** Enable output LowCardinality type as Dictionary Arrow type (default: false) */
  output_format_arrow_low_cardinality_as_dictionary?: Bool
  /** Use Arrow String type instead of Binary for String columns (default: false) */
  output_format_arrow_string_as_string?: Bool
  /** Use ORC String type instead of Binary for String columns (default: false) */
  output_format_orc_string_as_string?: Bool
  /** How to map ClickHouse Enum and CapnProto Enum (default: 'by_values') */
  format_capn_proto_enum_comparising_mode?: EnumComparingMode
  /** Name of the table in MySQL dump from which to read data (default: "") */
  input_format_mysql_dump_table_name?: string
  /** Match columns from table in MySQL dump and columns from ClickHouse table by names (default: true) */
  input_format_mysql_dump_map_column_names?: Bool
  /** The maximum number  of rows in one INSERT statement. (default: 65505) */
  output_format_sql_insert_max_batch_size?: UInt64
  /** The name of table in the output INSERT query (default: "table") */
  output_format_sql_insert_table_name?: string
  /** Include column names in INSERT query (default: true) */
  output_format_sql_insert_include_column_names?: Bool
  /** Use REPLACE statement instead of INSERT (default: false) */
  output_format_sql_insert_use_replace?: Bool
  /** Quote column names with '`' characters (default: true) */
  output_format_sql_insert_quote_names?: Bool
}

interface ClickHouseHTTPSettings {
  wait_end_of_query?: Bool
}

export type ClickHouseSettings = ClickHouseServerSettings &
  ClickHouseHTTPSettings

export interface MergeTreeSettings {
  /** When granule is written (default: 0) */
  min_compress_block_size?: UInt64
  /** Compress the pending uncompressed data in buffer if its size is larger or equal than the specified threshold. Block of data will be compressed even if the current granule is not finished. If this setting is not set (default: 0) */
  max_compress_block_size?: UInt64
  /** How many rows correspond to one primary key value. (default: 8192) */
  index_granularity?: UInt64
  /** Minimal uncompressed size in bytes to create part in wide format instead of compact (default: 10485760) */
  min_bytes_for_wide_part?: UInt64
  /** Minimal number of rows to create part in wide format instead of compact (default: 0) */
  min_rows_for_wide_part?: UInt64
  /** Experimental. Minimal uncompressed size in bytes to create part in compact format instead of saving it in RAM (default: 0) */
  min_bytes_for_compact_part?: UInt64
  /** Experimental. Minimal number of rows to create part in compact format instead of saving it in RAM (default: 0) */
  min_rows_for_compact_part?: UInt64
  /** Whether to write blocks in Native format to write-ahead-log before creation in-memory part (default: true) */
  in_memory_parts_enable_wal?: Bool
  /** Rotate WAL (default: 1024 * 1024 * 1024) */
  write_ahead_log_max_bytes?: UInt64
  /** Minimal ratio of number of default values to number of all values in column to store it in sparse serializations. If >= 1 (default: 1.0) */
  ratio_of_defaults_for_sparse_serialization?: Float
  /** How many rows in blocks should be formed for merge operations. (default: DEFAULT_MERGE_BLOCK_SIZE) */
  merge_max_block_size?: UInt64
  /** Maximum in total size of parts to merge (default: 150ULL * 1024 * 1024 * 1024) */
  max_bytes_to_merge_at_max_space_in_pool?: UInt64
  /** Maximum in total size of parts to merge (default: 1024 * 1024) */
  max_bytes_to_merge_at_min_space_in_pool?: UInt64
  /** How many tasks of merging and mutating parts are allowed simultaneously in ReplicatedMergeTree queue. (default: 16) */
  max_replicated_merges_in_queue?: UInt64
  /** How many tasks of mutating parts are allowed simultaneously in ReplicatedMergeTree queue. (default: 8) */
  max_replicated_mutations_in_queue?: UInt64
  /** How many tasks of merging parts with TTL are allowed simultaneously in ReplicatedMergeTree queue. (default: 1) */
  max_replicated_merges_with_ttl_in_queue?: UInt64
  /** When there is less than specified number of free entries in pool (or replicated queue) (default: 8) */
  number_of_free_entries_in_pool_to_lower_max_size_of_merge?: UInt64
  /** When there is less than specified number of free entries in pool (default: 20) */
  number_of_free_entries_in_pool_to_execute_mutation?: UInt64
  /** When there is more than specified number of merges with TTL entries in pool (default: 2) */
  max_number_of_merges_with_ttl_in_pool?: UInt64
  /** How many seconds to keep obsolete parts. (default: 8 * 60) */
  old_parts_lifetime?: Seconds
  /** How many seconds to keep tmp_-directories. You should not lower this value because merges and mutations may not be able to work with low value of this setting. (default: 86400) */
  temporary_directories_lifetime?: Seconds
  /** For background operations like merges (default: DBMS_DEFAULT_LOCK_ACQUIRE_TIMEOUT_SEC) */
  lock_acquire_timeout_for_background_operations?: Seconds
  /** Minimal number of rows to do fsync for part after merge (0 - disabled) (default: 0) */
  min_rows_to_fsync_after_merge?: UInt64
  /** Minimal number of compressed bytes to do fsync for part after merge (0 - disabled) (default: 0) */
  min_compressed_bytes_to_fsync_after_merge?: UInt64
  /** Minimal number of compressed bytes to do fsync for part after fetch (0 - disabled) (default: 0) */
  min_compressed_bytes_to_fsync_after_fetch?: UInt64
  /** Do fsync for every inserted part. Significantly decreases performance of inserts (default: false) */
  fsync_after_insert?: Bool
  /** Do fsync for part directory after all part operations (writes (default: false) */
  fsync_part_directory?: Bool
  /** Amount of bytes (default: 100ULL * 1024 * 1024) */
  write_ahead_log_bytes_to_fsync?: UInt64
  /** Interval in milliseconds after which fsync for WAL is being done. (default: 100) */
  write_ahead_log_interval_ms_to_fsync?: UInt64
  /** If true insert of part with in-memory format will wait for fsync of WAL (default: false) */
  in_memory_parts_insert_sync?: Bool
  /** How many last blocks of hashes should be kept on disk (0 - disabled). (default: 0) */
  non_replicated_deduplication_window?: UInt64
  /** Max amount of parts which can be merged at once (0 - disabled). Doesn't affect OPTIMIZE FINAL query. (default: 100) */
  max_parts_to_merge_at_once?: UInt64
  /** Sleep time for merge selecting when no part selected (default: 5000) */
  merge_selecting_sleep_ms?: UInt64
  /** The period of executing the clear old temporary directories operation in background. (default: 60) */
  merge_tree_clear_old_temporary_directories_interval_seconds?: UInt64
  /** The period of executing the clear old parts operation in background. (default: 1) */
  merge_tree_clear_old_parts_interval_seconds?: UInt64
  /** Remove old broken detached parts in the background if they remained untouched for a specified by this setting period of time. (default: 1ULL * 3600 * 24 * 30) */
  merge_tree_clear_old_broken_detached_parts_ttl_timeout_seconds?: UInt64
  /** Enable clearing old broken detached parts operation in background. (default: false) */
  merge_tree_enable_clear_old_broken_detached?: UInt64
  /** Setting for an incomplete experimental feature. (default: 1) */
  remove_rolled_back_parts_immediately?: Bool
  /** If table contains at least that many active parts in single partition (default: 150) */
  parts_to_delay_insert?: UInt64
  /** If table contains at least that many inactive parts in single partition (default: 0) */
  inactive_parts_to_delay_insert?: UInt64
  /** If more than this number active parts in single partition (default: 300) */
  parts_to_throw_insert?: UInt64
  /** If more than this number inactive parts in single partition (default: 0) */
  inactive_parts_to_throw_insert?: UInt64
  /** Max delay of inserting data into MergeTree table in seconds (default: 1) */
  max_delay_to_insert?: UInt64
  /** If more than this number active parts in all partitions in total (default: 100000) */
  max_parts_in_total?: UInt64
  /** How many last blocks of hashes should be kept in ZooKeeper (old blocks will be deleted). (default: 100) */
  replicated_deduplication_window?: UInt64
  /** Similar to "replicated_deduplication_window" (default: 7 * 24 * 60 * 60 // one week) */
  replicated_deduplication_window_seconds?: UInt64
  /** How many records may be in log (default: 1000) */
  max_replicated_logs_to_keep?: UInt64
  /** Keep about this number of last records in ZooKeeper log (default: 10) */
  min_replicated_logs_to_keep?: UInt64
  /** If time passed after replication log entry creation exceeds this threshold and sum size of parts is greater than \"prefer_fetch_merged_part_size_threshold\ (default: 3600) */
  prefer_fetch_merged_part_time_threshold?: Seconds
  /** If sum size of parts exceeds this threshold and time passed after replication log entry creation is greater than \"prefer_fetch_merged_part_time_threshold\ (default: 10ULL * 1024 * 1024 * 1024) */
  prefer_fetch_merged_part_size_threshold?: UInt64
  /** When greater than zero only a single replica starts the merge immediately (default: 0) */
  execute_merges_on_single_replica_time_threshold?: Seconds
  /** When greater than zero only a single replica starts the merge immediately if merged part on shared storage and 'allow_remote_fs_zero_copy_replication' is enabled. (default: 3 * 60 * 60) */
  remote_fs_execute_merges_on_single_replica_time_threshold?: Seconds
  /** Recompression works slow in most cases (default: 7200) */
  try_fetch_recompressed_part_timeout?: Seconds
  /** If true (default: false) */
  always_fetch_merged_part?: Bool
  /** Max broken parts (default: 10) */
  max_suspicious_broken_parts?: UInt64
  /** Max size of all broken parts (default: 1ULL * 1024 * 1024 * 1024) */
  max_suspicious_broken_parts_bytes?: UInt64
  /** Not apply ALTER if number of files for modification(deletion (default: 75) */
  max_files_to_modify_in_alter_columns?: UInt64
  /** Not apply ALTER (default: 50) */
  max_files_to_remove_in_alter_columns?: UInt64
  /** If ratio of wrong parts to total number of parts is less than this - allow to start. (default: 0.5) */
  replicated_max_ratio_of_wrong_parts?: Float
  /** Limit parallel fetches from endpoint (actually pool size). (default: DEFAULT_COUNT_OF_HTTP_CONNECTIONS_PER_ENDPOINT) */
  replicated_max_parallel_fetches_for_host?: UInt64
  /** HTTP connection timeout for part fetch requests. Inherited from default profile `http_connection_timeout` if not set explicitly. (default: 0) */
  replicated_fetches_http_connection_timeout?: Seconds
  /** HTTP send timeout for part fetch requests. Inherited from default profile `http_send_timeout` if not set explicitly. (default: 0) */
  replicated_fetches_http_send_timeout?: Seconds
  /** HTTP receive timeout for fetch part requests. Inherited from default profile `http_receive_timeout` if not set explicitly. (default: 0) */
  replicated_fetches_http_receive_timeout?: Seconds
  /** If true (default: true) */
  replicated_can_become_leader?: Bool
  /** ZooKeeper session expiration check period (default: 60) */
  zookeeper_session_expiration_check_period?: Seconds
  /** Retry period for table initialization (default: 60) */
  initialization_retry_period?: Seconds
  /** Do not remove old local parts when repairing lost replica. (default: true) */
  detach_old_local_parts_when_cloning_replica?: Bool
  /** Do not remove non byte-identical parts for ReplicatedMergeTree (default: false) */
  detach_not_byte_identical_parts?: Bool
  /** The maximum speed of data exchange over the network in bytes per second for replicated fetches. Zero means unlimited. (default: 0) */
  max_replicated_fetches_network_bandwidth?: UInt64
  /** The maximum speed of data exchange over the network in bytes per second for replicated sends. Zero means unlimited. (default: 0) */
  max_replicated_sends_network_bandwidth?: UInt64
  /** Calculate relative replica delay only if absolute delay is not less that this value. (default: 120) */
  min_relative_delay_to_measure?: UInt64
  /** Period to clean old queue logs (default: 30) */
  cleanup_delay_period?: UInt64
  /** Add uniformly distributed value from 0 to x seconds to cleanup_delay_period to avoid thundering herd effect and subsequent DoS of ZooKeeper in case of very large number of tables. (default: 10) */
  cleanup_delay_period_random_add?: UInt64
  /** Minimal delay from other replicas to close (default: 300) */
  min_relative_delay_to_close?: UInt64
  /** Minimal absolute delay to close (default: 0) */
  min_absolute_delay_to_close?: UInt64
  /** Enable usage of Vertical merge algorithm. (default: 1) */
  enable_vertical_merge_algorithm?: UInt64
  /** Minimal (approximate) sum of rows in merging parts to activate Vertical merge algorithm. (default: 16 * DEFAULT_MERGE_BLOCK_SIZE) */
  vertical_merge_algorithm_min_rows_to_activate?: UInt64
  /** Minimal amount of non-PK columns to activate Vertical merge algorithm. (default: 11) */
  vertical_merge_algorithm_min_columns_to_activate?: UInt64
  /** Allow to create a table with sampling expression not in primary key. This is needed only to temporarily allow to run the server with wrong tables for backward compatibility. (default: false) */
  compatibility_allow_sampling_expression_not_in_primary_key?: Bool
  /** Use small format (dozens bytes) for part checksums in ZooKeeper instead of ordinary ones (dozens KB). Before enabling check that all replicas support new format. (default: true) */
  use_minimalistic_checksums_in_zookeeper?: Bool
  /** Store part header (checksums and columns) in a compact format and a single part znode instead of separate znodes (<part>/columns and <part>/checksums). This can dramatically reduce snapshot size in ZooKeeper. Before enabling check that all replicas support new format. (default: true) */
  use_minimalistic_part_header_in_zookeeper?: Bool
  /** How many records about mutations that are done to keep. If zero (default: 100) */
  finished_mutations_to_keep?: UInt64
  /** Minimal amount of bytes to enable O_DIRECT in merge (0 - disabled). (default: 10ULL * 1024 * 1024 * 1024) */
  min_merge_bytes_to_use_direct_io?: UInt64
  /** Approximate amount of bytes in single granule (0 - disabled). (default: 10 * 1024 * 1024) */
  index_granularity_bytes?: UInt64
  /** Minimum amount of bytes in single granule. (default: 1024) */
  min_index_granularity_bytes?: UInt64
  /** Minimal time in seconds (default: 3600 * 4) */
  merge_with_ttl_timeout?: Int64
  /** Minimal time in seconds (default: 3600 * 4) */
  merge_with_recompression_ttl_timeout?: Int64
  /** Only drop altogether the expired parts and not partially prune them. (default: false) */
  ttl_only_drop_parts?: Bool
  /** Only recalculate ttl info when MATERIALIZE TTL (default: false) */
  materialize_ttl_recalculate_only?: Bool
  /** Enable parts with adaptive and non-adaptive granularity (default: true) */
  enable_mixed_granularity_parts?: Bool
  /** The number of threads to load data parts at startup. (default: 0) */
  max_part_loading_threads?: MaxThreads
  /** The number of threads for concurrent removal of inactive data parts. One is usually enough (default: 0) */
  max_part_removal_threads?: MaxThreads
  /** Activate concurrent part removal (see 'max_part_removal_threads') only if the number of inactive data parts is at least this. (default: 100) */
  concurrent_part_removal_threshold?: UInt64
  /** Name of storage disk policy (default: "default") */
  storage_policy?: string
  /** Allow Nullable types as primary keys. (default: false) */
  allow_nullable_key?: Bool
  /** Remove empty parts after they were pruned by TTL (default: true) */
  remove_empty_parts?: Bool
  /** Generate UUIDs for parts. Before enabling check that all replicas support new format. (default: false) */
  assign_part_uuids?: Bool
  /** Limit the max number of partitions that can be accessed in one query. <= 0 means unlimited. This setting is the default that can be overridden by the query-level setting with the same name. (default: -1) */
  max_partitions_to_read?: Int64
  /** Max number of concurrently executed queries related to the MergeTree table (0 - disabled). Queries will still be limited by other max_concurrent_queries settings. (default: 0) */
  max_concurrent_queries?: UInt64
  /** Minimal number of marks to honor the MergeTree-level's max_concurrent_queries (0 - disabled). Queries will still be limited by other max_concurrent_queries settings. (default: 0) */
  min_marks_to_honor_max_concurrent_queries?: UInt64
  /** Minimal amount of bytes to enable part rebalance over JBOD array (0 - disabled). (default: 0) */
  min_bytes_to_rebalance_partition_over_jbod?: UInt64
  /** Check columns or columns by hash for sampling are unsigned integer. (default: true) */
  check_sample_column_is_correct?: Bool
  /** Experimental/Incomplete feature to move parts between shards. Does not take into account sharding expressions. (default: 0) */
  part_moves_between_shards_enable?: UInt64
  /** Time to wait before/after moving parts between shards. (default: 30) */
  part_moves_between_shards_delay_seconds?: UInt64
  /** Experimental feature to speed up parts loading process by using MergeTree metadata cache (default: false) */
  use_metadata_cache?: Bool
  /** Don't use this setting in production (default: false) */
  allow_remote_fs_zero_copy_replication?: Bool
  /** ZooKeeper path for Zero-copy table-independent info. (default: "/clickhouse/zero_copy") */
  remote_fs_zero_copy_zookeeper_path?: string
  /** Run zero-copy in compatible mode during conversion process. (default: false) */
  remote_fs_zero_copy_path_compatible_mode?: Bool
}

type Bool = 0 | 1
type Int64 = string
type UInt64 = string
type UInt64Auto = string
type Float = number
type MaxThreads = number
type Seconds = number
type Milliseconds = number
type Char = string
type URI = string
type Map = SettingsMap

export class SettingsMap {
  private constructor(private readonly record: Record<string, string>) {}

  toString(): string {
    return `{${Object.entries(this.record)
      .map(([k, v]) => `'${k}':'${v}'`)
      .join(',')}}`
  }

  static from(record: Record<string, string>) {
    return new this(record)
  }
}

export type LoadBalancing =
  // among replicas with a minimum number of errors selected randomly
  | 'random'
  // a replica is selected among the replicas with the minimum number of errors
  // with the minimum number of distinguished characters
  // in the replica name and local hostname
  | 'nearest_hostname'
  // replicas with the same number of errors are accessed in the same order
  // as they are specified in the configuration.
  | 'in_order'
  // if first replica one has higher number of errors,
  // pick a random one from replicas with minimum number of errors
  | 'first_or_random'
  // round-robin across replicas with the same number of errors
  | 'round_robin'

// Which rows should be included in TOTALS.
export type TotalsMode =
  // Count HAVING for all read rows
  // including those not in max_rows_to_group_by
  // and have not passed HAVING after grouping
  | 'before_having'
  // Count on all rows except those that have not passed HAVING;
  // that is, to include in TOTALS all the rows that did not pass max_rows_to_group_by.
  | 'after_having_inclusive'
  // Include only the rows that passed and max_rows_to_group_by, and HAVING.
  | 'after_having_exclusive'
  // Automatically select between INCLUSIVE and EXCLUSIVE
  | 'after_having_auto'

/// The setting for executing distributed sub-queries inside IN or JOIN sections.
export type DistributedProductMode =
  | 'deny' /// Disable
  | 'local' /// Convert to local query
  | 'global' /// Convert to global query
  | 'allow' /// Enable

export type LogsLevel =
  | 'none' /// Disable
  | 'fatal'
  | 'error'
  | 'warning'
  | 'information'
  | 'debug'
  | 'trace'
  | 'test'

export type LogQueriesType =
  | 'QUERY_START'
  | 'QUERY_FINISH'
  | 'EXCEPTION_BEFORE_START'
  | 'EXCEPTION_WHILE_PROCESSING'

export type DefaultTableEngine =
  | 'Memory'
  | 'ReplicatedMergeTree'
  | 'ReplacingMergeTree'
  | 'MergeTree'
  | 'StripeLog'
  | 'ReplicatedReplacingMergeTree'
  | 'Log'
  | 'None'

export type MySQLDataTypesSupport =
  // default
  | ''
  // convert MySQL date type to ClickHouse String
  // (This is usually used when your mysql date is less than 1925)
  | 'date2String'
  // convert MySQL date type to ClickHouse Date32
  | 'date2Date32'
  // convert MySQL DATETIME and TIMESTAMP and ClickHouse DateTime64
  // if precision is > 0 or range is greater that for DateTime.
  | 'datetime64'
  // convert MySQL decimal and number to ClickHouse Decimal when applicable
  | 'decimal'

export type UnionMode =
  | '' // Query UNION without UnionMode will throw exception
  | 'ALL' // Query UNION without UnionMode -> SELECT ... UNION ALL SELECT ...
  | 'DISTINCT' // Query UNION without UnionMode -> SELECT ... UNION DISTINCT SELECT ...

export type DistributedDDLOutputMode =
  | 'never_throw'
  | 'null_status_on_timeout'
  | 'throw'
  | 'none'

export type ShortCircuitFunctionEvaluation =
  // Use short-circuit function evaluation for all functions.
  | 'force_enable'
  // Disable short-circuit function evaluation.
  | 'disable'
  // Use short-circuit function evaluation for functions that are suitable for it.
  | 'enable'

export type TransactionsWaitCSNMode = 'wait_unknown' | 'wait' | 'async'

export type EscapingRule =
  | 'CSV'
  | 'JSON'
  | 'Quoted'
  | 'Raw'
  | 'XML'
  | 'Escaped'
  | 'None'

export type DateTimeOutputFormat = 'simple' | 'iso' | 'unix_timestamp'

/// For capnProto format we should determine how to
/// compare ClickHouse Enum and Enum from schema.
export type EnumComparingMode =
  // Case-insensitive name comparison.
  | 'by_names_case_insensitive'
  // Values should be the same, names can be different.
  | 'by_values'
  // Names in enums should be the same, values can be different.
  | 'by_names'

export type DateTimeInputFormat =
  // Use sophisticated rules to parse American style: mm/dd/yyyy
  | 'best_effort_us'
  // Use sophisticated rules to parse whatever possible.
  | 'best_effort'
  // Default format for fast parsing: YYYY-MM-DD hh:mm:ss
  // (ISO-8601 without fractional part and timezone) or NNNNNNNNNN unix timestamp.
  | 'basic'

export type MsgPackUUIDRepresentation =
  // Output UUID as ExtType = 2
  | 'ext'
  // Output UUID as a string of 36 characters.
  | 'str'
  // Output UUID as 16-bytes binary.
  | 'bin'

/// What to do if the limit is exceeded.
export type OverflowMode =
  // Abort query execution, return what is.
  | 'break'
  // Throw exception.
  | 'throw'

export type OverflowModeGroupBy =
  | OverflowMode
  // do not add new rows to the set,
  // but continue to aggregate for keys that are already in the set.
  | 'any'

/// Allows more optimal JOIN for typical cases.
export type JoinStrictness =
  // Semi Join with any value from filtering table.
  // For LEFT JOIN with Any and RightAny are the same.
  | 'ANY'
  // If there are many suitable rows to join,
  // use all of them and replicate rows of "left" table (usual semantic of JOIN).
  | 'ALL'
  // Unspecified
  | ''

export type JoinAlgorithm =
  | 'prefer_partial_merge'
  | 'hash'
  | 'parallel_hash'
  | 'partial_merge'
  | 'auto'
