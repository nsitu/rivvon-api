# Rivvon API - Backend Project Plan

## Overview

A Cloudflare-based backend API to enable Slyce (texture encoder) to upload KTX2 texture arrays that Rivvon (texture renderer) can consume. The API handles authentication, file uploads to R2, and metadata storage in D1.

## Domain Structure

```
rivvon.ca              → Rivvon frontend (texture renderer/consumer)
slyce.rivvon.ca        → Slyce frontend (texture encoder/creator) 
api.rivvon.ca          → Backend API (Cloudflare Worker)
cdn.rivvon.ca          → R2 public bucket (texture tile delivery)
```

---

## Related Repositories & Ecosystem

This API is part of the **Rivvon ecosystem** - a suite of tools for creating and rendering artistic video textures using slit-scan-inspired techniques.

### Rivvon (Texture Renderer/Consumer)
- **Repository**: [github.com/nsitu/rivvon](https://github.com/nsitu/rivvon)
- **Live site**: [rivvon.ca](https://rivvon.ca)
- **Purpose**: WebGL/WebGPU frontend that renders KTX2 texture arrays along SVG paths to create animated ribbons
- **Tech stack**: Vue 3, Three.js, Vite, CloudFlare Pages
- **Role**: Consumes textures from this API (public read access)

### Slyce (Texture Encoder/Creator)
- **Repository**: [github.com/nsitu/slyce](https://github.com/nsitu/slyce)
- **Live site**: [slyce.rivvon.ca](https://slyce.rivvon.ca)  
- **Currently**: [nsitu.github.io/slyce](https://nsitu.github.io/slyce)
- **Purpose**: Browser-based video processor that samples cross-sections from videos and encodes them as KTX2 texture arrays
- **Tech stack**: Vue 3, WebCodecs, mediabunny, Basis Universal (WASM), Vite, CloudFlare Pages
- **Role**: Creates textures and uploads them to this API (authenticated write access)

### This Repository (Backend API)
- **Repository**: [github.com/nsitu/rivvon-api](https://github.com/nsitu/rivvon-api) (this repo)
- **Live API**: [api.rivvon.ca](https://api.rivvon.ca)
- **Purpose**: Cloudflare Worker API that handles authentication, texture uploads, metadata storage, and public texture serving
- **Tech stack**: Hono, Cloudflare Workers/D1/R2, Auth0, TypeScript
- **Role**: Central backend service connecting Slyce (uploader) and Rivvon (consumer)

### Data Flow

```
User uploads video to Slyce
    ↓
Slyce processes video → creates KTX2 tiles
    ↓
Slyce authenticates via Auth0
    ↓
Slyce uploads tiles to Rivvon API (api.rivvon.ca)
    ↓
API stores tiles in R2 (cdn.rivvon.ca)
API stores metadata in D1
    ↓
Rivvon queries API for available textures (public)
    ↓
Rivvon downloads tiles from CDN (cdn.rivvon.ca)
    ↓
Rivvon renders animated textures in 3D scene
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Slyce Frontend │     │  Rivvon Frontend │     │     Auth0       │
│  (CF     Pages) │     │   (rivvon.ca)    │     │   (Identity)    │
└────────┬────────┘     └────────┬─────────┘     └────────┬────────┘
         │                       │                        │
         │ Upload KTX2           │ Fetch textures         │ PKCE flow
         │ + Bearer token        │                        │ (SPA SDK)
         ▼                       ▼                        ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker (API)                         │
│                    https://api.rivvon.ca                           │
├────────────────────────────────────────────────────────────────────┤
│  /upload         - Request signed R2 upload URL (authenticated)   │
│  /textures       - List available textures (public)               │
│  /textures/:id   - Get texture metadata (public)                  │
│                                                                    │
│  JWT validation via jose + Auth0 JWKS (stateless)                │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
         ┌────────────────┴────────────────┐
         ▼                                  ▼
┌─────────────┐                    ┌─────────────┐
│     D1      │                    │     R2      │
│  (SQLite)   │                    │   (Blobs)   │
│  Metadata   │                    │ KTX2 files  │
└─────────────┘                    └─────────────┘
```

---

## Phase 1: Repository & Infrastructure Setup

### 1.1 Create New Repository

```bash
# Create new repo: github.com/nsitu/rivvon-api
mkdir rivvon-api
cd rivvon-api
npm init -y
```

### 1.2 Project Structure

```
rivvon-api/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions for Wrangler deploy
├── src/
│   ├── index.ts                # Main worker entry point
│   ├── routes/
│   │   ├── upload.ts           # R2 signed URL generation (authenticated)
│   │   └── textures.ts         # Public texture metadata API
│   ├── middleware/
│   │   └── auth.ts             # JWT verification with jose
│   ├── db/
│   │   └── schema.sql          # D1 schema definitions
│   └── utils/
│       ├── cors.ts             # CORS handling
│       └── response.ts         # Response helpers
├── wrangler.toml               # Cloudflare configuration
├── package.json
├── tsconfig.json
└── README.md
```

### 1.3 Dependencies

```json
{
  "dependencies": {
    "hono": "^4.0.0",
    "jose": "^5.2.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240000.0",
    "wrangler": "^3.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## Phase 2: Auth0 Configuration

### 2.0 Authentication Flow Overview

The authentication follows a **stateless SPA flow**:

```
1. User clicks "Login" in Slyce frontend
2. Slyce redirects to Auth0 login page (PKCE flow)
3. Auth0 authenticates user and redirects back to Slyce
4. Slyce receives authorization code and exchanges it for JWT access token
5. Slyce stores token (memory/localStorage) and includes it in API requests
6. API validates JWT using Auth0's public JWKS endpoint (via jose library)
7. API processes authenticated requests
```

**Key points:**
- Auth0 redirects back to **Slyce frontend**, not the API
- The API **never handles OAuth callbacks**
- The API is **stateless** - no sessions, no cookies
- JWT validation happens on every authenticated request
- Token validation uses Auth0's public JWKS (no shared secrets needed)

### 2.1 Auth0 Application Setup (SPA - for Slyce Frontend)

1. **Create Application** in Auth0 Dashboard
   - Name: `Slyce Frontend`
   - Type: `Single Page Application`
   - Allowed Callback URLs: `https://slyce.rivvon.ca/callback`
   - Allowed Logout URLs: `https://slyce.rivvon.ca`
   - Allowed Web Origins: `https://slyce.rivvon.ca`

2. **Enable PKCE** (default for SPA)

### 2.2 Auth0 API Setup (for Backend Validation)

1. **Create API** in Auth0 Dashboard
   - Name: `Rivvon API`
   - Identifier (Audience): `https://api.rivvon.ca`
   - Signing Algorithm: `RS256`

2. **Define Permissions/Scopes**:
   - `upload:textures` - Can upload texture files
   - `delete:textures` - Can delete texture files (admin)

### 2.3 Environment Variables

```bash
# Auth0 Configuration (store as Cloudflare secrets)
AUTH0_DOMAIN=login.rivvon.ca
AUTH0_AUDIENCE=https://api.rivvon.ca
AUTH0_CLIENT_ID=your-client-id
```

---

## Phase 3: Cloudflare Configuration

### 3.1 Wrangler Configuration

```toml
# wrangler.toml
name = "rivvon-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "rivvon-textures"
database_id = "<will be generated>"

# R2 Bucket
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "rivvon-textures"

# Environment variables (non-secret)
[vars]
CORS_ORIGINS = "https://slyce.rivvon.ca,https://rivvon.ca"

# Secrets (set via wrangler secret put)
# AUTH0_DOMAIN
# AUTH0_AUDIENCE
```

### 3.2 Create Cloudflare Resources

```bash
# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create rivvon-textures

# Create R2 bucket
wrangler r2 bucket create rivvon-textures

# Set secrets
wrangler secret put AUTH0_DOMAIN
wrangler secret put AUTH0_AUDIENCE
```
### 3.3 Configure Custom Subdomains

#### api.rivvon.ca (Worker API)

1. **In Cloudflare Dashboard** → Workers & Pages → rivvon-api:
   - Go to **Settings** → **Triggers** → **Custom Domains**
   - Click **Add Custom Domain**
   - Enter: `api.rivvon.ca`
   - Cloudflare will automatically create DNS records

2. **Verify DNS** (should be auto-configured):
   ```
   Type: CNAME
   Name: api
   Target: rivvon-api.workers.dev
   Proxy: Enabled (orange cloud)
   ```

#### cdn.rivvon.ca (R2 Public Bucket)

1. **Enable R2 Public Access**:
   - In Cloudflare Dashboard → R2 → rivvon-textures
   - Go to **Settings** → **Public Access**
   - Click **Allow Access** (if not already enabled)
   - Note the default R2.dev domain (e.g., `pub-xxx.r2.dev`)

2. **Configure Custom Domain**:
   - In R2 bucket settings → **Custom Domains**
   - Click **Connect Domain**
   - Enter: `cdn.rivvon.ca`
   - Cloudflare will create DNS records automatically

3. **Verify DNS** (should be auto-configured):
   ```
   Type: CNAME
   Name: cdn
   Target: <bucket-public-url>.r2.cloudflarestorage.com
   Proxy: Enabled (orange cloud)
   ```

4. **Configure CORS** (for browser access):
   ```bash
   # Create cors.json
   cat > cors.json << EOF
   [
     {
       "AllowedOrigins": ["https://rivvon.ca", "https://slyce.rivvon.ca"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   EOF

   # Apply CORS configuration
   wrangler r2 bucket cors put rivvon-textures --cors-config cors.json
   ```
---

## Phase 4: D1 Database Schema

### 4.1 Schema Definition

```sql
-- src/db/schema.sql

-- Texture sets (a collection of KTX2 tiles)
CREATE TABLE IF NOT EXISTS texture_sets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,              -- Auth0 user ID
    name TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,                   -- R2 public URL for preview
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    
    -- Source video metadata
    source_filename TEXT,
    source_width INTEGER,
    source_height INTEGER,
    source_duration REAL,
    source_frame_count INTEGER,
    
    -- Texture configuration
    tile_resolution INTEGER NOT NULL,     -- 256, 512, 1024, etc.
    tile_count INTEGER NOT NULL,          -- Number of tiles in set
    layer_count INTEGER NOT NULL,         -- Layers per tile (e.g., 60)
    cross_section_type TEXT,              -- 'planes' or 'waves'
    
    -- Status
    status TEXT DEFAULT 'pending',        -- pending, uploading, complete, error
    is_public INTEGER DEFAULT 0           -- Whether publicly listed
);

-- Individual texture tiles
CREATE TABLE IF NOT EXISTS texture_tiles (
    id TEXT PRIMARY KEY,
    texture_set_id TEXT NOT NULL,
    tile_index INTEGER NOT NULL,          -- 0, 1, 2, ... tile_count-1
    r2_key TEXT NOT NULL,                 -- R2 object key
    file_size INTEGER,
    checksum TEXT,                        -- MD5 or SHA256
    created_at INTEGER DEFAULT (unixepoch()),
    
    FOREIGN KEY (texture_set_id) REFERENCES texture_sets(id) ON DELETE CASCADE,
    UNIQUE(texture_set_id, tile_index)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_texture_sets_owner ON texture_sets(owner_id);
CREATE INDEX IF NOT EXISTS idx_texture_sets_public ON texture_sets(is_public);
CREATE INDEX IF NOT EXISTS idx_texture_tiles_set ON texture_tiles(texture_set_id);
```

### 4.2 Apply Schema

```bash
wrangler d1 execute rivvon-textures --file=./src/db/schema.sql
```

---

## Phase 5: Worker Implementation

### 5.1 Main Entry Point

```typescript
// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { uploadRoutes } from './routes/upload';
import { textureRoutes } from './routes/textures';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  AUTH0_DOMAIN: string;
  AUTH0_AUDIENCE: string;
  CORS_ORIGINS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS middleware
app.use('*', async (c, next) => {
  const origins = c.env.CORS_ORIGINS.split(',');
  return cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })(c, next);
});

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'rivvon-api' }));

// Mount routes
// Note: No /auth routes needed - Slyce handles Auth0 directly
app.route('/upload', uploadRoutes);
app.route('/textures', textureRoutes);

export default app;
```

### 5.2 JWT Verification Middleware

```typescript
// src/middleware/auth.ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Context, Next } from 'hono';

export interface AuthContext {
  userId: string;
  permissions: string[];
}

export async function verifyAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }
  
  const token = authHeader.slice(7);
  const domain = c.env.AUTH0_DOMAIN;
  const audience = c.env.AUTH0_AUDIENCE;
  
  try {
    // Create JWKS client (Auth0 publishes keys at /.well-known/jwks.json)
    const JWKS = createRemoteJWKSet(
      new URL(`https://${domain}/.well-known/jwks.json`)
    );
    
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${domain}/`,
      audience: audience,
    });
    
    // Attach user info to context
    c.set('auth', {
      userId: payload.sub,
      permissions: payload.permissions || [],
    } as AuthContext);
    
    await next();
  } catch (error) {
    console.error('JWT verification failed:', error);
    return c.json({ error: 'Invalid token' }, 401);
  }
}

export function requirePermission(permission: string) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext;
    
    if (!auth?.permissions?.includes(permission)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    
    await next();
  };
}
```

### 5.3 Upload Routes

```typescript
// src/routes/upload.ts
import { Hono } from 'hono';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { nanoid } from 'nanoid';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

export const uploadRoutes = new Hono<{ Bindings: Bindings }>();

// All upload routes require authentication
uploadRoutes.use('*', verifyAuth);

// Create a new texture set and get upload URLs
uploadRoutes.post('/texture-set', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json();
  
  const {
    name,
    description,
    tileResolution,
    tileCount,
    layerCount,
    crossSectionType,
    sourceMetadata,
  } = body;
  
  // Validate required fields
  if (!name || !tileResolution || !tileCount || !layerCount) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  
  const textureSetId = nanoid();
  
  // Insert texture set record
  await c.env.DB.prepare(`
    INSERT INTO texture_sets (
      id, owner_id, name, description, 
      tile_resolution, tile_count, layer_count, cross_section_type,
      source_filename, source_width, source_height, 
      source_duration, source_frame_count,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading')
  `).bind(
    textureSetId,
    auth.userId,
    name,
    description || null,
    tileResolution,
    tileCount,
    layerCount,
    crossSectionType || null,
    sourceMetadata?.filename || null,
    sourceMetadata?.width || null,
    sourceMetadata?.height || null,
    sourceMetadata?.duration || null,
    sourceMetadata?.frameCount || null,
  ).run();
  
  // Generate signed upload URLs for each tile
  const uploadUrls = [];
  for (let i = 0; i < tileCount; i++) {
    const tileId = nanoid();
    const r2Key = `textures/${textureSetId}/${i}.ktx2`;
    
    // Insert tile record
    await c.env.DB.prepare(`
      INSERT INTO texture_tiles (id, texture_set_id, tile_index, r2_key)
      VALUES (?, ?, ?, ?)
    `).bind(tileId, textureSetId, i, r2Key).run();
    
    // Generate signed upload URL (valid for 1 hour)
    // Note: R2 signed URLs require additional setup via wrangler
    uploadUrls.push({
      tileIndex: i,
      uploadUrl: `https://rivvon-textures.${c.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com/${r2Key}`,
      r2Key,
    });
  }
  
  return c.json({
    textureSetId,
    uploadUrls,
    message: 'Upload URLs generated. Upload files then call /complete',
  });
});

// Mark upload as complete
uploadRoutes.post('/texture-set/:id/complete', async (c) => {
  const auth = c.get('auth');
  const textureSetId = c.req.param('id');
  
  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(textureSetId, auth.userId).first();
  
  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }
  
  // Verify all tiles exist in R2
  const tiles = await c.env.DB.prepare(`
    SELECT * FROM texture_tiles WHERE texture_set_id = ?
  `).bind(textureSetId).all();
  
  for (const tile of tiles.results) {
    const object = await c.env.BUCKET.head(tile.r2_key);
    if (!object) {
      return c.json({ 
        error: `Tile ${tile.tile_index} not uploaded`, 
        missingTile: tile.tile_index 
      }, 400);
    }
    
    // Update tile with file info
    await c.env.DB.prepare(`
      UPDATE texture_tiles SET file_size = ? WHERE id = ?
    `).bind(object.size, tile.id).run();
  }
  
  // Mark as complete
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET status = 'complete', updated_at = unixepoch()
    WHERE id = ?
  `).bind(textureSetId).run();
  
  return c.json({ status: 'complete', textureSetId });
});
```

### 5.4 Public Texture Routes

```typescript
// src/routes/textures.ts
import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

export const textureRoutes = new Hono<{ Bindings: Bindings }>();

// List public texture sets
textureRoutes.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  
  const results = await c.env.DB.prepare(`
    SELECT 
      id, name, description, thumbnail_url,
      tile_resolution, tile_count, layer_count,
      cross_section_type, created_at
    FROM texture_sets
    WHERE status = 'complete' AND is_public = 1
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();
  
  return c.json({
    textures: results.results,
    pagination: { limit, offset },
  });
});

// Get single texture set with tile URLs
textureRoutes.get('/:id', async (c) => {
  const textureSetId = c.req.param('id');
  
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets 
    WHERE id = ? AND status = 'complete'
  `).bind(textureSetId).first();
  
  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }
  
  const tiles = await c.env.DB.prepare(`
    SELECT tile_index, r2_key, file_size 
    FROM texture_tiles 
    WHERE texture_set_id = ?
    ORDER BY tile_index
  `).bind(textureSetId).all();
  
  // Generate public URLs for each tile (using custom CDN domain)
  const tileUrls = tiles.results.map((tile: any) => ({
    tileIndex: tile.tile_index,
    url: `https://cdn.rivvon.ca/${tile.r2_key}`,
    fileSize: tile.file_size,
  }));
  
  return c.json({
    ...textureSet,
    tiles: tileUrls,
  });
});

