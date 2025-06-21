# Migration from Irys/Bundlr to ArDrive Turbo SDK

This document outlines the migration from the deprecated Irys/Bundlr libraries to the ArDrive Turbo SDK for Arweave publishing functionality.

## Background

The Irys network has deprecated their Arweave support, and the `@irys/sdk` and `@bundlr-network/client` packages are no longer maintained for Arweave transactions. ArDrive's Turbo SDK provides a direct replacement with improved reliability and features.

## Changes Made

### Package Dependencies

**Removed:**
- `@bundlr-network/client: ^0.11.17`
- `@irys/query: 0.0.6`
- `@irys/sdk: 0.1.21`

**Kept:**
- `@ardrive/turbo-sdk: ^1.22.1` (already present)

### Code Changes

#### 1. `helpers/utils.js`
- Replaced `getIrysArweave()` function with `getTurboArweave()`
- Updated imports to use `TurboFactory` from `@ardrive/turbo-sdk`
- Function now returns authenticated Turbo client instead of Irys client

#### 2. `helpers/arweave.js`
- Updated `getTransaction()` to use native Arweave client instead of Bundlr endpoints
- Modified `checkBalance()` to use Turbo SDK balance methods
- Updated `getBlockHeightFromTxId()` to query Arweave directly (no more Bundlr intermediate step)
- Replaced `upfrontFunding()` and `lazyFunding()` to use Turbo SDK's `topUpWithTokens()` method

#### 3. `helpers/templateHelper.js`
- Updated import to use `getTurboArweave` instead of `getIrysArweave`
- Replaced `irys.upload()` calls with `turbo.upload()` using proper Turbo SDK format
- Updated all file upload operations to use new Turbo SDK data item format

#### 4. `helpers/publisher-manager.js`
- Updated import to use `getTurboArweave` instead of `getIrysArweave`
- Replaced Irys upload methods with Turbo SDK equivalents
- Updated balance, funding, and pricing methods to use Turbo SDK APIs
- Maintained compatibility for both Arweave and Irys publishing options

### Docker Configuration

#### 5. `docker-compose.yml`
- Added volume mounts for development:
  - `./config:/usr/src/app/config`
  - `./helpers:/usr/src/app/helpers`
  - `./routes:/usr/src/app/routes`
- Applied to `oip`, `oip-full`, and `oip-gpu` services
- Allows live code changes without container rebuilds during development

### Documentation Updates

#### 6. `readme.md`
- Updated references from "Turbo SDK" to "ArDrive Turbo SDK" for clarity
- Removed `TURBO_URL` environment variable (SDK uses defaults)
- Updated feature descriptions to reflect new implementation

## API Compatibility

The migration maintains full API compatibility. All existing endpoints and request/response formats remain unchanged. The only differences are:

1. **Improved Error Handling**: Turbo SDK provides better error messages and retry logic
2. **Enhanced Performance**: Direct Arweave integration eliminates Bundlr intermediary steps
3. **Better Balance Reporting**: More accurate balance and cost calculations

## Environment Variables

### Removed
- `TURBO_URL` - No longer needed (SDK uses default endpoints)

### Still Required
- `WALLET_FILE` - Arweave wallet file path (unchanged)

## Testing

The migration has been designed to be a drop-in replacement. All existing functionality should work without changes:

1. **Record Publishing**: Both Arweave and Irys publishing endpoints work as before
2. **Media Upload**: Multi-network storage functionality preserved
3. **Balance Checking**: Wallet balance queries work as expected
4. **Funding Operations**: Lazy and upfront funding methods maintained

## Benefits of Migration

1. **Future-Proof**: ArDrive Turbo SDK is actively maintained and supported
2. **Better Performance**: Direct Arweave integration without intermediary services
3. **Improved Reliability**: More robust error handling and retry mechanisms
4. **Enhanced Features**: Access to latest Arweave ecosystem improvements
5. **Cost Optimization**: Better pricing calculations and funding strategies

## Rollback Plan

If issues arise, rollback can be performed by:

1. Reverting `package.json` to include old dependencies
2. Restoring original helper files from git history
3. Running `npm install` to reinstall old packages

However, this is not recommended as the old libraries are deprecated and may stop working entirely. 