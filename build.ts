#!/usr/bin/env bun
/**
 * Self-contained build script for ElizaOS plugins
 */

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { $ } from 'bun';

async function cleanBuild(outdir = 'dist') {
  if (existsSync(outdir)) {
    await rm(outdir, { recursive: true, force: true });
    console.log(`✓ Cleaned ${outdir} directory`);
  }
}

async function build() {
  const start = performance.now();
  console.log('🚀 Building plugin...');

  try {
    // Clean previous build
    await cleanBuild('dist');

    // Run JavaScript build and TypeScript declarations in parallel
    console.log('Starting build tasks...');

    const [buildResult, tscResult] = await Promise.all([
      // Task 1: Build with Bun
      (async () => {
        console.log('📦 Bundling with Bun...');
        const result = await Bun.build({
          entrypoints: ['./src/index.ts'],
          outdir: './dist',
          target: 'node',
          format: 'esm',
          sourcemap: true,
          minify: false,
          // Externalize all runtime deps — consumers install them (declared in
          // package.json dependencies/peerDependencies). Keeps the published
          // dist tiny instead of bundling @solana/web3.js's ~3MB tree.
          external: [
            'dotenv',
            'node:*',
            '@elizaos/core',
            '@elizaos/cli',
            'zod',
            '@solana/web3.js',
            'tweetnacl',
            'bs58',
          ],
          naming: {
            entry: '[dir]/[name].[ext]',
          },
        });

        if (!result.success) {
          console.error('✗ Build failed:', result.logs);
          return { success: false, outputs: [] };
        }

        const totalSize = result.outputs.reduce((sum, output) => sum + output.size, 0);
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        console.log(`✓ Built ${result.outputs.length} file(s) - ${sizeMB}MB`);

        return result;
      })(),

      // Task 2: Generate TypeScript declarations.
      // Invoke the REAL local compiler explicitly (node typescript/bin/tsc) —
      // a bare `tsc` resolves to bun's bunx shim, which fetched a squatter "tsc"
      // package that prints a message and exits 0, emitting nothing.
      (async () => {
        console.log('📝 Generating TypeScript declarations...');
        try {
          await $`node ./node_modules/typescript/bin/tsc --emitDeclarationOnly --project ./tsconfig.build.json`;
          // Verify the entry declaration actually emitted (a 0-exit no-op must
          // not pass for "success" — that was the silent Checkpoint-G failure).
          if (!existsSync('dist/index.d.ts')) {
            console.error('✗ tsc exited 0 but dist/index.d.ts was not emitted.');
            return { success: false };
          }
          console.log('✓ TypeScript declarations generated');
          return { success: true };
        } catch (error) {
          console.error('✗ Failed to generate TypeScript declarations:', error instanceof Error ? error.message : error);
          return { success: false };
        }
      })(),
    ]);

    // Fail hard if EITHER the JS bundle OR the declaration emit failed — a
    // broken/missing dist/index.d.ts must never publish silently (Catch #25).
    if (!buildResult.success || !tscResult.success) {
      return false;
    }

    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    console.log(`✅ Build complete! (${elapsed}s)`);
    return true;
  } catch (error) {
    console.error('Build error:', error);
    return false;
  }
}

// Execute the build
build()
  .then((success) => {
    if (!success) {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Build script error:', error);
    process.exit(1);
  });