// Download texture tile (proxy through worker if needed)
textureRoutes.get('/:setId/tile/:index', async (c) => {
  const setId = c.req.param('setId');
  const tileIndex = parseInt(c.req.param('index'));
  
  const tile = await c.env.DB.prepare(`
    SELECT r2_key FROM texture_tiles 
    WHERE texture_set_id = ? AND tile_index = ?
  `).bind(setId, tileIndex).first();
  
  if (!tile) {
    return c.json({ error: 'Tile not found' }, 404);
  }
  
  const object = await c.env.BUCKET.get(tile.r2_key);
  if (!object) {
    return c.json({ error: 'File not found in storage' }, 404);
  }
  
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/ktx2',
      'Cache-Control': 'public, max-age=31536000',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
```

---

## Phase 6: Deployment Strategy

This project uses a **two-stage deployment approach**:

1. **Wrangler Bootstrap** - One-time setup to create resources, set secrets, and verify everything works
2. **Git Integration** - Ongoing production deployments via Cloudflare's Git integration

### 6.1 Stage 1: Wrangler Bootstrap (One-Time Setup)

Before connecting Git, use Wrangler to bootstrap all resources and verify the Worker runs end-to-end.

#### Step 1: Commit Code First

Ensure your code is committed and ready:

```bash
# Make sure everything is committed
git add .
git commit -m "Initial rivvon-api implementation"
```

#### Step 2: Login to Cloudflare

```bash
wrangler login
```

#### Step 3: Create D1 Database

```bash
wrangler d1 create rivvon-textures
```

Copy the `database_id` from output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "rivvon-textures"
database_id = "<paste-id-here>"
```

#### Step 4: Create R2 Bucket

```bash
wrangler r2 bucket create rivvon-textures
```

#### Step 5: Apply Database Schema

```bash
wrangler d1 execute rivvon-textures --file=./src/db/schema.sql --remote
```

#### Step 6: Set Secrets

```bash
wrangler secret put AUTH0_DOMAIN
# Enter: login.rivvon.ca

wrangler secret put AUTH0_AUDIENCE
# Enter: https://api.rivvon.ca
```

#### Step 7: Initial Deploy (Verify Everything Works)

```bash
wrangler deploy
```

Test the deployment:
```bash
curl https://rivvon-api.<your-subdomain>.workers.dev/
# Should return: {"status":"ok","service":"rivvon-api"}
```

#### Step 8: Commit wrangler.toml with Database ID

```bash
git add wrangler.toml
git commit -m "Add D1 database_id to wrangler.toml"
git push origin main
```

### 6.2 Stage 2: Connect Git Integration

Now that the Worker is verified, connect Git for ongoing deployments.

#### Step 1: Connect Repository to Cloudflare

1. **In Cloudflare Dashboard** → Workers & Pages:
   - Find your deployed Worker (`rivvon-api`)
   - Go to **Settings** → **Builds & Deployments** → **Connect to Git**
   - Select **GitHub** and authorize Cloudflare (if first time)
   - Select repository: `nsitu/rivvon-api`
   - Select branch: `main`

2. **Configure Build Settings**:
   - **Production branch**: `main`
   - Cloudflare will detect `wrangler.toml` automatically

3. **Save and Deploy**

#### Step 2: Add Custom Domain

1. Go to Worker → **Settings** → **Triggers** → **Custom Domains**
2. Add: `api.rivvon.ca`
3. Cloudflare will configure DNS automatically

### 6.3 Ongoing Workflow (After Git Connected)

| Task | Tool |
|------|------|
| Production deployments | **Git push** (automatic) |
| Local development | `wrangler dev` |
| D1 migrations | `wrangler d1 execute --remote` |
| Add/update secrets | `wrangler secret put` |
| View live logs | `wrangler tail` |
| Manage R2 buckets | `wrangler r2` |

**⚠️ Important**: After Git is connected, **stop using `wrangler deploy` for production**. Git becomes the single source of truth for deployments.

### 6.4 Avoiding Drift

To keep Wrangler and Git in sync:

- ✅ Always commit `wrangler.toml` changes before deploying
- ✅ Use Git for all code deployments
- ✅ Use Wrangler only for: `dev`, `secret`, `d1`, `r2`, `tail`
- ❌ Don't run `wrangler deploy` after Git is connected
- ❌ Don't edit Worker code in Cloudflare dashboard

### 6.5 What Persists After Git Connected

| Resource | Status |
|----------|--------|
| D1 Database | ✅ Persists (data intact) |
| R2 Bucket | ✅ Persists (files intact) |
| Secrets | ✅ Persists (AUTH0_DOMAIN, AUTH0_AUDIENCE) |
| Bindings | ✅ Managed by wrangler.toml |
| Custom Domain | ✅ Persists |

Git deploys rebuild and redeploy the Worker using committed `wrangler.toml` config.

---

## Phase 7: Integration with Slyce Frontend

### 7.1 Auth0 SDK Integration (Slyce)

```javascript
// In Slyce frontend - add to stores or composables
import { createAuth0Client } from '@auth0/auth0-spa-js';

// Initialize Auth0 client (runs on app startup)
const auth0 = await createAuth0Client({
  domain: 'login.rivvon.ca', // CNAME points to my-tenant.auth0.com
  clientId: 'your-client-id',
  authorizationParams: {
    audience: 'https://api.rivvon.ca',
    redirect_uri: window.location.origin + '/callback', // Slyce handles callback
  },
});

// Handle Auth0 callback on page load (if redirected from Auth0)
if (window.location.search.includes('code=')) {
  await auth0.handleRedirectCallback();
  window.history.replaceState({}, document.title, window.location.pathname);
}

// Login function
async function login() {
  await auth0.loginWithRedirect();
}

// Get access token for API calls (auto-refreshes if needed)
async function getAccessToken() {
  return await auth0.getTokenSilently();
}

// Upload texture set
async function uploadTextureSet(zipBlob, metadata) {
  const token = await getAccessToken();
  
  // 1. Create texture set and get upload URLs
  const response = await fetch('https://api.rivvon.ca/upload/texture-set', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: metadata.name,
      tileResolution: metadata.resolution,
      tileCount: metadata.tileCount,
      layerCount: metadata.layerCount,
      crossSectionType: metadata.crossSectionType,
      sourceMetadata: metadata.source,
    }),
  });
  
  const { textureSetId, uploadUrls } = await response.json();
  
  // 2. Upload each tile to R2
  // (Extract from zip and upload individually)
  
  // 3. Mark complete
  await fetch(`https://api.rivvon.ca/upload/texture-set/${textureSetId}/complete`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  
  return textureSetId;
}
```

---

## Phase 8: Integration with Rivvon Frontend

### 8.1 Fetch Available Textures

```javascript
// In Rivvon - add to tileManager.js or create textureService.js

const API_BASE = 'https://api.rivvon.ca';

async function fetchAvailableTextures() {
  const response = await fetch(`${API_BASE}/textures`);
  return await response.json();
}

async function fetchTextureSet(textureSetId) {
  const response = await fetch(`${API_BASE}/textures/${textureSetId}`);
  return await response.json();
}

// Modify TileManager to accept remote texture sets
class TileManager {
  async loadFromRemote(textureSetId) {
    const textureSet = await fetchTextureSet(textureSetId);
    
    // Update internal state
    this.tileCount = textureSet.tile_count;
    this.layerCount = textureSet.layer_count;
    this.variant = textureSet.cross_section_type;
    
    // Load tiles from URLs
    for (const tile of textureSet.tiles) {
      await this.#loadKTX2TileFromUrl(tile.tileIndex, tile.url);
    }
  }
}
```

---

## Timeline Estimate

| Phase | Task | Duration |
|-------|------|----------|
| 1 | Repository & Infrastructure Setup | 1 day |
| 2 | Auth0 Configuration | 0.5 day |
| 3 | Cloudflare Resources (D1, R2, Worker) | 0.5 day |
| 4 | D1 Schema & Migrations | 0.5 day |
| 5 | Worker Implementation | 2-3 days |
| 6 | GitHub Actions CI/CD | 0.5 day |
| 7 | Slyce Frontend Integration | 1-2 days |
| 8 | Rivvon Integration | 1 day |
| - | Testing & Refinement | 1-2 days |

**Total: ~8-11 days**

---

## Security Considerations

1. **JWT Validation** - All authenticated routes verify tokens via Auth0 JWKS
2. **CORS** - Strict origin whitelist for Slyce and Rivvon domains
3. **R2 Signed URLs** - Time-limited upload URLs prevent unauthorized uploads
4. **Ownership Checks** - Users can only modify their own texture sets
5. **Rate Limiting** - Consider adding Cloudflare rate limiting rules

---

## Future Enhancements

- [ ] Thumbnail generation (resize first frame of each tile)
- [ ] Texture set categories/tags
- [ ] Search functionality
- [ ] Usage analytics
- [ ] CDN caching optimization
- [ ] Batch delete functionality
- [ ] Admin dashboard for moderation