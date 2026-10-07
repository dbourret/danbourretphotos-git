DAN'S MUSIC LIBRARY — WEBSITE SEARCH

What you get
A responsive web page with a column selector, contains-text search, 50 results per page, and expandable file details. The live version searches your database. preview.html is an offline design preview using the first 100 audio paths from your listing, with filename-only titles; it does not reproduce the previous CSV metadata parsing. The full CSV from your earlier conversation is the intended import source and is NOT included in this package.

1. YOUR CONFIRMED ONLINE DATABASE
Your supplied JDBC URL identifies MySQL at srv2183.hstgr.io:3306, database u703738212_danbourret_pho. The configuration template already uses these values. Use sql/create_mysql.sql for this database. SQL Server files are optional references for your earlier local database.

DBeaver is a database client, not the database engine. Your recent local database is Microsoft SQL Server. Confirm whether your website uses MySQL/MariaDB or SQL Server and whether it runs PHP 8.1 or newer. This package needs PDO with pdo_mysql or pdo_sqlsrv. It does not run directly on a Node-only host. For an Express website, serve this PHP application on a PHP-capable path/subdomain or request an Express version.
A database on your PC at localhost is not automatically available to your hosted website. Use your hosted database. In the web server config, localhost means the web server, not your PC. Do not expose your personal PC's SQL port for this feature.

2. CREATE THE ONLINE TABLE AND IMPORT
Connect DBeaver to your ONLINE database using the host's connection details.
If MySQL/MariaDB: open sql/create_mysql.sql and execute its contents in the correct database.
If SQL Server: reuse dbo.MusicLibrary if it already exists in the ONLINE database; otherwise execute sql/create_sqlserver.sql there. Do not type the script filename as an SQL statement.
Right-click MusicLibrary > Import Data > CSV. Select your earlier music_database_import.csv, use UTF-8, header row, comma delimiter and double-quote quoting, then map the 12 column names. Keep import_id from the CSV. Preserve backslashes in Windows paths; disable any importer backslash escape conversion. Treat empty metadata as NULL where available. Inspect a few paths/titles after import and compare imported row count with the CSV. Do not rerun the import into a populated table without handling duplicate primary keys.

3. INSTALL THE WEB PAGE
Upload the CONTENTS of public/ into your website's public_html/music/ directory (or equivalent).
Create music-search-private/ alongside public_html, OUTSIDE public_html. Copy private/config.example.php there, rename it config.php, and enter your database credentials. Default layout:
  account/public_html/music/index.html
  account/public_html/music/search.php
  account/public_html/music/style.css
  account/public_html/music/app.js
  account/music-search-private/config.php
For another layout set the server environment variable MUSIC_CONFIG_PATH to the absolute private config.php path or edit $configPath in search.php to that private absolute path. Do not place credentials or the configuration file in your public folder.
Use driver mysql and port 3306 for MySQL/MariaDB; driver sqlsrv and port 1433 for SQL Server. SQL Server uses encrypted connections and validates the server certificate; use a valid server hostname/certificate. MySQL remote connections should use your provider's recommended TLS configuration; ask your host for the required PDO TLS options if the database is on another host.
Use a database login with SELECT access to this table only. Use a separate import/admin account in DBeaver. Never upload this full ZIP or private/ to public_html.
Visit https://YOUR-DOMAIN/music/ after installation. You may link to that URL from your navigation.

4. SEARCH BEHAVIOR
Choose Song, Artist, Album, Directory, Filename or any other imported column. Type xyz and click Search library. The backend runs the equivalent of WHERE chosen_column LIKE '%xyz%'. Percent signs, underscores and SQL Server brackets in your entered text are treated literally, so you do not need to type wildcards. Case sensitivity follows your database collation (MySQL script uses a case-insensitive Unicode collation). Import ID is searched as text, too.
Results show song/filename, artist, album, type and expandable directory/full path/metadata details. Page buttons keep your selected search. No audio is uploaded or played: your source file is only a list of paths.

5. ACCESS AND PERFORMANCE
The page and API are publicly readable unless your host protects the music/ directory. If the catalog and Windows paths are intended only for you, enable the host's password-protected directory feature (protect search.php too), or integrate existing site login, before making the page available. The package does not implement account login or rate limiting.
Contains searches with a leading % commonly scan the table; normal artist/song indexes do not eliminate that scan. Test performance on your hosted database with the full catalog. Pagination limits displayed rows, but every search still counts all matches. For heavier traffic, add server-side rate limiting and consider a dedicated substring search index.

6. TROUBLESHOOTING
If PHP downloads or displays source rather than running, remove the installation from the public path until your host enables PHP correctly.
If the page reports database unavailable, inspect the private server error log. Check the private config path, database/host/user/password, PDO driver, firewall/provider database access rules and table name. SQL Server must support OFFSET/FETCH (2012 or newer). SQL Server column sizes match your earlier table; unusually long import values may need larger columns.
If your website uses MariaDB/MySQL, do not run the SQL Server NVARCHAR script there.

Verification
JavaScript syntax and preview data were checked during creation. Live database integration and PHP execution were not tested here; no website or database credentials were supplied and this environment has no PHP runtime. Deployment remains to be completed on your host.
