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
