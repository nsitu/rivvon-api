# Rivvon API

A Cloudflare Worker-based backend API for the Rivvon ecosystem, enabling texture upload, storage, and delivery for creative video texture applications.

## Overview

This API serves as the central backend connecting:
- **Slyce** (texture encoder) - authenticated uploads
- **Rivvon** (texture renderer) - public consumption

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (Object Storage)
- **Auth**: Auth0 + JWT (jose)

## Domains

- `api.rivvon.ca` - API endpoints
- `cdn.rivvon.ca` - R2 public bucket for texture delivery

## API Endpoints

### Public Routes
- `GET /textures` - List available textures
- `GET /textures/:id` - Get texture metadata and tile URLs

### Authenticated Routes (Bearer token required)
- `POST /upload/texture-set` - Create texture set and get upload URLs
- `POST /upload/texture-set/:id/complete` - Mark upload as complete

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Configuration

See `wrangler.toml` for Cloudflare configuration.
Secrets are managed via `wrangler secret put`.

## Related Repositories

- [Slyce](https://github.com/nsitu/slyce) - Texture encoder/creator
- [Rivvon](https://github.com/nsitu/rivvon) - Texture renderer/consumer

## License

ISC

