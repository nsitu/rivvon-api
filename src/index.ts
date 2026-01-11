// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { uploadRoutes } from './routes/upload';
import { textureRoutes } from './routes/textures';
import { verifyAuth } from './middleware/auth';

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

// Get textures owned by current user (authenticated)
app.get('/my-textures', verifyAuth, async (c) => {
    const auth = c.get('auth');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const results = await c.env.DB.prepare(`
        SELECT 
            id, name, description, thumbnail_url,
            tile_resolution, tile_count, layer_count,
            cross_section_type, status, is_public,
            created_at, updated_at
        FROM texture_sets
        WHERE owner_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `).bind(auth.userId, limit, offset).all();

    return c.json({
        textures: results.results,
        pagination: { limit, offset },
    });
});

// Mount routes
// /textures - public read-only endpoints
// /texture-set - authenticated write operations
app.route('/texture-set', uploadRoutes);
app.route('/textures', textureRoutes);

export default app;
