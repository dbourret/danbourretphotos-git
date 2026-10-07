-- Run only if dbo.MusicLibrary does not already exist. Select the intended database first.
CREATE TABLE dbo.MusicLibrary (
    [import_id] INT NOT NULL,
    [directory] NVARCHAR(1000),
    [song] NVARCHAR(500),
    [artist] NVARCHAR(500),
    [album] NVARCHAR(500),
    [track_number] NVARCHAR(10),
    [file_type] NVARCHAR(20),
    [filename] NVARCHAR(1000),
    [parent_folder] NVARCHAR(500),
    [full_path] NVARCHAR(2000),
    [parse_method] NVARCHAR(100),
    [parse_confidence] NVARCHAR(20),
    CONSTRAINT PK_MusicLibrary PRIMARY KEY (import_id)
);
