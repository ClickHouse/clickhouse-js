# Strategy Analysis: Moving Away from Shared `client-common` Package

## Executive Summary

This document analyzes the current architecture of the clickhouse-js monorepo and provides strategic options for eliminating the shared `@clickhouse/client-common` package dependency. After thorough analysis of the codebase, three viable strategies are presented with detailed pros and cons for each approach.

## Current Architecture Overview

### Package Structure

The repository consists of three packages in a clean monorepo structure:

```
packages/
├── client-common/     (~1,338 LOC, 320KB source, 24 files)
│   └── Core types, base client, interfaces
├── client-node/       (~1,863 LOC, 136KB source, 19 files)
│   └── Node.js implementation + dependency on client-common
└── client-web/        (~405 LOC, 64KB source, 10 files)
    └── Web/Browser implementation + dependency on client-common
```

**Total codebase:** ~3,606 lines of code across 53 files

### Dependency Graph

The current architecture has a **clean, unidirectional dependency flow** with no circular dependencies:

```
client-common (0 dependencies)
  ↑           ↑
  |           |
  |           └─────── client-node
  |
  └─────── client-web
```

- `client-common` has **zero dependencies** on other packages
- `client-node` depends only on `client-common` (v1.18.2)
- `client-web` depends only on `client-common` (v1.18.2)
- No circular dependencies or cross-dependencies between client-node and client-web

### What `client-common` Contains

The `client-common` package serves as the foundation and contains:

1. **Core Client Implementation** (`client.ts`, 16.9 KB)
   - Base `ClickHouseClient<Stream>` class with all query operations
   - Methods: `query()`, `insert()`, `exec()`, `command()`, `ping()`, `close()`
   - Generic stream handling abstraction

2. **Type System** (multiple files)
   - All shared TypeScript interfaces and types
   - `DataFormat`, `QueryParams`, `InsertValues`, `ResponseJSON`, etc.
   - Complex type-safe format handling with conditional types

3. **Configuration Management** (`config.ts`, 18.8 KB)
   - `BaseClickHouseClientConfigOptions` interface
   - `ImplementationDetails<Stream>` interface (the strategy pattern contract)
   - URL parsing and configuration validation
   - Default configuration values

4. **Connection Abstraction** (`connection.ts`, 2.7 KB)
   - Abstract `Connection<Stream>` interface
   - `ConnectionParams` type definitions
   - Connection lifecycle contracts

5. **Result Set Interface** (`result.ts`)
   - `BaseResultSet<Stream, Format>` with complex type-safe format handling
   - Format-specific method availability (e.g., `.json()` only for JSON formats)

6. **Data Formatting** (`data_formatter/` directory)
   - Query parameter formatting and encoding
   - ClickHouse settings serialization
   - SQL value escaping and formatting

7. **Error Handling** (`error/` directory)
   - `ClickHouseError` class
   - Error parsing utilities
   - HTTP status code handling

8. **Parsing Utilities** (`parse/` directory)
   - JSON handling strategies
   - Column type parsing
   - Progress row detection

9. **Logging Infrastructure** (`logger.ts`)
   - `DefaultLogger` class
   - `LogWriter` interface
   - `ClickHouseLogLevel` enum and level management

10. **Settings Catalog** (`settings.ts`, 153 KB!)
    - Comprehensive ClickHouse settings definitions
    - Type-safe settings interface with 700+ settings
    - This single file is **half the size** of client-common

11. **Utilities** (`utils/` directory)
    - URL manipulation helpers
    - Stream utilities
    - Sleep/delay utilities
    - Connection helpers

### Architecture Pattern: Strategy Pattern with Dependency Injection

The codebase uses a clean **Strategy Pattern** where `client-common` defines contracts and `client-node`/`client-web` provide implementations:

