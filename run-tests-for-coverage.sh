#!/bin/bash
# explicitly set CI env variable to make sure Vitest exits locally too
# as this script is not meant for the watch mode.
export CI=true

npm run test:common:unit
npm run test:common:integration
npm run test:node:unit
npm run test:node:integration
npm run test:node:tls
