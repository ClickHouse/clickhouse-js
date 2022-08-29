# Memory leaks tests

---

The goal is to determine whether we have any memory leaks in the client implementation. 
For that, we can have various tests with periodical memory usage logging such as random data or predefined file streaming.

NB: we supposedly avoid using `ts-node` as it adds some runtime overhead.

## Brown university benchmark file loading

---

See `memory_leak_brown.ts`. 
You will need to prepare the input data and have a local ClickHouse instance running 
(just use `docker-compose.yml` from the root).

All commands assume that you are in the root project directory.

#### Start docker container

```sh
docker-compose up -d
```

#### Prepare input data

```sh
mkdir -p benchmarks/leaks/input \
&& wget https://datasets.clickhouse.com/mgbench1.csv.xz \
&& xz -v -d mgbench1.csv.xz \
&& mv mgbench1.csv benchmarks/leaks/input \
&& rm mgbench1.csv.xz
```

See [official examples](https://clickhouse.com/docs/en/getting-started/example-datasets/brown-benchmark/) for more information.

#### Run the test

```sh
tsc --project benchmarks/tsconfig.benchmarks.json \
&& node --expose-gc benchmarks/build/benchmarks/leaks/memory_leak_brown.js
```


## Random data streaming test

---

