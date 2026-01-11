// src/routes/upload.ts
import { Hono } from 'hono';
import { verifyAuth } from '../middleware/auth';
import { syncUser } from '../utils/user';
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
    userProfile,
  } = body;

  // Sync user info if provided
  if (userProfile) {
    await syncUser(c.env.DB, auth.userId, userProfile);
  }

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

    // Generate presigned URL for uploading directly to R2
    // Client will PUT the file to this URL
    const object = await c.env.BUCKET.put(r2Key, new Uint8Array(), {
      httpMetadata: { contentType: 'image/ktx2' }
    });

    uploadUrls.push({
      tileIndex: i,
      r2Key,
      // For now, return the r2Key - client will need to call a separate upload endpoint
      // or we'll implement R2 presigned URLs in a future iteration
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

  // Mark as complete and make public by default
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET status = 'complete', is_public = 1, updated_at = unixepoch()
    WHERE id = ?
  `).bind(textureSetId).run();

  return c.json({ status: 'complete', textureSetId });
});

// Upload a single tile (alternative to presigned URLs)
uploadRoutes.put('/texture-set/:setId/tile/:index', async (c) => {
  const auth = c.get('auth');
  const setId = c.req.param('setId');
  const tileIndex = parseInt(c.req.param('index'));

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(setId, auth.userId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }

  // Get tile record
  const tile = await c.env.DB.prepare(`
    SELECT * FROM texture_tiles WHERE texture_set_id = ? AND tile_index = ?
  `).bind(setId, tileIndex).first();

  if (!tile) {
    return c.json({ error: 'Tile not found' }, 404);
  }

  // Upload to R2
  const body = await c.req.arrayBuffer();
  await c.env.BUCKET.put(tile.r2_key, body, {
    httpMetadata: { contentType: 'image/ktx2' }
  });

  // Update tile record with size
  await c.env.DB.prepare(`
    UPDATE texture_tiles SET file_size = ? WHERE id = ?
  `).bind(body.byteLength, tile.id).run();

  return c.json({ success: true, tileIndex, size: body.byteLength });
});

// Upload thumbnail for a texture set
uploadRoutes.put('/texture-set/:setId/thumbnail', async (c) => {
  const auth = c.get('auth');
  const setId = c.req.param('setId');

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(setId, auth.userId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }

  // Get content type from request
  const contentType = c.req.header('Content-Type') || 'image/jpeg';

  // Validate content type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(contentType)) {
    return c.json({
      error: 'Invalid content type. Allowed: image/jpeg, image/png, image/webp'
    }, 400);
  }

  // Determine file extension
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  const ext = extMap[contentType];

  // R2 key for thumbnail
  const r2Key = `thumbnails/${setId}.${ext}`;
  const thumbnailUrl = `https://cdn.rivvon.ca/${r2Key}`;

  // Upload to R2
  const body = await c.req.arrayBuffer();
  await c.env.BUCKET.put(r2Key, body, {
    httpMetadata: { contentType }
  });

  // Update texture set with thumbnail URL
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET thumbnail_url = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(thumbnailUrl, setId).run();

  return c.json({
    success: true,
    thumbnailUrl,
    size: body.byteLength
  });
});

// Delete a texture set (owner only)
uploadRoutes.delete('/texture-set/:id', async (c) => {
  const auth = c.get('auth');
  const textureSetId = c.req.param('id');

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(textureSetId, auth.userId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found or not owned by you' }, 404);
  }

  // Get all tiles to delete from R2
  const tiles = await c.env.DB.prepare(`
    SELECT r2_key FROM texture_tiles WHERE texture_set_id = ?
  `).bind(textureSetId).all();

  // Collect all R2 keys to delete
  const r2KeysToDelete: string[] = [];

  // Add tile keys
  for (const tile of tiles.results) {
    r2KeysToDelete.push(tile.r2_key as string);
  }

  // Add thumbnail if exists
  if (textureSet.thumbnail_url) {
    // Extract R2 key from thumbnail URL (e.g., "https://cdn.rivvon.ca/thumbnails/abc.jpg" -> "thumbnails/abc.jpg")
    const thumbnailUrl = textureSet.thumbnail_url as string;
    const thumbnailKey = thumbnailUrl.replace('https://cdn.rivvon.ca/', '');
    r2KeysToDelete.push(thumbnailKey);
  }

  // Delete all files from R2
  if (r2KeysToDelete.length > 0) {
    await c.env.BUCKET.delete(r2KeysToDelete);
  }

  // Delete texture_tiles records
  await c.env.DB.prepare(`
    DELETE FROM texture_tiles WHERE texture_set_id = ?
  `).bind(textureSetId).run();

  // Delete texture_set record
  await c.env.DB.prepare(`
    DELETE FROM texture_sets WHERE id = ?
  `).bind(textureSetId).run();

  return c.json({
    success: true,
    message: 'Texture set deleted',
    deletedFiles: r2KeysToDelete.length
  });
});