```typescript
// client-common defines the contract
export interface ImplementationDetails<Stream> {
  impl: {
    make_connection: MakeConnection<Stream>
    make_result_set: MakeResultSet<Stream>
    values_encoder: MakeValuesEncoder<Stream>
    handle_specific_url_params?: HandleImplSpecificURLParams
  }
}

// Each implementation provides its strategy
const NodeConfigImpl: ImplementationDetails<Stream.Readable> = {
  make_connection: (config, params) => new NodeConnection(...),
  make_result_set: (stream, format, ...) => new ResultSet(...),
  values_encoder: (jsonHandling) => new NodeValuesEncoder(...),
  handle_specific_url_params: (config, url) => { /* Node-specific URL params */ }
}

// Client instantiation with dependency injection
new ClickHouseClient<Stream.Readable>({
  impl: NodeConfigImpl,
  ...config
})
```

### Code Sharing Analysis

**What is currently shared (in client-common):**
- 70% of total codebase logic
- All type definitions
- Core client query/insert/exec logic
- Configuration parsing
- Error handling
- Data formatting
- Logging infrastructure

**What is platform-specific:**
- 30% of total codebase logic
- HTTP/HTTPS implementation (Node vs Fetch API)
- Stream handling (Node Readable vs Web ReadableStream)
- Compression (Node zlib vs browser automatic)
- TLS configuration (Node-specific)
- Connection implementations

**Code duplication if common-client is removed:**
- Estimated 70-80% of code would need to be duplicated
- ~1,338 lines × 2 = ~2,676 lines duplicated
- Most duplication in types, core logic, configuration, settings

---

## Strategy Options

Three viable strategies are presented below, ranked from most recommended to least recommended.

---

## Strategy 1: Embed `client-common` Code via Build-Time Copying

### Description

Copy the `client-common` source code into `client-node` and `client-web` packages at build time, eliminating the need for a separate published package while maintaining a single source of truth.

### Implementation Approach

1. Keep `client-common` as a directory in the monorepo (unpublished)
2. Add a pre-build script that copies `client-common/src` to `client-node/src/common` and `client-web/src/common`
3. Update imports in client-node and client-web to use relative paths instead of `@clickhouse/client-common`
4. Build each package with the embedded common code
5. Publish only `@clickhouse/client` and `@clickhouse/client-web`

**Directory structure:**
```
packages/
├── client-common/           (unpublished, source of truth)
│   └── src/
├── client-node/
│   └── src/
│       ├── common/          (copied at build time)
│       └── [node-specific files]
└── client-web/
    └── src/
        ├── common/          (copied at build time)
        └── [web-specific files]
```

**Build script example:**
```bash
#!/bin/bash
# pre-build.sh

# Copy common code to client-node
rm -rf packages/client-node/src/common
cp -r packages/client-common/src packages/client-node/src/common

# Copy common code to client-web
rm -rf packages/client-web/src/common
cp -r packages/client-common/src packages/client-web/src/common
```

**Import changes:**
```typescript
// Before
import { ClickHouseClient } from '@clickhouse/client-common'

// After
import { ClickHouseClient } from './common'
```

### Pros

✅ **Single source of truth** - Common code lives in one place, no duplication in version control

✅ **No dependency management** - Eliminates the need to manage @clickhouse/client-common dependency versions

✅ **Simpler versioning** - Only two packages to version and publish instead of three

✅ **Simpler for users** - Users only see and install `@clickhouse/client` or `@clickhouse/client-web`, not both packages

✅ **Clean published packages** - Each published package is self-contained with no external dependencies

✅ **Maintains monorepo benefits** - Still a monorepo for development, testing, and CI

✅ **Easy to implement** - Simple build script, minimal changes to source code

✅ **Backward compatible publishing** - Can continue publishing client-common for a deprecation period

✅ **No symlink issues** - Works across all platforms (Windows, Linux, macOS) and CI environments

✅ **Bundle size unchanged** - Final bundle size is identical to current approach

### Cons

❌ **Build complexity** - Adds a pre-build step that must run before compilation

❌ **IDE may show duplicates** - Code appears in multiple places, though only edited in one

