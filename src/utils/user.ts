// src/utils/user.ts

export interface UserProfile {
    name?: string | null;
    email?: string | null;
    picture?: string | null;
}

/**
 * Upsert user info from request body.
 * Creates user on first seen, updates name/email/picture on subsequent requests.
 * @param db - D1 database instance
 * @param userId - Auth0 user ID (sub claim from JWT)
 * @param profile - Optional user profile from request body
 */
export async function syncUser(
    db: D1Database, 
    userId: string, 
    profile?: UserProfile
): Promise<void> {
    // Use INSERT OR REPLACE to upsert user
    // This will insert if not exists, or update if exists
    await db.prepare(`
        INSERT INTO users (id, name, email, picture, created_at, last_login)
        VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
        ON CONFLICT(id) DO UPDATE SET
            name = COALESCE(excluded.name, users.name),
            email = COALESCE(excluded.email, users.email),
            picture = COALESCE(excluded.picture, users.picture),
            last_login = unixepoch()
    `).bind(
        userId,
        profile?.name || null,
        profile?.email || null,
        profile?.picture || null
    ).run();
}
