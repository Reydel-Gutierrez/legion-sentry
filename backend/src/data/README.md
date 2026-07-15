# Legion Sentry appliance data directory notes
#
# Development default: this folder (backend/src/data)
# Production default:  /var/lib/legion-sentry
#
# Override with:
#   export LEGION_SENTRY_DATA_DIR=/var/lib/legion-sentry
#
# Migrate existing files:
#   npm run migrate:data -- --dry-run
#   npm run migrate:data
#
# Do not commit live credentials, managed device inventories, or log streams.