❌ **Git status noise** - Copied files appear in git status (mitigated with .gitignore)

❌ **Build artifacts in source** - Common code in client-node/client-web are build artifacts

❌ **Import path changes required** - All imports need to be updated from `@clickhouse/client-common` to relative paths

❌ **Risk of manual edits** - Developers might accidentally edit copied code instead of source

❌ **Watch mode complexity** - Dev watch mode needs to re-copy on common code changes

❌ **Slightly longer build times** - Extra file copying step before compilation

### Implementation Checklist

1. Update `.gitignore` to exclude `packages/client-node/src/common` and `packages/client-web/src/common`
2. Create `scripts/copy-common.sh` build script
3. Update `package.json` build scripts to run copy script first
4. Update all imports in client-node and client-web from `@clickhouse/client-common` to `./common` or `../common`
5. Update TypeScript configuration if needed for path resolution
6. Test builds and ensure no import errors
7. Update CI/CD pipeline to handle the new build process
8. Update documentation about the new structure
9. (Optional) Keep publishing `@clickhouse/client-common` for a deprecation period with a note

### Effort Estimate

**Medium** - Requires build script changes and import path updates across both packages

- Build script: 1-2 hours
- Import updates: 2-3 hours
- Testing: 2-3 hours
- Documentation: 1 hour

**Total: ~1-2 days**

---

## Strategy 2: Use TypeScript Project References with `composite: true`

### Description

Use TypeScript's Project References feature to keep packages separate during development but emit declarations and bundle code together during build, eliminating runtime dependency while maintaining development-time separation.

### Implementation Approach

1. Keep all three packages as separate TypeScript projects
2. Configure `client-common` with `composite: true` and `declaration: true`
3. Configure `client-node` and `client-web` with project references to `client-common`
4. At build time, use a bundler (esbuild, rollup, or tsc with custom script) to inline the common code
5. Publish self-contained bundles with no external dependencies

**TypeScript configuration:**
```json
// packages/client-common/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true
  }
}

// packages/client-node/tsconfig.json
{
  "compilerOptions": {
    "composite": true
  },
  "references": [
    { "path": "../client-common" }
  ]
}
```

**Build approach options:**

**Option A: Bundle with esbuild/rollup**
```javascript
// Build script to bundle everything together
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  packages: 'external',  // Externalize npm packages
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/index.js',
  // client-common will be inlined
})
```

**Option B: TypeScript with custom emit**
- Use tsc with project references for type checking
- Use a custom script to merge compiled outputs
- Rewrite import statements in emitted .js files

### Pros

✅ **Clean development experience** - Packages remain separate during development

✅ **Type checking benefits** - TypeScript project references provide incremental builds

✅ **No manual build scripts** - Relies on standard TypeScript tooling

✅ **Source code unchanged** - No need to change import paths during development

✅ **Strong typing** - Full TypeScript benefits with proper project references

✅ **IDE support** - Modern IDEs understand TypeScript project references

✅ **Incremental compilation** - TypeScript can build only changed projects

✅ **Clean git history** - No build artifacts in version control

### Cons

❌ **Complex build setup** - Requires bundler configuration or custom build scripts

❌ **Bundler dependency** - Need to add esbuild, rollup, or webpack to the project

❌ **TypeScript limitations** - Project references have some quirks and limitations

❌ **Build time increase** - Bundling step adds time to build process

❌ **Dual build system** - Need tsc for types + bundler for code, or complex tsc setup

❌ **Declaration file complexity** - May need to generate merged .d.ts files

❌ **Debugging harder** - Source maps become more important when code is bundled

❌ **Less transparent** - Build output is transformed, harder to verify

❌ **May affect tree-shaking** - Depending on bundler configuration

❌ **Potential for size increase** - If bundler doesn't properly remove unused code

### Implementation Checklist

