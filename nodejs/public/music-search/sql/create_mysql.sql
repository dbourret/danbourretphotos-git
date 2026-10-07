-- Select your website database in DBeaver before running. Does not delete existing data.
CREATE TABLE IF NOT EXISTS MusicLibrary (
    `import_id` INT NOT NULL,
    `directory` TEXT,
    `song` VARCHAR(500),
    `artist` VARCHAR(500),
    `album` VARCHAR(500),
    `track_number` VARCHAR(10),
    `file_type` VARCHAR(20),
    `filename` TEXT,
    `parent_folder` VARCHAR(500),
    `full_path` TEXT,
    `parse_method` VARCHAR(100),
    `parse_confidence` VARCHAR(20),
    PRIMARY KEY (import_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
