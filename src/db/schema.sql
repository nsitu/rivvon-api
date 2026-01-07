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
