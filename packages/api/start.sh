#!/bin/sh
set -e

echo "Pushing schema to database..."
npx drizzle-kit push

echo "Starting SwarmRelay API..."
node dist/index.js
