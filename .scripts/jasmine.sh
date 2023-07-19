#!/bin/bash
ts-node -r tsconfig-paths/register --project=tsconfig.dev.json node_modules/jasmine/bin/jasmine --config=$1
