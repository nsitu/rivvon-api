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