1. Update all `tsconfig.json` files with `composite: true` and references
2. Choose and configure bundler (esbuild recommended for speed)
3. Create build scripts for each package that bundle code
4. Update package.json scripts to use new build process
5. Configure source maps for debugging
6. Update declaration file generation strategy
7. Test that all types are correctly exported
8. Verify bundle size hasn't increased
9. Update CI/CD pipeline
10. Document the new build process

### Effort Estimate

**High** - Requires significant build tooling changes and testing

- TypeScript config: 2-3 hours
- Bundler setup: 4-6 hours
- Declaration file handling: 2-4 hours
- Testing and debugging: 4-6 hours
- Documentation: 2 hours

**Total: ~2-4 days**

---

## Strategy 3: Full Duplication (Copy-Paste Common Code)

### Description

Completely duplicate all `client-common` code into both `client-node` and `client-web` packages, eliminating the shared package entirely. Each package becomes fully independent with its own copy of all shared code.

### Implementation Approach

1. Copy all files from `client-common/src` into `client-node/src/common`
2. Copy all files from `client-common/src` into `client-web/src/common`
3. Update all imports to use relative paths
4. Delete the `client-common` package
5. Maintain both copies independently going forward

**Directory structure:**
```
packages/
├── client-node/
│   └── src/
│       ├── common/          (copy of client-common, maintained independently)
│       │   ├── client.ts
│       │   ├── config.ts
│       │   ├── settings.ts
│       │   └── [all other common files]
│       └── [node-specific files]
└── client-web/
    └── src/
        ├── common/          (copy of client-common, maintained independently)
        │   ├── client.ts
        │   ├── config.ts
        │   ├── settings.ts
        │   └── [all other common files]
        └── [web-specific files]
```

### Pros

✅ **Simplest architecture** - No shared packages, no build scripts, no complexity

✅ **Full independence** - Each package can evolve independently without coordination

✅ **No build-time magic** - What you see is what you get

✅ **Platform-specific optimizations** - Each package can optimize for its platform

✅ **Fast builds** - No extra build steps, just compile TypeScript

✅ **Easy to understand** - Simple folder structure, obvious where code lives

✅ **No dependency version coordination** - Each package versions itself

✅ **Allows divergence** - Node and Web versions can diverge if needed

### Cons

❌ **~1,338 lines duplicated** - Significant code duplication across packages

❌ **Maintenance burden** - Bug fixes must be applied in two places

❌ **Consistency risk** - Implementations can drift apart over time

❌ **Higher test burden** - Same code must be tested twice

❌ **Larger repository** - Total codebase grows from ~3,600 to ~4,900 lines

❌ **Feature parity challenges** - New features must be implemented twice

❌ **Documentation duplication** - Internal docs and comments duplicated

❌ **Refactoring is harder** - Changes must be coordinated across both packages

❌ **Version skew risk** - Node and Web versions might have different bugs fixed

❌ **Settings file duplication** - The 153KB `settings.ts` duplicated

❌ **Type duplication** - Shared types must be kept in sync manually

❌ **No single source of truth** - Common code exists in two places

❌ **Git merge conflicts** - Higher chance of conflicts when both copies are modified

❌ **Code review overhead** - Reviewers must check both copies for changes

### Implementation Checklist

1. Copy `client-common/src/*` to `client-node/src/common/`
2. Copy `client-common/src/*` to `client-web/src/common/`
3. Update all imports in client-node from `@clickhouse/client-common` to `./common/*`
4. Update all imports in client-web from `@clickhouse/client-common` to `./common/*`
5. Remove `client-common` from dependencies in both package.json files
6. Delete the `client-common` package directory
7. Update build scripts to remove client-common build
8. Update CI/CD to remove client-common from pipeline
9. Test both packages thoroughly
10. Document maintenance procedures for keeping both copies in sync

### Effort Estimate

**Low-Medium** - Straightforward copying but extensive import updates

- Copy files: 30 minutes
- Update imports: 3-4 hours
- Testing: 2-3 hours
- Documentation: 1-2 hours

**Total: ~1 day**

**Long-term cost:** High - Ongoing maintenance burden

---

## Strategy Comparison Matrix

