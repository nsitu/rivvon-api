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
      ts.id, ts.name, ts.description, ts.thumbnail_url,
      ts.tile_resolution, ts.tile_count, ts.layer_count,
      ts.cross_section_type, ts.created_at,
      u.id as owner_id,
      u.name as owner_name,
      u.picture as owner_picture
    FROM texture_sets ts
    LEFT JOIN users u ON ts.owner_id = u.id
    WHERE ts.status = 'complete' AND ts.is_public = 1
    ORDER BY ts.created_at DESC
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
    SELECT 
      ts.*,
      u.id as owner_id,
      u.name as owner_name,
      u.picture as owner_picture
    FROM texture_sets ts
    LEFT JOIN users u ON ts.owner_id = u.id
    WHERE ts.id = ? AND ts.status = 'complete'
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
