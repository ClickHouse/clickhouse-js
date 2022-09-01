# Memory leaks tests

---

The goal is to determine whether we have any memory leaks in the client implementation.
For that, we can have various tests with periodical memory usage logging such as random data or predefined file streaming.

NB: we supposedly avoid using `ts-node` as it adds some runtime overhead.

Every test requires a local ClickHouse instance running.

You can just use docker-compose.yml from the root directory:

```sh
docker-compose up -d
```

## Brown university benchmark file loading

---

See `memory_leak_brown.ts`.
You will need to prepare the input data and have a local ClickHouse instance running
(just use `docker-compose.yml` from the root).

All commands assume that you are in the root project directory.

#### Prepare input data

```sh
mkdir -p benchmarks/leaks/input \
&& curl https://datasets.clickhouse.com/mgbench1.csv.xz --output mgbench1.csv.xz \
&& xz -v -d mgbench1.csv.xz \
&& mv mgbench1.csv benchmarks/leaks/input
```

See [official examples](https://clickhouse.com/docs/en/getting-started/example-datasets/brown-benchmark/) for more information.

#### Run the test

```sh
tsc --project tsconfig.dev.json \
&& node --expose-gc --max-old-space-size=256 \
build/benchmarks/leaks/memory_leak_brown.js
```

## Random integers streaming test

---

This test creates a simple table with two integer columns and sends one stream per batch.

Configuration can be done via env variables:

- `BATCH_SIZE` - number of random rows within one stream before sending it to ClickHouse (default: 10000)
- `ITERATIONS` - number of streams (batches) to be sent to ClickHouse (default: 10000)
- `LOG_INTERVAL` - memory usage will be logged every Nth iteration, where N is the number specified (default: 1000)

#### Run the test

With default configuration:

```sh
tsc --project tsconfig.dev.json \
&& node --expose-gc --max-old-space-size=256 \
build/benchmarks/leaks/memory_leak_random_integers.js
```

With custom configuration via env variables:

```sh
tsc --project tsconfig.dev.json \
&& BATCH_SIZE=100000000 ITERATIONS=1000 LOG_INTERVAL=100 \
node --expose-gc --max-old-space-size=256 \
build/benchmarks/leaks/memory_leak_random_integers.js
```

## Random arrays and maps insertion (no streaming)

This test does not use any streaming and supposed to do a lot of allocations and de-allocations.

Configuration is the same as the previous test, but with different default values as it is much slower due to the random data generation for the entire batch in advance, using arrays of strings and maps of arrays of strings:

- `BATCH_SIZE` - number of random rows within one stream before sending it to ClickHouse (default: 1000)
- `ITERATIONS` - number of streams (batches) to be sent to ClickHouse (default: 1000)
- `LOG_INTERVAL` - memory usage will be logged every Nth iteration, where N is the number specified (default: 100)

#### Run the test

With default configuration:

```sh
tsc --project tsconfig.dev.json \
&& node --expose-gc --max-old-space-size=256 \
build/benchmarks/leaks/memory_leak_arrays.js
```

With custom configuration via env variables and different max heap size:

```sh
tsc --project tsconfig.dev.json \
&& BATCH_SIZE=10000 ITERATIONS=1000 LOG_INTERVAL=100 \
node --expose-gc --max-old-space-size=1024 \
build/benchmarks/leaks/memory_leak_arrays.js
```