| Criteria | Strategy 1: Build-Time Copy | Strategy 2: Project References + Bundle | Strategy 3: Full Duplication |
|----------|----------------------------|----------------------------------------|----------------------------|
| **Code Duplication in Git** | None | None | ~1,338 lines × 2 |
| **Build Complexity** | Medium (copy script) | High (bundler setup) | Low (just tsc) |
| **Maintenance Burden** | Low | Low | High (sync two copies) |
| **Development Experience** | Good | Excellent | Good |
| **Build Time** | Fast (+copy time) | Slower (bundling) | Fastest |
| **Risk of Divergence** | Low | Low | High |
| **Implementation Effort** | Medium (1-2 days) | High (2-4 days) | Low (1 day) |
| **Long-term Cost** | Low | Low | High |
| **Bundle Size** | Same as now | Same as now | Same as now |
| **Type Safety** | Excellent | Excellent | Excellent |
| **Debugging** | Easy | Harder (bundled) | Easiest |
| **CI/CD Changes** | Minor | Moderate | Minimal |
| **Backward Compatibility** | Possible | Possible | Difficult |
| **Single Source of Truth** | ✅ Yes | ✅ Yes | ❌ No |

---

## Recommendation

### Primary Recommendation: **Strategy 1 - Build-Time Copying**

Strategy 1 (Build-Time Copying) is the recommended approach because it:

1. **Eliminates the shared package** as requested
2. **Maintains single source of truth** - no code duplication in version control
3. **Low maintenance burden** - changes only need to be made once
4. **Simple to implement** - straightforward build script, ~1-2 days of work
5. **Clean for end users** - they only install one package with no dependencies
6. **Works everywhere** - no platform-specific issues (unlike symlinks)
7. **Backward compatible** - can continue publishing client-common temporarily

**The main tradeoff** is adding a build-time copy step, but this is a minor complexity compared to the benefits of maintaining a single source of truth.

### Secondary Recommendation: **Strategy 2 - Project References + Bundling**

Strategy 2 is a good alternative if:
- You want the cleanest development experience
- You're comfortable with bundler complexity
- You have time for more complex setup (2-4 days)
- You want incremental TypeScript compilation benefits

### Not Recommended: **Strategy 3 - Full Duplication**

Strategy 3 should only be considered if:
- You expect Node and Web versions to significantly diverge
- You're willing to accept long-term maintenance burden
- You want the absolute simplest build process

However, given the current architecture where 70% of code is shared and the codebase follows consistent patterns, **full duplication would create significant ongoing maintenance costs** without proportional benefits.

---

## Additional Considerations

### Migration Path

Regardless of which strategy is chosen, consider this migration path:

1. **Phase 1:** Implement the chosen strategy internally
2. **Phase 2:** Continue publishing `@clickhouse/client-common` with deprecation notice for 3-6 months
3. **Phase 3:** Remove `client-common` from published packages, keeping only internal

This provides backward compatibility for users who might have direct dependencies on `client-common`.

### Testing Strategy

After migration, ensure:
- All existing tests pass for both packages
- Integration tests verify client-node and client-web work independently
- Bundle size hasn't increased unexpectedly
- Type definitions are correctly exported
- Documentation is updated

### Future Considerations

If the codebase continues to grow and you have 3+ platform implementations:

- Consider creating a code generator that generates platform-specific code from common templates
- Consider a plugin architecture where common code loads platform-specific plugins
- Re-evaluate if a shared package might be the right choice again

---

## Conclusion

The current architecture with `client-common` as a shared package is actually **well-designed** with clean separation of concerns, no circular dependencies, and a clear strategy pattern. However, if eliminating the shared package is required, **Strategy 1 (Build-Time Copying)** provides the best balance of:

- Eliminating the published dependency
- Maintaining single source of truth
- Manageable implementation effort
- Low long-term maintenance cost

The implementation can be completed in 1-2 days with minimal disruption to the existing codebase structure and testing infrastructure.
