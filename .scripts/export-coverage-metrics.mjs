#!/usr/bin/env node
/**
 * Script to read Vitest code coverage and export metrics as OpenTelemetry gauges.
 *
 * Usage: node export-coverage-metrics.js [coverage-file]
 *
 * Run locally:
 *   GITHUB_SHA=abc123 GITHUB_RUN_ID=12345 GITHUB_JOB_NAME=test node export-coverage-metrics.js
 *
 * Reads lcov.info format and exports metrics for:
 * - Line coverage percentage per file
 * - Function coverage percentage per file
 * - Branch coverage percentage per file
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

// Parse lcov.info file format
function parseLcov(content) {
  const files = []
  let currentFile = null

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    if (trimmed.startsWith('SF:')) {
      // Source File - start of a new file entry
      currentFile = {
        path: trimmed.substring(3),
        linesFound: 0,
        linesHit: 0,
        functionsFound: 0,
        functionsHit: 0,
        branchesFound: 0,
        branchesHit: 0,
      }
    } else if (trimmed.startsWith('LF:')) {
      // Lines Found
      currentFile.linesFound = parseInt(trimmed.substring(3), 10)
    } else if (trimmed.startsWith('LH:')) {
      // Lines Hit
      currentFile.linesHit = parseInt(trimmed.substring(3), 10)
    } else if (trimmed.startsWith('FNF:')) {
      // Functions Found
      currentFile.functionsFound = parseInt(trimmed.substring(4), 10)
    } else if (trimmed.startsWith('FNH:')) {
      // Functions Hit
      currentFile.functionsHit = parseInt(trimmed.substring(4), 10)
    } else if (trimmed.startsWith('BRF:')) {
      // Branches Found
      currentFile.branchesFound = parseInt(trimmed.substring(4), 10)
    } else if (trimmed.startsWith('BRH:')) {
      // Branches Hit
      currentFile.branchesHit = parseInt(trimmed.substring(4), 10)
    } else if (trimmed === 'end_of_record') {
      // End of current file record
      if (currentFile) {
        files.push(currentFile)
        currentFile = null
      }
    }
  }

  return files
}

// Calculate coverage percentage
function calculatePercentage(hit, found) {
  if (found === 0) return 100 // No code to cover = 100%
  return (hit / found) * 100
}

// Main function
async function exportCoverageMetrics() {
  // Get coverage file path from args or use default
  const coverageFile =
    process.argv[2] || join(process.cwd(), 'coverage', 'lcov.info')

  console.log(`Reading coverage from: ${coverageFile}`)

  // Read and parse coverage file
  let content
  try {
    content = readFileSync(coverageFile, 'utf-8')
  } catch (error) {
    console.error(`Error reading coverage file: ${error.message}`)
    process.exit(1)
  }

  const files = parseLcov(content)
  console.log(`Parsed coverage for ${files.length} files`)

  // Log coverage summary
  console.log('\nCoverage Summary:')
  console.log('=================')

  let totalLines = 0,
    totalLinesHit = 0
  let totalFunctions = 0,
    totalFunctionsHit = 0
  let totalBranches = 0,
    totalBranchesHit = 0

  files.forEach((file) => {
    totalLines += file.linesFound
    totalLinesHit += file.linesHit
    totalFunctions += file.functionsFound
    totalFunctionsHit += file.functionsHit
    totalBranches += file.branchesFound
    totalBranchesHit += file.branchesHit
  })

  console.log(
    `Total Line Coverage: ${calculatePercentage(totalLinesHit, totalLines).toFixed(2)}%`,
  )
  console.log(
    `Total Function Coverage: ${calculatePercentage(totalFunctionsHit, totalFunctions).toFixed(2)}%`,
  )
  console.log(
    `Total Branch Coverage: ${calculatePercentage(totalBranchesHit, totalBranches).toFixed(2)}%`,
  )

  // Setup OpenTelemetry
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'clickhouse-js-coverage',
    [ATTR_SERVICE_VERSION]:
      process.env.GITHUB_SHA?.substring(0, 7) || 'unknown',
    'ci.run.id': process.env.GITHUB_RUN_ID || 'local',
    'ci.job.name': process.env.GITHUB_JOB_NAME || 'coverage-export',
  })

  const metricExporter = new OTLPMetricExporter()
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 1000, // Exports immediately below
  })

  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  })

  const meter = meterProvider.getMeter('coverage-exporter', '1.0.0')

  // Create observable gauges for each metric type
  const lineCoverageGauge = meter.createObservableGauge(
    'code.coverage.line.percentage',
    {
      description: 'Line coverage percentage per file',
      unit: '%',
    },
  )

  const functionCoverageGauge = meter.createObservableGauge(
    'code.coverage.function.percentage',
    {
      description: 'Function coverage percentage per file',
      unit: '%',
    },
  )

  const branchCoverageGauge = meter.createObservableGauge(
    'code.coverage.branch.percentage',
    {
      description: 'Branch coverage percentage per file',
      unit: '%',
    },
  )

  const totalLinesGauge = meter.createObservableGauge(
    'code.coverage.line.total',
    {
      description: 'Total lines per file',
      unit: 'lines',
    },
  )

  const coveredLinesGauge = meter.createObservableGauge(
    'code.coverage.line.covered',
    {
      description: 'Covered lines per file',
      unit: 'lines',
    },
  )

  const totalLinesCoverageGauge = meter.createObservableGauge(
    'code.coverage.line.total.percentage',
    {
      description: 'Total line coverage percentage',
      unit: '%',
    },
  )

  const totalFunctionsCoverageGauge = meter.createObservableGauge(
    'code.coverage.function.total.percentage',
    {
      description: 'Total function coverage percentage',
      unit: '%',
    },
  )

  const totalBranchesCoverageGauge = meter.createObservableGauge(
    'code.coverage.branch.total.percentage',
    {
      description: 'Total branch coverage percentage',
      unit: '%',
    },
  )

  const totalFileCountGauge = meter.createObservableGauge(
    'code.coverage.file.count',
    {
      description: 'Total number of files covered',
      unit: 'files',
    },
  )

  // Register callbacks to observe metrics
  lineCoverageGauge.addCallback((observableResult) => {
    files.forEach((file) => {
      const percentage = calculatePercentage(file.linesHit, file.linesFound)
      observableResult.observe(percentage, { file: file.path })
    })
  })

  functionCoverageGauge.addCallback((observableResult) => {
    files.forEach((file) => {
      const percentage = calculatePercentage(
        file.functionsHit,
        file.functionsFound,
      )
      observableResult.observe(percentage, { file: file.path })
    })
  })

  branchCoverageGauge.addCallback((observableResult) => {
    files.forEach((file) => {
      const percentage = calculatePercentage(
        file.branchesHit,
        file.branchesFound,
      )
      observableResult.observe(percentage, { file: file.path })
    })
  })

  totalLinesGauge.addCallback((observableResult) => {
    files.forEach((file) => {
      observableResult.observe(file.linesFound, { file: file.path })
    })
  })

  coveredLinesGauge.addCallback((observableResult) => {
    files.forEach((file) => {
      observableResult.observe(file.linesHit, { file: file.path })
    })
  })

  totalLinesCoverageGauge.addCallback((observableResult) => {
    const totalPercentage = calculatePercentage(totalLinesHit, totalLines)
    observableResult.observe(totalPercentage, {})
  })

  totalFunctionsCoverageGauge.addCallback((observableResult) => {
    const totalPercentage = calculatePercentage(
      totalFunctionsHit,
      totalFunctions,
    )
    observableResult.observe(totalPercentage, {})
  })

  totalBranchesCoverageGauge.addCallback((observableResult) => {
    const totalPercentage = calculatePercentage(totalBranchesHit, totalBranches)
    observableResult.observe(totalPercentage, {})
  })

  totalFileCountGauge.addCallback((observableResult) => {
    observableResult.observe(files.length, {})
  })

  metricReader.collect() // Trigger immediate collection of metrics

  // Force metrics export
  console.log('\nExporting metrics to OpenTelemetry collector...')
  await metricReader.forceFlush()

  console.log('Metrics exported successfully!')

  // Shutdown
  await meterProvider.shutdown()
  process.exit(0)
}

// Run the script
exportCoverageMetrics().catch(async (error) => {
  console.error('Error exporting coverage metrics:', error)
  process.exit(1)
})
