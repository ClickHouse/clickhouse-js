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
  'ci.workflow': process.env.GITHUB_WORKFLOW,
  'test.platform': 'node',
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

// Wrap shutdown/forceFlush to gracefully handle unavailable OTEL endpoints
// (e.g. when OTEL_EXPORTER_OTLP_ENDPOINT is not set in the environment)
// Without this, vitest 4.1+ would propagate the ECONNREFUSED teardown error
// and report the test run as failed even if all tests passed.
export default new Proxy(sdk, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver)
    if ((prop === 'shutdown' || prop === 'forceFlush') && typeof value === 'function') {
      return async (...args) => {
        try {
          await value.apply(target, args)
        } catch (e) {
          console.warn(`[OTEL] SDK ${String(prop)} error (endpoint may not be available):`, e.message)
        }
      }
    }
    return value
  },
})

console.log('OTEL for Vitest initialized')
