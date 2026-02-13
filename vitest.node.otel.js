// https://vitest.dev/guide/open-telemetry
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { NodeSDK, resources, logs } from '@opentelemetry/sdk-node'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

console.log('Initializing OTEL for Vitest...')

const resource = resourceFromAttributes({
  [ATTR_SERVICE_VERSION]: process.env.GITHUB_SHA?.substring(0, 7),
  'ci.run.id': process.env.GITHUB_RUN_ID,
  'ci.job.name': process.env.GITHUB_JOB_NAME,
  'load_test.environment': process.env.OPENAPI_LOAD_TEST_ENVIRONMENT,
})

const sdk = new NodeSDK({
  resource,
  resourceDetectors: [resources.envDetector, resources.processDetector],
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
  logRecordProcessors: [
    new logs.SimpleLogRecordProcessor(new logs.ConsoleLogRecordExporter()),
    new logs.BatchLogRecordProcessor(new OTLPLogExporter()),
  ],
})

sdk.start()
export default sdk

console.log('OTEL for Vitest initialized')
